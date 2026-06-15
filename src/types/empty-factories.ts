/**
 * @file Factory functions that return zero-value instances of core types, giving each caller a
 *   fresh independent object.
 */
import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { FocusContext } from './token-layout';

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

/**
 * Returns a fresh, empty {@link DraftProject} for a source project: empty analysis, no analysis
 * languages yet, and `dirty: false`. Used by the storage layer when no draft has been written and
 * as the seed for the "New" (reset) flow. Each call produces a fresh object with its own analysis.
 *
 * @param sourceProjectId - The Platform.Bible source project ID the draft belongs to.
 * @returns A new, empty `DraftProject` for the given source.
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
 * Returns a `FocusContext` with all fields set to `undefined`, representing the state where nothing
 * is focused. Each call produces a fresh object so callers can use it without sharing references.
 *
 * @returns A new, empty `FocusContext` object.
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
