import type { TextAnalysis } from 'interlinearizer';

/**
 * Returns a `TextAnalysis` with empty collections for every analysis and link array. Each call
 * produces a fresh object so callers can mutate it without affecting other instances.
 *
 * @returns A new, empty `TextAnalysis` object.
 */
export function emptyAnalysis(): TextAnalysis {
  return {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [],
    tokenAnalysisLinks: [],
    phraseAnalyses: [],
    phraseAnalysisLinks: [],
  };
}
