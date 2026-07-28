import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { FocusContext } from './token-layout';

/**
 * A {@link TextAnalysis} with every analysis and link collection empty. Each call returns a fresh
 * object, so callers may mutate the result without affecting other instances.
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

/**
 * An empty {@link DraftProject} for a source project: empty analysis, no analysis languages yet, and
 * not dirty. Used as the fallback when no draft has been written and as the seed for the "New"
 * (reset) flow. Each call returns a fresh object with its own analysis.
 *
 * @param sourceProjectId - The Platform.Bible source project ID the draft belongs to.
 */
export function emptyDraft(sourceProjectId: string): DraftProject {
  return {
    sourceProjectId,
    analysisLanguages: [],
    analysis: emptyAnalysis(),
    dirty: false,
  };
}

/**
 * A {@link FocusContext} representing "nothing is focused". Each call returns a fresh object, so
 * callers never share a reference.
 */
export function emptyFocusContext(): FocusContext {
  return {
    focusedToken: undefined,
    focusedPhraseLink: undefined,
    focusedFreeToken: undefined,
    focusedSegmentId: undefined,
    focusedPhraseId: undefined,
  };
}
