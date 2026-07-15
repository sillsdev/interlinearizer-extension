/** @file Pure helpers for filtering a `TextAnalysis` by the book a record belongs to. */
import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';

/**
 * Returns the 3-letter book code embedded at the start of a segment id or token ref. Both are
 * formatted `"<book> <chapter>:<verse>[:<charStart>]"` (e.g. `"GEN 1:1"`, `"1JN 2:3:5"`), so the
 * book code is the substring before the first space.
 *
 * @param ref - A `Segment.id` or `Token.ref` / `TokenSnapshot.tokenRef` value.
 * @returns The leading book code, or the whole string when it contains no space.
 */
export function bookOfRef(ref: string): string {
  const spaceIndex = ref.indexOf(' ');
  return spaceIndex === -1 ? ref : ref.slice(0, spaceIndex);
}

/**
 * Returns a copy of `analysis` with every record belonging to `bookCode` removed. A token- or
 * segment-level record is dropped when its referenced token/segment is in the book; a phrase is
 * dropped when **any** of its member tokens is in the book (so a rare cross-book phrase is removed
 * when wiping either side). Analysis payloads left unreferenced by a surviving link are also
 * dropped, so no orphans remain.
 *
 * @param analysis - The analysis to filter. Not mutated.
 * @param bookCode - The 3-letter book code (e.g. `"GEN"`) whose records to remove.
 * @returns A new `TextAnalysis` with the book's records (and any orphaned payloads) removed.
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

  const survivingTokenAnalysisIds = new Set(tokenAnalysisLinks.map((link) => link.analysisId));
  const survivingSegmentAnalysisIds = new Set(segmentAnalysisLinks.map((link) => link.analysisId));
  const survivingPhraseAnalysisIds = new Set(phraseAnalysisLinks.map((link) => link.analysisId));

  return {
    tokenAnalyses: analysis.tokenAnalyses.filter((a) => survivingTokenAnalysisIds.has(a.id)),
    tokenAnalysisLinks,
    segmentAnalyses: analysis.segmentAnalyses.filter((a) => survivingSegmentAnalysisIds.has(a.id)),
    segmentAnalysisLinks,
    phraseAnalyses: analysis.phraseAnalyses.filter((a) => survivingPhraseAnalysisIds.has(a.id)),
    phraseAnalysisLinks,
  };
}

/**
 * Returns a copy of `delta` with every boundary anchor belonging to `bookCode` removed, so wiping a
 * book also drops its custom segment boundaries (the anchors are book-prefixed token refs, keyed
 * the same way as analysis records). Returns `undefined` when nothing for any other book remains,
 * so a wiped-then-emptied delta collapses to the default segmentation rather than persisting empty
 * arrays.
 *
 * @param delta - The current boundary delta, or `undefined` for the default segmentation.
 * @param bookCode - The 3-letter book code (e.g. `"GEN"`) whose anchors to remove.
 * @returns A new `SegmentationDelta` without the book's anchors, or `undefined` when the result is
 *   the default segmentation (or the input already was).
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
