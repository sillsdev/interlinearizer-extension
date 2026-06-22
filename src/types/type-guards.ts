/** @file Type guards for narrowing interlinearizer types and validating parsed JSON payloads. */
import type {
  AssignmentStatus,
  DraftProject,
  SegmentationDelta,
  TextAnalysis,
  Token,
} from 'interlinearizer';
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
 * Checks that `v` satisfies the base `Analysis` shape (`id` and `surfaceText`). Used directly as
 * the `.every()` predicate for `segmentAnalyses` and `phraseAnalyses`, and as the base of
 * {@link isTokenAnalysisRecord} for `tokenAnalyses`.
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
 * Checks that `v` has the required fields of a `MorphemeAnalysis` (`id`, `form`, `writingSystem`).
 * Used to validate the elements of a `TokenAnalysis.morphemes` array at the persistence boundary.
 *
 * @param v - The value to test.
 * @returns `true` if `v` is an object with string `id`, `form`, and `writingSystem` properties.
 */
function isMorphemeAnalysis(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'id' in v &&
    typeof v.id === 'string' &&
    'form' in v &&
    typeof v.form === 'string' &&
    'writingSystem' in v &&
    typeof v.writingSystem === 'string'
  );
}

/**
 * Checks that `v` satisfies the `TokenAnalysis` shape: the base `Analysis` fields plus, when
 * present, a `morphemes` array whose every element passes {@link isMorphemeAnalysis}. Morphemes are
 * first-class data read by the UI (`m.id` keys, `m.form`, `m.writingSystem`), so a malformed array
 * must be rejected before persisting rather than surfacing as a render-time fault.
 *
 * @param v - The value to test.
 * @returns `true` if `v` is a valid analysis record with a well-formed (or absent) `morphemes`
 *   array.
 */
function isTokenAnalysisRecord(v: unknown): boolean {
  return (
    isAnalysisRecord(v) &&
    !!v &&
    typeof v === 'object' &&
    (!('morphemes' in v) || (Array.isArray(v.morphemes) && v.morphemes.every(isMorphemeAnalysis)))
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
    value.tokenAnalyses.every(isTokenAnalysisRecord) &&
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

/**
 * Type guard for {@link SegmentationDelta} parsed from unknown JSON. Both arrays must be present and
 * contain only strings, so a malformed delta is rejected before it can corrupt re-segmentation.
 *
 * @param value - The value to test, typically a parsed JSON object of unknown shape.
 * @returns `true` if `value` satisfies the {@link SegmentationDelta} shape, narrowing its type
 *   accordingly.
 */
export function isSegmentationDelta(value: unknown): value is SegmentationDelta {
  return (
    !!value &&
    typeof value === 'object' &&
    'removedVerseStarts' in value &&
    Array.isArray(value.removedVerseStarts) &&
    value.removedVerseStarts.every((r) => typeof r === 'string') &&
    'addedStarts' in value &&
    Array.isArray(value.addedStarts) &&
    value.addedStarts.every((r) => typeof r === 'string')
  );
}

/**
 * Type guard for {@link DraftProject} parsed from unknown JSON. Validates the envelope fields and
 * delegates the `analysis` to {@link isTextAnalysis}, so malformed drafts are rejected before
 * persisting.
 *
 * @param value - The value to test, typically a parsed JSON object of unknown shape.
 * @returns `true` if `value` satisfies the {@link DraftProject} shape, narrowing its type
 *   accordingly.
 */
export function isDraftProject(value: unknown): value is DraftProject {
  return (
    !!value &&
    typeof value === 'object' &&
    'sourceProjectId' in value &&
    typeof value.sourceProjectId === 'string' &&
    'analysisLanguages' in value &&
    Array.isArray(value.analysisLanguages) &&
    value.analysisLanguages.every((l) => typeof l === 'string') &&
    'dirty' in value &&
    typeof value.dirty === 'boolean' &&
    (!('targetProjectId' in value) || typeof value.targetProjectId === 'string') &&
    (!('suggestedName' in value) || typeof value.suggestedName === 'string') &&
    (!('suggestedDescription' in value) || typeof value.suggestedDescription === 'string') &&
    (!('segmentation' in value) || isSegmentationDelta(value.segmentation)) &&
    'analysis' in value &&
    isTextAnalysis(value.analysis)
  );
}
