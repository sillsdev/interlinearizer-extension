import type {
  AssignmentStatus,
  DraftProject,
  SegmentationDelta,
  TextAnalysis,
  Token,
} from 'interlinearizer';
import type { InterlinearProjectSummary } from './interlinear-project-summary';

/** Narrows a token to a word token. */
export function isWordToken(token: Token): token is Token & { type: 'word' } {
  return token.type === 'word';
}

/** Validates an {@link InterlinearProjectSummary} parsed from unknown JSON. */
export function isInterlinearProjectSummary(p: unknown): p is InterlinearProjectSummary {
  return (
    !!p &&
    typeof p === 'object' &&
    'id' in p &&
    typeof p.id === 'string' &&
    'createdAt' in p &&
    typeof p.createdAt === 'string' &&
    'updatedAt' in p &&
    typeof p.updatedAt === 'string' &&
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

/** All valid {@link AssignmentStatus} string literals. */
const ASSIGNMENT_STATUSES: readonly string[] = [
  'approved',
  'suggested',
  'candidate',
  'rejected',
  'stale',
];

function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === 'string' && ASSIGNMENT_STATUSES.includes(v);
}

// The helpers below check shape only and return plain booleans rather than narrowing, because the
// types they validate are structural fragments that callers never hold on their own.

/** Checks the required fields of a token snapshot. */
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
 * Checks the fields common to every analysis record. Timestamps are not required, so a record
 * stored before analyses carried them — or one arriving from a caller that omits them — still
 * validates and is stamped on read.
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

/** Checks the required fields of a single morpheme analysis. */
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
 * Checks a token analysis, including its morphemes when present. Morphemes are first-class data the
 * UI reads field by field, so a malformed array has to be rejected at the persistence boundary
 * rather than surfacing later as a render-time fault.
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
 * Checks the fields common to every analysis link. Timestamps are not required, so a link stored
 * before analyses carried them still validates and can be stamped on read.
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

/** Checks a link that attaches an analysis to a segment. */
function isSegmentAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) &&
    !!v &&
    typeof v === 'object' &&
    'segmentId' in v &&
    typeof v.segmentId === 'string'
  );
}

/** Checks a link that attaches an analysis to a single token. */
function isTokenAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) && !!v && typeof v === 'object' && 'token' in v && isTokenSnapshot(v.token)
  );
}

/** Checks a link that attaches an analysis to a non-empty run of tokens. */
function isPhraseAnalysisLink(v: unknown): boolean {
  return (
    isAnalysisLink(v) &&
    !!v &&
    typeof v === 'object' &&
    'tokens' in v &&
    Array.isArray(v.tokens) &&
    v.tokens.length > 0 &&
    v.tokens.every(isTokenSnapshot)
  );
}

/**
 * Validates a {@link TextAnalysis} parsed from unknown JSON, down to the element shapes of every
 * collection, so a malformed payload is rejected before it is persisted.
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
 * Validates a {@link SegmentationDelta} parsed from unknown JSON, so a malformed delta cannot
 * corrupt re-segmentation.
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
 * Validates a {@link DraftProject} parsed from unknown JSON, so a malformed draft is rejected before
 * it is persisted.
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
