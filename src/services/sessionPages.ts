import type {
  Book,
  Segment,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TokenAnalysis,
} from 'interlinearizer';
import type { AnalysisRepository } from '../types/analysis-repository';
import type { AppliedChange } from './analysisChanges';
import type {
  BookOutline,
  PlacedFreeTranslations,
  PoolBuckets,
  SegmentPage,
} from '../types/segment-pages';
import { isWordToken } from '../types/type-guards';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { buildBookOutline } from '../utils/book-outline';
import {
  placeStaleFreeTranslations,
  type PlacedStaleFreeTranslations,
  type StaleFreeTranslation,
} from '../utils/stale-free-translations';
import { buildPoolIndex } from '../utils/suggestion-engine';

/** Pool buckets, with the payloads they name. */
export type PoolRead = {
  poolBuckets: PoolBuckets;
  poolAnalyses: TokenAnalysis[];
};

/**
 * Reads the pool bucket of each of the normalized `forms`.
 *
 * @throws Whatever the repository's lookups throw.
 */
export async function readPoolBuckets(
  repository: AnalysisRepository,
  forms: readonly string[],
): Promise<PoolRead> {
  const analyses = await repository.findTokenAnalysesByForm([...forms]);
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
  const counts = new Map(Object.entries(await repository.countApprovals([...analysisById.keys()])));
  const index = buildPoolIndex(analysisById, counts);

  const poolBuckets: Record<string, { analysisId: string; frequency: number }[]> = {};
  const poolAnalyses: TokenAnalysis[] = [];
  forms.forEach((form) => {
    const bucket = index.get(form) ?? [];
    poolBuckets[form] = bucket.map(({ analysis, frequency }) => {
      poolAnalyses.push(analysis);
      return { analysisId: analysis.id, frequency };
    });
  });
  return { poolBuckets, poolAnalyses };
}

/** `records` with each id once, the first of each kept. */
function uniqueById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...new Map(records.toReversed().map((record) => [record.id, record])).values()];
}

const NOTHING_PLACED: PlacedStaleFreeTranslations = {
  bySegment: new Map(),
  orphanedAfter: new Map(),
  orphanedAhead: [],
};

/** The book's stale free translations, placed, with the links and payloads they were read from. */
type StalePlacement = {
  placed: PlacedStaleFreeTranslations;
  links: SegmentAnalysisLink[];
  payloads: SegmentAnalysis[];
};

/**
 * Places the stale free translations of `book` as the view does. A stale link whose payload is not
 * stored is passed over.
 *
 * @throws Whatever the repository's lookups throw.
 */
async function readStalePlacement(
  repository: AnalysisRepository,
  book: Book,
): Promise<StalePlacement> {
  const { segmentAnalysisLinks } = await repository.findLinksInBooks([book.bookRef], ['stale']);
  const payloads = await repository.getSegmentAnalyses(
    segmentAnalysisLinks.map(({ analysisId }) => analysisId),
  );
  const stored = new Set(payloads.map(({ id }) => id));
  const links = segmentAnalysisLinks.filter(({ analysisId }) => stored.has(analysisId));
  // Placing walks the whole book; a book holding no stale translation skips the walk.
  if (links.length === 0) return { placed: NOTHING_PLACED, links, payloads };
  const stale = links.map(({ analysisId, segmentId }) => ({ analysisId, segmentId, text: '' }));
  return { placed: placeStaleFreeTranslations(stale, book), links, payloads };
}

/** The analysis ids of `translations`; `undefined` when `translations` is. */
function idsIn(
  translations: readonly StaleFreeTranslation[] | undefined,
): readonly string[] | undefined {
  return translations?.map(({ analysisId }) => analysisId);
}

/**
 * The stale free translations that `placement` files among `segments`. Those ahead of every verse
 * come only with the book's first page.
 */
function placedAmong(
  { placed }: StalePlacement,
  segments: readonly Segment[],
  isFirstPage: boolean,
): PlacedFreeTranslations {
  const bySegment: Record<string, readonly string[]> = {};
  const orphanedAfter: Record<string, readonly string[]> = {};
  segments.forEach(({ id }) => {
    const reviewed = idsIn(placed.bySegment.get(id));
    if (reviewed) bySegment[id] = reviewed;
    const orphaned = idsIn(placed.orphanedAfter.get(id));
    if (orphaned) orphanedAfter[id] = orphaned;
  });
  const orphanedAhead = isFirstPage ? placed.orphanedAhead.map(({ analysisId }) => analysisId) : [];
  return { bySegment, orphanedAfter, orphanedAhead };
}

/**
 * Outlines a book, counting the orphaned free-translation cards that the view shows beside each
 * segment. Each count takes in the cards after its segment; the first also takes in those ahead of
 * it.
 *
 * @param repository - The draft whose stale free translations are counted.
 * @param book - The book, segmented by the draft's boundaries.
 * @throws Whatever the repository's lookups throw.
 */
export async function readBookOutline(
  repository: AnalysisRepository,
  book: Book,
): Promise<BookOutline> {
  const { placed } = await readStalePlacement(repository, book);
  const outline = buildBookOutline(book, book.segments);
  return {
    ...outline,
    segments: outline.segments.map((segment, index) => ({
      ...segment,
      orphanedCardCount:
        (index === 0 ? placed.orphanedAhead.length : 0) +
        (placed.orphanedAfter.get(segment.id)?.length ?? 0),
    })),
  };
}

/**
 * Serves a run of a book's segments with the analysis that the draft holds for them.
 *
 * @param repository - The draft whose analysis is served.
 * @param book - The book, segmented by the draft's boundaries.
 * @param start - Outline index of the first segment served.
 * @param end - Outline index just past the last segment served.
 * @throws Whatever the repository's lookups throw.
 */
export async function readSegmentPage(
  repository: AnalysisRepository,
  book: Book,
  start: number,
  end: number,
): Promise<SegmentPage> {
  const from = Math.max(0, start);
  const segments = book.segments.slice(from, Math.max(from, end));
  const tokens = segments.flatMap((segment) => segment.tokens);
  const { tokenAnalysisLinks, phraseAnalysisLinks } = await repository.findLinksByToken(
    tokens.map(({ ref }) => ref),
  );
  const segmentAnalysisLinks = await repository.findLinksBySegment(segments.map(({ id }) => id));
  const { poolBuckets, poolAnalyses } = await readPoolBuckets(repository, [
    ...new Set(tokens.filter(isWordToken).map((token) => normalizeSurfaceForm(token.surfaceText))),
  ]);
  const linked = await repository.getTokenAnalyses([
    ...new Set(tokenAnalysisLinks.map(({ analysisId }) => analysisId)),
  ]);
  const phraseAnalyses = await repository.getPhraseAnalyses([
    ...new Set(phraseAnalysisLinks.map(({ analysisId }) => analysisId)),
  ]);
  const segmentAnalyses = await repository.getSegmentAnalyses([
    ...new Set(segmentAnalysisLinks.map(({ analysisId }) => analysisId)),
  ]);
  const placement = await readStalePlacement(repository, book);
  const staleFreeTranslations = placedAmong(placement, segments, from === 0);
  const placedIds = new Set(
    [
      ...Object.values(staleFreeTranslations.bySegment),
      ...Object.values(staleFreeTranslations.orphanedAfter),
      staleFreeTranslations.orphanedAhead,
    ].flat(),
  );
  return {
    textVersion: book.textVersion,
    start: from,
    segments,
    analysis: {
      tokenAnalysisLinks,
      phraseAnalysisLinks,
      segmentAnalysisLinks: uniqueById([
        ...segmentAnalysisLinks,
        ...placement.links.filter(({ analysisId }) => placedIds.has(analysisId)),
      ]),
      tokenAnalyses: uniqueById([...linked, ...poolAnalyses]),
      phraseAnalyses,
      segmentAnalyses: uniqueById([
        ...segmentAnalyses,
        ...placement.payloads.filter(({ id }) => placedIds.has(id)),
      ]),
      poolBuckets,
      staleFreeTranslations,
    },
  };
}

/**
 * Reads the pool buckets that an applied change may have changed, from `repository` as the change
 * leaves it. They are the buckets of each token payload that the change or its inverse puts. They
 * also include the bucket of the payload named by each token link that the change or its inverse
 * puts.
 *
 * @throws Whatever the repository's lookups throw.
 */
export async function readTouchedPoolBuckets(
  repository: AnalysisRepository,
  { changes, inverse }: AppliedChange,
): Promise<PoolRead> {
  const payloads = [...(changes.tokenAnalyses?.puts ?? []), ...(inverse.tokenAnalyses?.puts ?? [])];
  const known = new Set(payloads.map(({ id }) => id));
  const linkedIds = [
    ...(changes.tokenAnalysisLinks?.puts ?? []),
    ...(inverse.tokenAnalysisLinks?.puts ?? []),
  ]
    .map(({ analysisId }) => analysisId)
    .filter((id) => !known.has(id));
  const linked =
    linkedIds.length > 0 ? await repository.getTokenAnalyses([...new Set(linkedIds)]) : [];
  const forms = new Set(
    [...payloads, ...linked].map(({ surfaceText }) => normalizeSurfaceForm(surfaceText)),
  );
  if (forms.size === 0) return { poolBuckets: {}, poolAnalyses: [] };
  return readPoolBuckets(repository, [...forms].sort());
}
