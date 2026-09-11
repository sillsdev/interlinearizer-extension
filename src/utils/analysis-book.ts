import type { SegmentationDelta, TextAnalysis, TokenSnapshot } from 'interlinearizer';
import { emptyAnalysis } from '../types/empty-factories';

/**
 * Returns the 3-letter book code embedded at the start of a segment id or token ref. Both are
 * formatted `"<book> <chapter>:<verse>[:<charStart>]"` (e.g. `"GEN 1:1"`, `"1JN 2:3:5"`). A string
 * with no space is returned whole.
 */
export function bookOfRef(ref: string): string {
  const spaceIndex = ref.indexOf(' ');
  return spaceIndex === -1 ? ref : ref.slice(0, spaceIndex);
}

/**
 * Reports whether a phrase's token run crosses a book boundary, which no valid phrase does: a
 * phrase belongs to a single book, and one crossing that boundary can be neither stored nor wiped
 * as a unit. An empty run crosses nothing.
 */
export function phraseSpansBooks(tokens: readonly TokenSnapshot[]): boolean {
  const first = tokens[0]?.tokenRef;
  if (first === undefined) return false;
  const book = bookOfRef(first);
  return tokens.some((token) => bookOfRef(token.tokenRef) !== book);
}

/**
 * Partition key for payloads no link references, which describe a spelling rather than any one
 * occurrence and so belong to no book. Its space cannot occur in a book code, so it never collides
 * with one.
 */
export const BOOKLESS_PARTITION = 'no book';

/**
 * Splits an analysis into self-contained partitions, one per book that carries records. A payload
 * shared across books is copied into every partition linking it. Payloads no link references are
 * partitioned together under {@link BOOKLESS_PARTITION}, so an inventory belonging to no book is
 * still carried.
 */
export function splitAnalysisByBook(analysis: TextAnalysis): Map<string, TextAnalysis> {
  const books = new Map<string, TextAnalysis>();
  const partitionFor = (bookCode: string): TextAnalysis => {
    const existing = books.get(bookCode);
    if (existing) return existing;
    const created = emptyAnalysis();
    books.set(bookCode, created);
    return created;
  };

  analysis.tokenAnalysisLinks.forEach((link) => {
    partitionFor(bookOfRef(link.token.tokenRef)).tokenAnalysisLinks.push(link);
  });
  analysis.segmentAnalysisLinks.forEach((link) => {
    partitionFor(bookOfRef(link.segmentId)).segmentAnalysisLinks.push(link);
  });
  analysis.phraseAnalysisLinks.forEach((link) => {
    // A phrase's tokens all share a book, so the first one places the whole run.
    partitionFor(bookOfRef(link.tokens[0].tokenRef)).phraseAnalysisLinks.push(link);
  });

  const tokenAnalysisById = new Map(analysis.tokenAnalyses.map((a) => [a.id, a]));
  const segmentAnalysisById = new Map(analysis.segmentAnalyses.map((a) => [a.id, a]));
  const phraseAnalysisById = new Map(analysis.phraseAnalyses.map((a) => [a.id, a]));

  const linkedIds = new Set<string>();
  books.forEach((partition) => {
    collectPayloads(partition.tokenAnalysisLinks, tokenAnalysisById, partition.tokenAnalyses);
    collectPayloads(partition.segmentAnalysisLinks, segmentAnalysisById, partition.segmentAnalyses);
    collectPayloads(partition.phraseAnalysisLinks, phraseAnalysisById, partition.phraseAnalyses);
    partition.tokenAnalyses.forEach(({ id }) => linkedIds.add(id));
    partition.segmentAnalyses.forEach(({ id }) => linkedIds.add(id));
    partition.phraseAnalyses.forEach(({ id }) => linkedIds.add(id));
  });

  const unlinked = emptyAnalysis();
  unlinked.tokenAnalyses = analysis.tokenAnalyses.filter(({ id }) => !linkedIds.has(id));
  unlinked.segmentAnalyses = analysis.segmentAnalyses.filter(({ id }) => !linkedIds.has(id));
  unlinked.phraseAnalyses = analysis.phraseAnalyses.filter(({ id }) => !linkedIds.has(id));
  if (
    unlinked.tokenAnalyses.length > 0 ||
    unlinked.segmentAnalyses.length > 0 ||
    unlinked.phraseAnalyses.length > 0
  )
    books.set(BOOKLESS_PARTITION, unlinked);

  return books;
}

/** Appends the payload each link resolves to, once per distinct id; unresolved links are skipped. */
function collectPayloads<T extends { id: string }>(
  links: readonly { analysisId: string }[],
  payloadById: ReadonlyMap<string, T>,
  into: T[],
): void {
  const seen = new Set<string>();
  links.forEach(({ analysisId }) => {
    if (seen.has(analysisId)) return;
    seen.add(analysisId);
    const payload = payloadById.get(analysisId);
    if (payload) into.push(payload);
  });
}

/**
 * Returns a copy of the analysis, unmutated, with every record belonging to the book removed.
 *
 * A record is dropped when the token, segment, or phrase it is attached to belongs to the book. A
 * payload the wipe leaves unreferenced is dropped with it, so no orphans remain; one that no link
 * referenced beforehand belongs to no book and survives.
 */
export function removeBookFromAnalysis(analysis: TextAnalysis, bookCode: string): TextAnalysis {
  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.filter(
    (link) => bookOfRef(link.token.tokenRef) !== bookCode,
  );
  const segmentAnalysisLinks = analysis.segmentAnalysisLinks.filter(
    (link) => bookOfRef(link.segmentId) !== bookCode,
  );
  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.filter(
    (link) => bookOfRef(link.tokens[0].tokenRef) !== bookCode,
  );

  return {
    tokenAnalyses: analysis.tokenAnalyses.filter(
      keepsPayload(tokenAnalysisLinks, analysis.tokenAnalysisLinks),
    ),
    tokenAnalysisLinks,
    segmentAnalyses: analysis.segmentAnalyses.filter(
      keepsPayload(segmentAnalysisLinks, analysis.segmentAnalysisLinks),
    ),
    segmentAnalysisLinks,
    phraseAnalyses: analysis.phraseAnalyses.filter(
      keepsPayload(phraseAnalysisLinks, analysis.phraseAnalysisLinks),
    ),
    phraseAnalysisLinks,
  };
}

/**
 * Returns a copy of the analysis, unmutated, with every phrase link whose token run crosses a book
 * boundary removed, and with the payloads that removal leaves unreferenced removed alongside them.
 * The analysis itself is returned when every phrase already lies within one book.
 *
 * No write path produces such a link, so one arrives only in a hand-edited or corrupted record,
 * where it would be stored under one of its books and stranded when the other is wiped.
 */
export function dropCrossBookPhrases(analysis: TextAnalysis): TextAnalysis {
  if (!analysis.phraseAnalysisLinks.some((link) => phraseSpansBooks(link.tokens))) return analysis;
  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.filter(
    (link) => !phraseSpansBooks(link.tokens),
  );
  return {
    ...analysis,
    phraseAnalyses: analysis.phraseAnalyses.filter(
      keepsPayload(phraseAnalysisLinks, analysis.phraseAnalysisLinks),
    ),
    phraseAnalysisLinks,
  };
}

/**
 * Builds the test for which payloads outlive a removal of links: one a surviving link still
 * references, or one no link referenced to begin with and so belongs to no book.
 */
function keepsPayload<T extends { id: string }>(
  surviving: readonly { analysisId: string }[],
  all: readonly { analysisId: string }[],
): (payload: T) => boolean {
  const survivingIds = new Set(surviving.map((link) => link.analysisId));
  const linkedIds = new Set(all.map((link) => link.analysisId));
  return ({ id }) => survivingIds.has(id) || !linkedIds.has(id);
}

/**
 * Returns a copy of the delta with every boundary anchor belonging to the book removed, so wiping a
 * book also drops its custom segment boundaries. The result is `undefined` when the delta is absent
 * or the removal empties it, so segmentation collapses back to the default rather than persisting
 * empty arrays.
 */
export function removeBookFromSegmentation(
  delta: SegmentationDelta | undefined,
  bookCode: string,
): SegmentationDelta | undefined {
  if (!delta) return undefined;
  const removedVerseStarts = delta.removedVerseStarts.filter((ref) => bookOfRef(ref) !== bookCode);
  const addedStarts = delta.addedStarts.filter((ref) => bookOfRef(ref) !== bookCode);
  if (removedVerseStarts.length === 0 && addedStarts.length === 0) return undefined;
  return { removedVerseStarts, addedStarts };
}
