/** @file Type guards for narrowing interlinearizer types and validating parsed JSON payloads. */
import type { AssignmentStatus, TextAnalysis, Token } from 'interlinearizer';
import type { InterlinearProjectSummary } from './interlinear-project-summary';

/**
 * Narrows a `Token` to a word token.
 *
 * @param token - The token to test.
 * @returns `true` when `token.type === 'word'`.
 */
export function isWordToken(token: Token): token is Token & { type: 'word' } {
  return token.type === 'word';
}

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

/** All valid {@link AssignmentStatus} string literals, used for O(1) membership checks. */
const ASSIGNMENT_STATUSES: readonly string[] = [
  'approved',
  'suggested',
  'candidate',
  'rejected',
  'stale',
];

/**
 * Narrows `v` to {@link AssignmentStatus}.
 *
 * @param v - The value to test.
 * @returns `true` if `v` is one of the valid {@link AssignmentStatus} string literals.
 */
function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === 'string' && ASSIGNMENT_STATUSES.includes(v);
}

/**
 * Checks that `v` has the required fields of a `TokenSnapshot` (`tokenRef` and `surfaceText`).
 *
 * @param v - The value to test.
 * @returns `true` if `v` is an object with string `tokenRef` and `surfaceText` properties.
 */
function isTokenSnapshot(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'tokenRef' in v &&
    typeof v.tokenRef === 'string' &&
    'surfaceText' in v &&
    typeof v.surfaceText === 'string'
  );
}

/**
 * Checks that `v` satisfies the base `Analysis` shape (`id` and `surfaceText`). Used as the
 * `.every()` predicate for `segmentAnalyses`, `tokenAnalyses`, and `phraseAnalyses`.
 *
 * @param v - The value to test.
 * @returns `true` if `v` is an object with string `id` and `surfaceText` properties.
 */
function isAnalysisRecord(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'id' in v &&
    typeof v.id === 'string' &&
    'surfaceText' in v &&
    typeof v.surfaceText === 'string'
  );
}

/**
 * Checks that `v` satisfies the base `AnalysisLink` shape (`analysisId` and a valid `status`). Used
 * as a building block by the three link-specific guards.
 *
 * @param v - The value to test.
 * @returns `true` if `v` is an object with a string `analysisId` and a valid
 *   {@link AssignmentStatus} `status`.
 */
function isAnalysisLink(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'analysisId' in v &&
    typeof v.analysisId === 'string' &&
    'status' in v &&
    isAssignmentStatus(v.status)
  );
}

/**
 * Checks that `v` satisfies the `SegmentAnalysisLink` shape: valid `AnalysisLink` fields plus a
 * string `segmentId`.
 *
 * @param v - The value to test.
 * @returns `true` if `v` passes {@link isAnalysisLink} and has a string `segmentId` property.
 */
function isSegmentAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) &&
    !!v &&
    typeof v === 'object' &&
    'segmentId' in v &&
    typeof v.segmentId === 'string'
  );
}

/**
 * Checks that `v` satisfies the `TokenAnalysisLink` shape: valid `AnalysisLink` fields plus a
 * `token` property that passes {@link isTokenSnapshot}.
 *
 * @param v - The value to test.
 * @returns `true` if `v` passes {@link isAnalysisLink} and has a valid `TokenSnapshot` `token`
 *   property.
 */
function isTokenAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) && !!v && typeof v === 'object' && 'token' in v && isTokenSnapshot(v.token)
  );
}

/**
 * Checks that `v` satisfies the `PhraseAnalysisLink` shape: valid `AnalysisLink` fields plus a
 * non-empty `tokens` array whose every element passes {@link isTokenSnapshot}.
 *
 * @param v - The value to test.
 * @returns `true` if `v` passes {@link isAnalysisLink} and has a `tokens` array of valid
 *   `TokenSnapshot` objects.
 */
function isPhraseAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) &&
    !!v &&
    typeof v === 'object' &&
    'tokens' in v &&
    Array.isArray(v.tokens) &&
    v.tokens.every(isTokenSnapshot)
  );
}

/**
 * Type guard for {@link TextAnalysis} parsed from unknown JSON. Validates array presence and minimal
 * element shapes for all six arrays so malformed payloads are rejected before persisting.
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
    value.segmentAnalyses.every(isAnalysisRecord) &&
    'segmentAnalysisLinks' in value &&
    Array.isArray(value.segmentAnalysisLinks) &&
    value.segmentAnalysisLinks.every(isSegmentAnalysisLink) &&
    'tokenAnalyses' in value &&
    Array.isArray(value.tokenAnalyses) &&
    value.tokenAnalyses.every(isAnalysisRecord) &&
    'tokenAnalysisLinks' in value &&
    Array.isArray(value.tokenAnalysisLinks) &&
    value.tokenAnalysisLinks.every(isTokenAnalysisLink) &&
    'phraseAnalyses' in value &&
    Array.isArray(value.phraseAnalyses) &&
    value.phraseAnalyses.every(isAnalysisRecord) &&
    'phraseAnalysisLinks' in value &&
    Array.isArray(value.phraseAnalysisLinks) &&
    value.phraseAnalysisLinks.every(isPhraseAnalysisLink)
  );
}
