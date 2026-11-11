import type {
  Book,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TokenAnalysis,
} from 'interlinearizer';
import type { AnalysisRepository } from '../types/analysis-repository';
import type { AppliedChange } from './analysisChanges';
import type {
  BookOutline,
  PhraseSpanToken,
  PoolRead,
  SegmentPage,
  StaleGlossPlace,
  StaleSummary,
} from '../types/segment-pages';
import { isWordToken } from '../types/type-guards';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { bookIndexesOf } from '../utils/book-indexes';
import { buildBookOutline } from '../utils/book-outline';
import { outlineBoundaries } from '../utils/segmentation';
import { touched } from '../utils/change-set';
import {
  orphanedCardCountAt,
  placedAmong,
  placedIdsIn,
  placeStaleFreeTranslations,
  type PlacedStaleFreeTranslations,
  type StaleFreeTranslation,
} from '../utils/stale-free-translations';
import { buildPoolIndex } from '../utils/suggestion-engine';

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

/** A stale free translation, with the link it was read from. */
type StaleLink = StaleFreeTranslation & Readonly<{ link: SegmentAnalysisLink }>;

const NOTHING_PLACED: PlacedStaleFreeTranslations<StaleLink> = {
  bySegment: new Map(),
  orphanedAfter: new Map(),
  orphanedAhead: [],
};

/** The book's stale free translations, placed, with the links and payloads they were read from. */
type StalePlacement = {
  placed: PlacedStaleFreeTranslations<StaleLink>;
  links: SegmentAnalysisLink[];
  payloads: SegmentAnalysis[];
};

/**
 * Places the stale free translations of `book` as the view does, reading the book's stale segment
 * links from `repository` unless given them. A stale link whose payload is not stored is passed
 * over.
 *
 * @throws Whatever the repository's lookups throw.
 */
async function readStalePlacement(
  repository: AnalysisRepository,
  book: Book,
  segmentAnalysisLinks?: SegmentAnalysisLink[],
): Promise<StalePlacement> {
  const staleLinks =
    segmentAnalysisLinks ??
    (await repository.findLinksInBooks([book.bookRef], ['stale'])).segmentAnalysisLinks;
  const payloads = await repository.getSegmentAnalyses(
    staleLinks.map(({ analysisId }) => analysisId),
  );
  const stored = new Set(payloads.map(({ id }) => id));
  const links = staleLinks.filter(({ analysisId }) => stored.has(analysisId));
  // Placing walks the whole book; a book holding no stale translation skips the walk.
  if (links.length === 0) return { placed: NOTHING_PLACED, links, payloads };
  const stale = links.map((link) => ({
    analysisId: link.analysisId,
    segmentId: link.segmentId,
    text: '',
    link,
  }));
  return { placed: placeStaleFreeTranslations(stale, book), links, payloads };
}

/** A book's stale analyses, summarized, with its stale free translations placed. */
type StaleRead = { summary: StaleSummary; placed: PlacedStaleFreeTranslations<StaleLink> };

/**
 * Reads the stale analyses that `book` holds. A stale link whose payload is not stored is passed
 * over.
 *
 * @throws Whatever the repository's lookups throw.
 */
async function readStale(repository: AnalysisRepository, book: Book): Promise<StaleRead> {
  const { tokenAnalysisLinks, segmentAnalysisLinks } = await repository.findLinksInBooks(
    [book.bookRef],
    ['stale'],
  );
  const stored = new Set(
    (await repository.getTokenAnalyses(tokenAnalysisLinks.map(({ analysisId }) => analysisId))).map(
      ({ id }) => id,
    ),
  );
  const places = new Map<string, StaleGlossPlace>();
  tokenAnalysisLinks.forEach(({ analysisId, token: { tokenRef } }) => {
    if (stored.has(analysisId))
      places.set(JSON.stringify([analysisId, tokenRef]), { analysisId, tokenRef });
  });
  const { tokenDocOrder } = bookIndexesOf(book.segments);
  const orderOf = ({ tokenRef }: StaleGlossPlace) =>
    tokenDocOrder.get(tokenRef) ?? Number.MAX_SAFE_INTEGER;
  const { placed } = await readStalePlacement(repository, book, segmentAnalysisLinks);
  const { bySegment, orphanedAfter, orphanedAhead } = placed;
  return {
    summary: {
      glosses: [...places.values()].sort((a, b) => orderOf(a) - orderOf(b)),
      freeTranslations: book.segments.flatMap(({ id: segmentId }, index) =>
        [
          ...(index === 0 ? orphanedAhead : []),
          ...(bySegment.get(segmentId) ?? []),
          ...(orphanedAfter.get(segmentId) ?? []),
        ].map(({ analysisId }) => ({ analysisId, segmentId })),
      ),
    },
    placed,
  };
}

/** For each of `links`, by id, the word tokens of the link that `book` holds, with where each sits. */
function spansOf(
  book: Book,
  links: readonly PhraseAnalysisLink[],
): Record<string, readonly PhraseSpanToken[]> {
  const { wordTokenByRef, tokenSegmentMap, tokenDocOrder, gapTextByWordRef } = bookIndexesOf(
    book.segments,
  );
  return Object.fromEntries(
    links.map(({ id, tokens }) => [
      id,
      tokens.flatMap(({ tokenRef }): PhraseSpanToken[] => {
        const token = wordTokenByRef.get(tokenRef);
        const segmentId = tokenSegmentMap.get(tokenRef);
        const docOrder = tokenDocOrder.get(tokenRef);
        if (!token || segmentId === undefined || docOrder === undefined) return [];
        const gapText = gapTextByWordRef.get(tokenRef);
        return [{ token, segmentId, docOrder, ...(gapText !== undefined && { gapText }) }];
      }),
    ]),
  );
}

/**
 * Outlines a book, counting the orphaned free-translation cards that the view shows beside each
 * segment and flagging the segments where it shows a stale analysis. Each count takes in the cards
 * after its segment; the first also takes in those ahead of it. The outline also says what the
 * book's boundary controls need to know of the draft's boundaries.
 *
 * @param repository - The draft whose stale analyses are counted and flagged.
 * @param book - The book, segmented by the draft's boundaries.
 * @param verseBook - The same book, one segment per verse.
 * @throws Whatever the repository's lookups throw.
 */
export async function readBookOutline(
  repository: AnalysisRepository,
  book: Book,
  verseBook: Book,
): Promise<BookOutline> {
  const { summary, placed } = await readStale(repository, book);
  const { tokenSegmentMap } = bookIndexesOf(book.segments);
  const glossSegments = new Set(
    summary.glosses.map(({ tokenRef }) => tokenSegmentMap.get(tokenRef)),
  );
  const translationSegments = new Set(summary.freeTranslations.map(({ segmentId }) => segmentId));
  const outline = buildBookOutline(book, book.segments);
  return {
    ...outline,
    boundaries: outlineBoundaries(verseBook, (await repository.getScope()).segmentation),
    segments: outline.segments.map((segment, index) => ({
      ...segment,
      orphanedCardCount: orphanedCardCountAt(placed, segment.id, index),
      hasStaleGloss: glossSegments.has(segment.id),
      hasStaleFreeTranslation: translationSegments.has(segment.id),
    })),
  };
}

/**
 * Summarizes the stale analyses that `book` holds. A stale link whose payload is not stored is
 * passed over.
 *
 * @param repository - The draft whose stale analyses are summarized.
 * @param book - The book, segmented by the draft's boundaries.
 * @throws Whatever the repository's lookups throw.
 */
export async function readStaleSummary(
  repository: AnalysisRepository,
  book: Book,
): Promise<StaleSummary> {
  return (await readStale(repository, book)).summary;
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
  const segmentIds = segments.map(({ id }) => id);
  const staleFreeTranslations = placedAmong(
    placement.placed,
    segmentIds,
    from === 0,
    ({ analysisId }) => analysisId,
  );
  const placedIds = placedIdsIn(staleFreeTranslations);
  const placedLinkIds = placedIdsIn(
    placedAmong(placement.placed, segmentIds, from === 0, ({ link }) => link.id),
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
        ...placement.links.filter(({ id }) => placedLinkIds.has(id)),
      ]),
      tokenAnalyses: uniqueById([...linked, ...poolAnalyses]),
      phraseAnalyses,
      segmentAnalyses: uniqueById([
        ...segmentAnalyses,
        ...placement.payloads.filter(({ id }) => placedIds.has(id)),
      ]),
      poolBuckets,
      staleFreeTranslations,
      phraseSpans: spansOf(book, phraseAnalysisLinks),
    },
  };
}

/**
 * The normalized surface forms whose pool buckets an applied change may have changed, sorted. They
 * are the forms of each token payload that the change or its inverse puts. They also include the
 * form of the payload named by each token link that the change or its inverse puts.
 *
 * @throws Whatever the repository's lookups throw.
 */
export async function touchedForms(
  repository: AnalysisRepository,
  { changes, inverse }: AppliedChange,
): Promise<string[]> {
  const payloads = touched(changes.tokenAnalyses, inverse.tokenAnalyses);
  const known = new Set(payloads.map(({ id }) => id));
  const linkedIds = touched(changes.tokenAnalysisLinks, inverse.tokenAnalysisLinks)
    .map(({ analysisId }) => analysisId)
    .filter((id) => !known.has(id));
  const linked =
    linkedIds.length > 0 ? await repository.getTokenAnalyses([...new Set(linkedIds)]) : [];
  return [
    ...new Set(
      [...payloads, ...linked].map(({ surfaceText }) => normalizeSurfaceForm(surfaceText)),
    ),
  ].sort();
}

/**
 * Reads the pool buckets that an applied change may have changed, from `repository` as the change
 * leaves it.
 *
 * @throws Whatever the repository's lookups throw.
 */
export async function readTouchedPoolBuckets(
  repository: AnalysisRepository,
  applied: AppliedChange,
): Promise<PoolRead> {
  const forms = await touchedForms(repository, applied);
  if (forms.length === 0) return { poolBuckets: {}, poolAnalyses: [] };
  return readPoolBuckets(repository, forms);
}
