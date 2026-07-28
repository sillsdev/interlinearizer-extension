import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';

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
 * Returns a copy of the analysis, unmutated, with every record belonging to the book removed.
 *
 * A token- or segment-level record is dropped when its referenced token or segment is in the book;
 * a phrase is dropped when **any** of its member tokens is, so a rare cross-book phrase goes when
 * either side is wiped. Analysis payloads left unreferenced by a surviving link are dropped too, so
 * no orphans remain.
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
 * Returns a copy of the delta with every boundary anchor belonging to the book removed, so wiping a
 * book also drops its custom segment boundaries.
 *
 * Yields `undefined` when no other book's anchors remain, so an emptied delta collapses back to the
 * default segmentation rather than persisting empty arrays.
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
