import type { TextAnalysis } from 'interlinearizer';
import type { InterlinearProjectSummary } from './interlinear-project-summary';

/**
 * Type guard for {@link InterlinearProjectSummary} parsed from unknown JSON.
 *
 * @param p - The value to test, typically a parsed JSON object of unknown shape.
 * @returns `true` if `p` satisfies the {@link InterlinearProjectSummary} shape, narrowing its type
 *   accordingly.
 */
export function isInterlinearProjectSummary(p: unknown): p is InterlinearProjectSummary {
  return (
    !!p &&
    typeof p === 'object' &&
    'id' in p &&
    typeof p.id === 'string' &&
    'createdAt' in p &&
    typeof p.createdAt === 'string' &&
    'sourceProjectId' in p &&
    typeof p.sourceProjectId === 'string' &&
    'analysisLanguages' in p &&
    Array.isArray(p.analysisLanguages) &&
    p.analysisLanguages.every((l) => typeof l === 'string') &&
    (!('name' in p) || typeof p.name === 'string') &&
    (!('description' in p) || typeof p.description === 'string') &&
    (!('targetProjectId' in p) || typeof p.targetProjectId === 'string')
  );
}

/**
 * Type guard for {@link TextAnalysis} parsed from unknown JSON.
 *
 * @param value - The value to test, typically a parsed JSON object of unknown shape.
 * @returns `true` if `value` satisfies the {@link TextAnalysis} shape, narrowing its type
 *   accordingly.
 */
export function isTextAnalysis(value: unknown): value is TextAnalysis {
  return (
    !!value &&
    typeof value === 'object' &&
    'segmentAnalyses' in value &&
    Array.isArray(value.segmentAnalyses) &&
    'segmentAnalysisLinks' in value &&
    Array.isArray(value.segmentAnalysisLinks) &&
    'tokenAnalyses' in value &&
    Array.isArray(value.tokenAnalyses) &&
    'tokenAnalysisLinks' in value &&
    Array.isArray(value.tokenAnalysisLinks) &&
    'phraseAnalyses' in value &&
    Array.isArray(value.phraseAnalyses) &&
    'phraseAnalysisLinks' in value &&
    Array.isArray(value.phraseAnalysisLinks)
  );
}
