import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  Segment,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import type { CommandReply } from '../types/command-reply';
import type {
  BookOutline,
  PhraseSpanToken,
  PlacedFreeTranslations,
  PoolEntryRef,
  SegmentPage,
} from '../types/segment-pages';
import { isWordToken } from '../types/type-guards';
import { normalizeSurfaceForm } from '../utils/analysis-identity';

/**
 * What a reply leaves to fetch again: nothing, the held pages, the held pages with the outline's
 * orphaned-card counts, or the outline along with each view's latest range.
 */
export type Refetch = 'none' | 'pages' | 'placement' | 'outline';

/** Records of one kind by id. */
type Table<T> = Map<string, T>;

function fileUnder(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function unfileFrom(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key);
  ids?.delete(id);
  if (ids?.size === 0) index.delete(key);
}

function idsUnder(index: Map<string, Set<string>>, keys: readonly string[]): string[] {
  return [...new Set(keys.flatMap((key) => [...(index.get(key) ?? [])]))];
}

function recordsOf<T>(table: Table<T>, ids: readonly string[]): T[] {
  /* v8 ignore next -- an id comes from an index, or a link, over records the cache holds */
  return [...new Set(ids)].flatMap((id) => table.get(id) ?? []);
}

/**
 * The records a view holds of one book's analysis: the segments of the pages it has fetched, the
 * links and payloads on them, their pool buckets and phrase spans. Fetched pages and command
 * replies both write into the cache. It serves each held range as the host would page that range.
 *
 * A page fetched before a reply was applied never overwrites what that reply wrote.
 */
export class RecordCache {
  /**
   * How many replies have been applied; a page request notes it when sent, for
   * {@link RecordCache.absorb}.
   */
  revision = 0;

  private outlineHeld: BookOutline;

  private readonly segments = new Map<number, Segment>();

  private readonly tokenLinks: Table<TokenAnalysisLink> = new Map();

  private readonly phraseLinks: Table<PhraseAnalysisLink> = new Map();

  private readonly segmentLinks: Table<SegmentAnalysisLink> = new Map();

  private readonly tokenAnalyses: Table<TokenAnalysis> = new Map();

  private readonly phraseAnalyses: Table<PhraseAnalysis> = new Map();

  private readonly segmentAnalyses: Table<SegmentAnalysis> = new Map();

  private readonly tokenLinksByRef = new Map<string, Set<string>>();

  private readonly phraseLinksByRef = new Map<string, Set<string>>();

  private readonly segmentLinksBySegment = new Map<string, Set<string>>();

  private readonly poolBuckets = new Map<string, readonly PoolEntryRef[]>();

  /** Each word token held or spanned, with where it sits in the book. */
  private readonly spanTokens = new Map<string, PhraseSpanToken>();

  /** The stale free translations placed at each held segment, and those ahead of the book. */
  private placement: {
    bySegment: Map<string, readonly string[]>;
    orphanedAfter: Map<string, readonly string[]>;
    orphanedAhead: readonly string[];
  } = { bySegment: new Map(), orphanedAfter: new Map(), orphanedAhead: [] };

  /** The revision that last wrote or removed each record or pool bucket, keyed by kind and id. */
  private readonly writtenAt = new Map<string, number>();

  constructor(outline: BookOutline) {
    this.outlineHeld = outline;
  }

  /** The outline that the held pages were cut by. */
  get outline(): BookOutline {
    return this.outlineHeld;
  }

  /** Takes a fresh outline and lets go of every held page, because their indexes may have moved. */
  replaceOutline(outline: BookOutline): void {
    this.outlineHeld = outline;
    this.segments.clear();
    this.spanTokens.clear();
  }

  /**
   * Takes the orphaned-card counts of a fresh outline, keeping the held pages.
   *
   * @returns `true` when it took the counts. `false`, taking nothing, when `outline` differs from
   *   the held outline in more than its orphaned-card counts.
   */
  takeCounts(outline: BookOutline): boolean {
    const cut = ({ segments, ...rest }: BookOutline) =>
      JSON.stringify({ ...rest, segments: segments.map((s) => ({ ...s, orphanedCardCount: 0 })) });
    if (cut(outline) !== cut(this.outlineHeld)) return false;
    this.outlineHeld = outline;
    return true;
  }

  /**
   * The outline indexes of the held segments that read one of `analysisIds`, or that hold a word
   * token of one of `forms`.
   */
  heldIndexesReading(analysisIds: readonly string[], forms: readonly string[]): number[] {
    const ids = new Set(analysisIds);
    const formSet = new Set(forms);
    const reads = (links: Iterable<{ analysisId: string }>) =>
      [...links].some(({ analysisId }) => ids.has(analysisId));
    return [...this.segments]
      .filter(([index, segment]) => {
        const refs = segment.tokens.map(({ ref }) => ref);
        const placed = [
          ...(this.placement.bySegment.get(segment.id) ?? []),
          ...(this.placement.orphanedAfter.get(segment.id) ?? []),
          ...(index === 0 ? this.placement.orphanedAhead : []),
        ];
        return (
          segment.tokens
            .filter(isWordToken)
            .some(({ surfaceText }) => formSet.has(normalizeSurfaceForm(surfaceText))) ||
          reads(recordsOf(this.tokenLinks, idsUnder(this.tokenLinksByRef, refs))) ||
          reads(recordsOf(this.phraseLinks, idsUnder(this.phraseLinksByRef, refs))) ||
          reads(recordsOf(this.segmentLinks, idsUnder(this.segmentLinksBySegment, [segment.id]))) ||
          placed.some((id) => ids.has(id))
        );
      })
      .map(([index]) => index);
  }

  /** Whether the segment at outline index `index` is held. */
  holds(index: number): boolean {
    return this.segments.has(index);
  }

  /**
   * Takes in a page fetched by a request sent at {@link RecordCache.revision} `sentAt`. Any record
   * or pool bucket that a reply has written or removed since then stays as that reply left it.
   */
  absorb(page: SegmentPage, sentAt: number): void {
    const isFresh = (key: string) => (this.writtenAt.get(key) ?? -1) <= sentAt;
    page.segments.forEach((segment, offset) => this.holdSegment(page.start + offset, segment));
    const { analysis } = page;
    /* v8 ignore next -- defensive: a session's pages always carry their analysis */
    if (!analysis) return;
    const refs = page.segments.flatMap((segment) => segment.tokens.map(({ ref }) => ref));
    const segmentIds = page.segments.map(({ id }) => id);

    const putFresh = <T extends { id: string }>(
      kind: string,
      table: Table<T>,
      list: readonly T[],
    ) => {
      list.forEach((record) => {
        if (isFresh(`${kind}:${record.id}`)) this.put(kind, table, record);
      });
      return new Set(list.map(({ id }) => id));
    };
    const fetchedTokenLinks = putFresh('tokenLink', this.tokenLinks, analysis.tokenAnalysisLinks);
    const fetchedPhraseLinks = putFresh(
      'phraseLink',
      this.phraseLinks,
      analysis.phraseAnalysisLinks,
    );
    const fetchedSegmentLinks = putFresh(
      'segmentLink',
      this.segmentLinks,
      analysis.segmentAnalysisLinks,
    );
    putFresh('tokenAnalysis', this.tokenAnalyses, analysis.tokenAnalyses);
    putFresh('phraseAnalysis', this.phraseAnalyses, analysis.phraseAnalyses);
    putFresh('segmentAnalysis', this.segmentAnalyses, analysis.segmentAnalyses);

    const removeMissing = (
      kind: string,
      table: Table<{ id: string }>,
      held: Iterable<string>,
      fetched: ReadonlySet<string>,
    ) =>
      [...held].forEach((id) => {
        if (!fetched.has(id) && isFresh(`${kind}:${id}`)) this.remove(kind, table, id);
      });
    removeMissing(
      'tokenLink',
      this.tokenLinks,
      idsUnder(this.tokenLinksByRef, refs),
      fetchedTokenLinks,
    );
    removeMissing(
      'phraseLink',
      this.phraseLinks,
      idsUnder(this.phraseLinksByRef, refs),
      fetchedPhraseLinks,
    );
    removeMissing(
      'segmentLink',
      this.segmentLinks,
      idsUnder(this.segmentLinksBySegment, segmentIds),
      fetchedSegmentLinks,
    );

    Object.entries(analysis.poolBuckets).forEach(([form, bucket]) => {
      if (isFresh(`bucket:${form}`)) this.poolBuckets.set(form, bucket);
    });
    Object.values(analysis.phraseSpans)
      .flat()
      .forEach((spanned) => this.spanTokens.set(spanned.token.ref, spanned));
    this.place(segmentIds, analysis.staleFreeTranslations, page.start === 0);
  }

  /**
   * Applies a command's reply.
   *
   * @returns `'outline'` when the reply moved the book's boundaries. `'placement'` when the reply
   *   touched a stale free translation, or removed a free translation that the cache does not hold.
   *   The cache cannot place stale translations or count orphaned cards. `'pages'` when the reply
   *   put a phrase link over a token that the cache does not hold. Otherwise `'none'`.
   */
  apply({ changes, poolBuckets, poolAnalyses, resegmentedBooks }: CommandReply): Refetch {
    this.revision += 1;
    const segmentLinks = changes.segmentAnalysisLinks;
    const reachesStale =
      [
        ...(segmentLinks?.puts ?? []),
        ...(segmentLinks?.puts ?? []).flatMap(({ id }) => this.segmentLinks.get(id) ?? []),
      ].some(({ status }) => status === 'stale') ||
      (segmentLinks?.deletes ?? []).some((id) => {
        const held = this.segmentLinks.get(id);
        return !held || held.status === 'stale';
      });
    const reachesUnheld = (changes.phraseAnalysisLinks?.puts ?? []).some(({ tokens }) =>
      tokens.some(({ tokenRef }) => !this.spanTokens.has(tokenRef)),
    );
    let refetch: Refetch = 'none';
    if (resegmentedBooks.includes(this.outlineHeld.bookRef)) refetch = 'outline';
    else if (reachesStale) refetch = 'placement';
    else if (reachesUnheld) refetch = 'pages';

    this.write('tokenLink', this.tokenLinks, changes.tokenAnalysisLinks);
    this.write('phraseLink', this.phraseLinks, changes.phraseAnalysisLinks);
    this.write('segmentLink', this.segmentLinks, changes.segmentAnalysisLinks);
    this.write('tokenAnalysis', this.tokenAnalyses, changes.tokenAnalyses);
    this.write('phraseAnalysis', this.phraseAnalyses, changes.phraseAnalyses);
    this.write('segmentAnalysis', this.segmentAnalyses, changes.segmentAnalyses);
    this.write('tokenAnalysis', this.tokenAnalyses, { puts: poolAnalyses, deletes: [] });
    Object.entries(poolBuckets).forEach(([form, bucket]) => {
      this.poolBuckets.set(form, bucket);
      this.writtenAt.set(`bucket:${form}`, this.revision);
    });
    return refetch;
  }

  /**
   * Serves the segments at outline indexes `[start, end)` with their analysis, as the host would
   * page them. Returns `undefined` unless every one of those segments is held.
   */
  pageAt(start: number, end: number): SegmentPage | undefined {
    const from = Math.max(0, start);
    const to = Math.min(this.outlineHeld.segments.length, end);
    const segments: Segment[] = [];
    for (let index = from; index < to; index += 1) {
      const segment = this.segments.get(index);
      if (!segment) return undefined;
      segments.push(segment);
    }
    const tokens = segments.flatMap((segment) => segment.tokens);
    const refs = tokens.map(({ ref }) => ref);
    const tokenAnalysisLinks = recordsOf(this.tokenLinks, idsUnder(this.tokenLinksByRef, refs));
    const phraseAnalysisLinks = recordsOf(this.phraseLinks, idsUnder(this.phraseLinksByRef, refs));
    const staleFreeTranslations = this.placedAmong(segments, from === 0);
    const placed = new Set(
      [
        ...Object.values(staleFreeTranslations.bySegment),
        ...Object.values(staleFreeTranslations.orphanedAfter),
        staleFreeTranslations.orphanedAhead,
      ].flat(),
    );
    const segmentAnalysisLinks = recordsOf(this.segmentLinks, [
      ...idsUnder(
        this.segmentLinksBySegment,
        segments.map(({ id }) => id),
      ),
      ...[...this.segmentLinks.values()]
        .filter(({ analysisId }) => placed.has(analysisId))
        .map(({ id }) => id),
    ]);
    const poolBuckets: Record<string, readonly PoolEntryRef[]> = {};
    tokens.filter(isWordToken).forEach(({ surfaceText }) => {
      const form = normalizeSurfaceForm(surfaceText);
      /* v8 ignore next -- each held page brought the bucket of every form it reads */
      poolBuckets[form] = this.poolBuckets.get(form) ?? [];
    });
    const phraseSpans = Object.fromEntries(
      phraseAnalysisLinks.map(({ id, tokens: members }) => [
        id,
        members.flatMap(({ tokenRef }) => this.spanTokens.get(tokenRef) ?? []),
      ]),
    );
    return {
      textVersion: this.outlineHeld.textVersion,
      start: from,
      segments,
      analysis: {
        tokenAnalysisLinks,
        phraseAnalysisLinks,
        segmentAnalysisLinks,
        tokenAnalyses: recordsOf(this.tokenAnalyses, [
          ...tokenAnalysisLinks.map(({ analysisId }) => analysisId),
          ...Object.values(poolBuckets)
            .flat()
            .map(({ analysisId }) => analysisId),
        ]),
        phraseAnalyses: recordsOf(
          this.phraseAnalyses,
          phraseAnalysisLinks.map(({ analysisId }) => analysisId),
        ),
        segmentAnalyses: recordsOf(
          this.segmentAnalyses,
          segmentAnalysisLinks.map(({ analysisId }) => analysisId),
        ),
        poolBuckets,
        staleFreeTranslations,
        phraseSpans,
      },
    };
  }

  /** Holds `segment` at outline index `index`, noting where each of its word tokens sits. */
  private holdSegment(index: number, segment: Segment): void {
    this.segments.set(index, segment);
    let docOrder = this.outlineHeld.segments
      .slice(0, index)
      .reduce((sum, { wordTokenCount }) => sum + wordTokenCount, 0);
    let previous: { charEnd: number } | undefined;
    segment.tokens.filter(isWordToken).forEach((token) => {
      const gapText = previous && segment.baselineText.slice(previous.charEnd, token.charStart);
      this.spanTokens.set(token.ref, {
        token,
        segmentId: segment.id,
        docOrder,
        ...(gapText !== undefined && { gapText }),
      });
      docOrder += 1;
      previous = token;
    });
  }

  /** Files the stale free-translation placement that a page reports, replacing what was held. */
  private place(segmentIds: readonly string[], placed: PlacedFreeTranslations, isFirst: boolean) {
    segmentIds.forEach((id) => {
      this.placement.bySegment.delete(id);
      this.placement.orphanedAfter.delete(id);
      const reviewed = placed.bySegment[id];
      if (reviewed) this.placement.bySegment.set(id, reviewed);
      const orphaned = placed.orphanedAfter[id];
      if (orphaned) this.placement.orphanedAfter.set(id, orphaned);
    });
    if (isFirst) this.placement.orphanedAhead = placed.orphanedAhead;
  }

  private placedAmong(segments: readonly Segment[], isFirst: boolean): PlacedFreeTranslations {
    const bySegment: Record<string, readonly string[]> = {};
    const orphanedAfter: Record<string, readonly string[]> = {};
    segments.forEach(({ id }) => {
      const reviewed = this.placement.bySegment.get(id);
      if (reviewed) bySegment[id] = reviewed;
      const orphaned = this.placement.orphanedAfter.get(id);
      if (orphaned) orphanedAfter[id] = orphaned;
    });
    return { bySegment, orphanedAfter, orphanedAhead: isFirst ? this.placement.orphanedAhead : [] };
  }

  private write<T extends { id: string }>(
    kind: string,
    table: Table<T>,
    changes: { puts: readonly T[]; deletes: readonly string[] } | undefined,
  ): void {
    changes?.puts.forEach((record) => {
      this.put(kind, table, record);
      this.writtenAt.set(`${kind}:${record.id}`, this.revision);
    });
    changes?.deletes.forEach((id) => {
      this.remove(kind, table, id);
      this.writtenAt.set(`${kind}:${id}`, this.revision);
    });
  }

  private put<T extends { id: string }>(kind: string, table: Table<T>, record: T): void {
    this.remove(kind, table, record.id);
    table.set(record.id, record);
    this.keysOf(kind, record.id).forEach(([index, key]) => fileUnder(index, key, record.id));
  }

  private remove<T extends { id: string }>(kind: string, table: Table<T>, id: string): void {
    if (!table.has(id)) return;
    this.keysOf(kind, id).forEach(([index, key]) => unfileFrom(index, key, id));
    table.delete(id);
  }

  /** The index entries for the `kind` record stored under `id`; none for a payload. */
  private keysOf(kind: string, id: string): [Map<string, Set<string>>, string][] {
    const tokenLink = kind === 'tokenLink' ? this.tokenLinks.get(id) : undefined;
    const phraseLink = kind === 'phraseLink' ? this.phraseLinks.get(id) : undefined;
    const segmentLink = kind === 'segmentLink' ? this.segmentLinks.get(id) : undefined;
    return [
      ...(tokenLink ? [[this.tokenLinksByRef, tokenLink.token.tokenRef] as const] : []),
      ...(phraseLink?.tokens ?? []).map(
        ({ tokenRef }) => [this.phraseLinksByRef, tokenRef] as const,
      ),
      ...(segmentLink ? [[this.segmentLinksBySegment, segmentLink.segmentId] as const] : []),
    ].map(([index, key]) => [index, key]);
  }
}
