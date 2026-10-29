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
import { indexSegmentTokens, type TokenIndexes } from '../utils/book-indexes';
import { RecordTable } from '../utils/record-table';
import { placedAmong, placedIdsIn } from '../utils/stale-free-translations';

/**
 * What a reply leaves to fetch again: nothing, the held pages, the held pages with the outline's
 * orphaned-card counts, or the outline along with each view's latest range.
 */
export type Refetch = 'none' | 'pages' | 'placement' | 'outline';

function firstWordsOf({ segments }: BookOutline): number[] {
  let words = 0;
  return segments.map(({ wordTokenCount }) => {
    const first = words;
    words += wordTokenCount;
    return first;
  });
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

  private readonly tokenLinks = new RecordTable<TokenAnalysisLink, 'tokenRef'>(
    'tokenLink',
    { tokenRef: ({ token }) => [token.tokenRef] },
    [],
  );

  private readonly phraseLinks = new RecordTable<PhraseAnalysisLink, 'tokenRef'>(
    'phraseLink',
    { tokenRef: ({ tokens }) => tokens.map(({ tokenRef }) => tokenRef) },
    [],
  );

  private readonly segmentLinks = new RecordTable<SegmentAnalysisLink, 'segmentId' | 'analysisId'>(
    'segmentLink',
    { segmentId: ({ segmentId }) => [segmentId], analysisId: ({ analysisId }) => [analysisId] },
    [],
  );

  private readonly tokenAnalyses = new RecordTable<TokenAnalysis, never>('tokenAnalysis', {}, []);

  private readonly phraseAnalyses = new RecordTable<PhraseAnalysis, never>(
    'phraseAnalysis',
    {},
    [],
  );

  private readonly segmentAnalyses = new RecordTable<SegmentAnalysis, never>(
    'segmentAnalysis',
    {},
    [],
  );

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

  /** Where each outline segment's word tokens start among the book's word tokens. */
  private firstWordAt: number[];

  constructor(outline: BookOutline) {
    this.outlineHeld = outline;
    this.firstWordAt = firstWordsOf(outline);
  }

  /** The outline that the held pages were cut by. */
  get outline(): BookOutline {
    return this.outlineHeld;
  }

  /** Takes a fresh outline and lets go of every held page, because their indexes may have moved. */
  replaceOutline(outline: BookOutline): void {
    this.outlineHeld = outline;
    this.firstWordAt = firstWordsOf(outline);
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
          reads(this.tokenLinks.find('tokenRef', refs)) ||
          reads(this.phraseLinks.find('tokenRef', refs)) ||
          reads(this.segmentLinks.find('segmentId', [segment.id])) ||
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

    const putFresh = <T extends { id: string }, I extends string>(
      kind: string,
      table: RecordTable<T, I>,
      list: readonly T[],
    ) => {
      list.forEach((record) => {
        if (isFresh(`${kind}:${record.id}`)) table.put(record);
      });
      return new Set(list.map(({ id }) => id));
    };
    const removeMissing = <T extends { id: string }, I extends string>(
      kind: string,
      table: RecordTable<T, I>,
      held: readonly T[],
      fetched: ReadonlySet<string>,
    ) =>
      held.forEach(({ id }) => {
        if (!fetched.has(id) && isFresh(`${kind}:${id}`)) table.remove(id);
      });
    removeMissing(
      'tokenLink',
      this.tokenLinks,
      this.tokenLinks.find('tokenRef', refs),
      putFresh('tokenLink', this.tokenLinks, analysis.tokenAnalysisLinks),
    );
    removeMissing(
      'phraseLink',
      this.phraseLinks,
      this.phraseLinks.find('tokenRef', refs),
      putFresh('phraseLink', this.phraseLinks, analysis.phraseAnalysisLinks),
    );
    removeMissing(
      'segmentLink',
      this.segmentLinks,
      this.segmentLinks.find('segmentId', segmentIds),
      putFresh('segmentLink', this.segmentLinks, analysis.segmentAnalysisLinks),
    );
    putFresh('tokenAnalysis', this.tokenAnalyses, analysis.tokenAnalyses);
    putFresh('phraseAnalysis', this.phraseAnalyses, analysis.phraseAnalyses);
    putFresh('segmentAnalysis', this.segmentAnalyses, analysis.segmentAnalyses);

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
   * @returns The first that applies: `'outline'` when the reply moved the book's boundaries,
   *   `'placement'` when it put or removed a stale free translation in the book, and `'pages'` when
   *   it put a phrase link over a token the cache does not hold. Otherwise `'none'`.
   */
  apply({
    changes,
    poolBuckets,
    poolAnalyses,
    resegmentedBooks,
    staleTranslationBooks,
  }: CommandReply): Refetch {
    this.revision += 1;
    const reachesUnheld = (changes.phraseAnalysisLinks?.puts ?? []).some(({ tokens }) =>
      tokens.some(({ tokenRef }) => !this.spanTokens.has(tokenRef)),
    );
    let refetch: Refetch = 'none';
    if (resegmentedBooks.includes(this.outlineHeld.bookRef)) refetch = 'outline';
    else if (staleTranslationBooks.includes(this.outlineHeld.bookRef)) refetch = 'placement';
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
    const tokenAnalysisLinks = this.tokenLinks.find('tokenRef', refs);
    const phraseAnalysisLinks = this.phraseLinks.find('tokenRef', refs);
    const staleFreeTranslations = placedAmong(
      this.placement,
      segments.map(({ id }) => id),
      from === 0,
      (id) => id,
    );
    const placed = placedIdsIn(staleFreeTranslations);
    const segmentAnalysisLinks = this.segmentLinks.get(
      [
        ...this.segmentLinks.find(
          'segmentId',
          segments.map(({ id }) => id),
        ),
        ...this.segmentLinks.find('analysisId', [...placed]),
      ].map(({ id }) => id),
    );
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
        tokenAnalyses: this.tokenAnalyses.get([
          ...tokenAnalysisLinks.map(({ analysisId }) => analysisId),
          ...Object.values(poolBuckets)
            .flat()
            .map(({ analysisId }) => analysisId),
        ]),
        phraseAnalyses: this.phraseAnalyses.get(
          phraseAnalysisLinks.map(({ analysisId }) => analysisId),
        ),
        segmentAnalyses: this.segmentAnalyses.get(
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
    const indexes: TokenIndexes = {
      tokenDocOrder: new Map(),
      fullTokenOrder: new Map(),
      gapTextByWordRef: new Map(),
      tokenSegmentMap: new Map(),
      wordTokenByRef: new Map(),
    };
    // Numbers tokens from 0 because only word positions are kept.
    indexSegmentTokens(segment, indexes, this.firstWordAt[index], 0);
    indexes.wordTokenByRef.forEach((token, ref) => {
      const gapText = indexes.gapTextByWordRef.get(ref);
      this.spanTokens.set(ref, {
        token,
        segmentId: segment.id,
        /* v8 ignore next -- the walk numbers every word token it files */
        docOrder: indexes.tokenDocOrder.get(ref) ?? 0,
        ...(gapText !== undefined && { gapText }),
      });
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

  private write<T extends { id: string }, I extends string>(
    kind: string,
    table: RecordTable<T, I>,
    changes: { puts: readonly T[]; deletes: readonly string[] } | undefined,
  ): void {
    changes?.puts.forEach((record) => {
      table.put(record);
      this.writtenAt.set(`${kind}:${record.id}`, this.revision);
    });
    changes?.deletes.forEach((id) => {
      table.remove(id);
      this.writtenAt.set(`${kind}:${id}`, this.revision);
    });
  }
}
