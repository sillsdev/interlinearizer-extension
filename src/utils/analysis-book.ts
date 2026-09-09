import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';
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
 * Partition key for payloads no link references, which describe a spelling rather than any one
 * occurrence and so belong to no book. Its space cannot occur in a book code, so it never collides
 * with one.
 */
export const BOOKLESS_PARTITION = 'no book';

/**
 * Splits an analysis into self-contained partitions, one per book that carries records. A phrase
 * spanning two books lands in exactly one of them; a payload shared across books is copied into
 * every partition linking it. Payloads no link references are partitioned together under
 * {@link BOOKLESS_PARTITION}, so an inventory belonging to no book is still carried.
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
 * A token- or segment-level record is dropped when its referenced token or segment is in the book;
 * a phrase is dropped when **any** of its member tokens is, so a rare cross-book phrase goes when
 * either side is wiped. A payload the wipe leaves unreferenced is dropped with it, so no orphans
 * remain; one that no link referenced beforehand belongs to no book and survives.
 */
export function removeBookFromAnalysis(analysis: TextAnalysis, bookCode: string): TextAnalysis {
  const tokenAnalysisLinks = analysis.tokenAnalysisLinks.filter(
    (link) => bookOfRef(link.token.tokenRef) !== bookCode,
  );
  const segmentAnalysisLinks = analysis.segmentAnalysisLinks.filter(
    (link) => bookOfRef(link.segmentId) !== bookCode,
  );
  const phraseAnalysisLinks = analysis.phraseAnalysisLinks.filter(
    (link) => !link.tokens.some((token) => bookOfRef(token.tokenRef) === bookCode),
  );

  const keeps = <T extends { id: string }>(
    surviving: readonly { analysisId: string }[],
    all: readonly { analysisId: string }[],
  ): ((payload: T) => boolean) => {
    const survivingIds = new Set(surviving.map((link) => link.analysisId));
    const linkedIds = new Set(all.map((link) => link.analysisId));
    return ({ id }) => survivingIds.has(id) || !linkedIds.has(id);
  };

  return {
    tokenAnalyses: analysis.tokenAnalyses.filter(
      keeps(tokenAnalysisLinks, analysis.tokenAnalysisLinks),
    ),
    tokenAnalysisLinks,
    segmentAnalyses: analysis.segmentAnalyses.filter(
      keeps(segmentAnalysisLinks, analysis.segmentAnalysisLinks),
    ),
    segmentAnalysisLinks,
    phraseAnalyses: analysis.phraseAnalyses.filter(
      keeps(phraseAnalysisLinks, analysis.phraseAnalysisLinks),
    ),
    phraseAnalysisLinks,
  };
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
