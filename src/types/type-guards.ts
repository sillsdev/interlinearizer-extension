import type {
  AnalysisLink,
  AssignmentStatus,
  Confidence,
  DraftProject,
  LexiconRef,
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
    (!('targetProjectId' in p) || typeof p.targetProjectId === 'string') &&
    (!('pt9Import' in p) || isPt9ImportProvenance(p.pt9Import)) &&
    (!('books' in p) || (Array.isArray(p.books) && p.books.every((b) => typeof b === 'string'))) &&
    (!('tokenAnalysisCount' in p) || typeof p.tokenAnalysisCount === 'number')
  );
}

/** Type guard for the `pt9Import` provenance an imported project carries. */
export function isPt9ImportProvenance(
  value: unknown,
): value is NonNullable<InterlinearProjectSummary['pt9Import']> {
  return (
    !!value &&
    typeof value === 'object' &&
    'importedAt' in value &&
    typeof value.importedAt === 'string' &&
    'fileHashes' in value &&
    !!value.fileHashes &&
    typeof value.fileHashes === 'object' &&
    Object.values(value.fileHashes).every((hash) => typeof hash === 'string')
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

/** All valid {@link Confidence} string literals. */
const CONFIDENCES: readonly string[] = ['high', 'medium', 'low', 'guess'];

function isConfidence(v: unknown): v is Confidence {
  return typeof v === 'string' && CONFIDENCES.includes(v);
}

// The helpers below validate structural fragments (types callers never hold on their own), so they
// return plain booleans rather than narrowing, unless a caller needs the narrowed type.

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
    typeof v.surfaceText === 'string' &&
    (!('confidence' in v) || isConfidence(v.confidence))
  );
}

/**
 * Checks that a ref names an authority, never that it names one this build knows.
 *
 * An unrecognized authority makes a ref foreign when it is resolved, so rejecting it here would
 * make a whole draft carrying a third-party ref unreadable instead.
 */
function isLexiconRef(v: unknown): v is LexiconRef {
  return (
    !!v &&
    typeof v === 'object' &&
    'authority' in v &&
    typeof v.authority === 'string' &&
    (!('projectId' in v) || typeof v.projectId === 'string')
  );
}

function isEntryRef(v: unknown): boolean {
  return isLexiconRef(v) && 'entryId' in v && typeof v.entryId === 'string';
}

function isSenseRef(v: unknown): boolean {
  return isLexiconRef(v) && 'senseId' in v && typeof v.senseId === 'string';
}

function isAllomorphRef(v: unknown): boolean {
  return isLexiconRef(v) && 'allomorphId' in v && typeof v.allomorphId === 'string';
}

function isGrammarRef(v: unknown): boolean {
  return isLexiconRef(v) && 'msaId' in v && typeof v.msaId === 'string';
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
    typeof v.writingSystem === 'string' &&
    (!('entryRef' in v) || isEntryRef(v.entryRef)) &&
    (!('senseRef' in v) || isSenseRef(v.senseRef)) &&
    (!('allomorphRef' in v) || isAllomorphRef(v.allomorphRef)) &&
    (!('grammarRef' in v) || isGrammarRef(v.grammarRef))
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
    (!('morphemes' in v) ||
      (Array.isArray(v.morphemes) && v.morphemes.every(isMorphemeAnalysis))) &&
    (!('glossSenseRef' in v) || isSenseRef(v.glossSenseRef))
  );
}

/** Checks a phrase analysis. */
function isPhraseAnalysisRecord(v: unknown): boolean {
  return (
    isAnalysisRecord(v) &&
    !!v &&
    typeof v === 'object' &&
    (!('senseRef' in v) || isSenseRef(v.senseRef))
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
    isAssignmentStatus(v.status) &&
    (!('confidence' in v) || isConfidence(v.confidence))
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
    value.phraseAnalyses.every(isPhraseAnalysisRecord) &&
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
    'modelVersion' in value &&
    typeof value.modelVersion === 'number' &&
    (!('targetProjectId' in value) || typeof value.targetProjectId === 'string') &&
    (!('suggestedName' in value) || typeof value.suggestedName === 'string') &&
    (!('suggestedDescription' in value) || typeof value.suggestedDescription === 'string') &&
    (!('segmentation' in value) || isSegmentationDelta(value.segmentation)) &&
    'analysis' in value &&
    isTextAnalysis(value.analysis)
  );
}

/**
 * One class of invariant violation found in a {@link TextAnalysis}, with the count of occurrences
 * and a bounded sample of the targets or ids involved.
 */
export interface AnalysisViolation {
  /**
   * Which invariant was broken. `unreferencedAnalysis` is never reported for the token layer, whose
   * payloads describe a spelling rather than an occurrence and so may outrun the text.
   */
  kind: 'multipleApproved' | 'danglingLink' | 'unreferencedAnalysis';

  /** Which analysis layer the violation was found in. */
  layer: 'segment' | 'token' | 'phrase';

  count: number;

  /** Up to {@link VIOLATION_SAMPLE_LIMIT} of the target keys or analysis ids involved. */
  sample: string[];
}

/** Caps a violation's identifiers so a mass violation cannot flood the log. */
const VIOLATION_SAMPLE_LIMIT = 10;

/** The key identifying a phrase link's target span. */
function phraseTargetKey(tokens: readonly { tokenRef: string }[]): string {
  return tokens.map((t) => t.tokenRef).join(',');
}

/** Each key occurring more than once, listed once however often it repeats. */
function repeated(keys: readonly string[]): string[] {
  const counts = new Map<string, number>();
  keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
}

function violation(
  kind: AnalysisViolation['kind'],
  layer: AnalysisViolation['layer'],
  ids: string[],
): AnalysisViolation | undefined {
  if (ids.length === 0) return undefined;
  return { kind, layer, count: ids.length, sample: ids.slice(0, VIOLATION_SAMPLE_LIMIT) };
}

/**
 * Target keys that carry more than one `approved` link, which the model permits at most one of,
 * counting each link once per key it claims approval over.
 */
function multipleApprovedTargets<L extends AnalysisLink>(
  links: readonly L[],
  approvalKeys: (link: L) => readonly string[],
): string[] {
  return repeated(links.filter((link) => link.status === 'approved').flatMap(approvalKeys));
}

/** How one analysis layer's links and payloads are checked against each other. */
interface LayerRules<L extends AnalysisLink> {
  /** The key naming a link's target, used to report the link in a violation sample. */
  targetKey: (link: L) => string;

  /**
   * Every key a link claims approval over, for a layer whose approval invariant is finer-grained
   * than its target — a phrase span claims each member token. Defaults to the target alone.
   */
  approvalKeys?: (link: L) => readonly string[];

  /**
   * Whether a payload no link references is a violation. False for a layer whose payloads form an
   * inventory that may outrun the text.
   */
  requireReferenced: boolean;
}

/** Checks one layer's links against its payload records, in both directions. */
function validateLayer<L extends AnalysisLink>(
  layer: AnalysisViolation['layer'],
  analyses: readonly { id: string }[],
  links: readonly L[],
  { targetKey, approvalKeys = (link) => [targetKey(link)], requireReferenced }: LayerRules<L>,
): AnalysisViolation[] {
  const analysisIds = new Set(analyses.map((a) => a.id));
  const linkedIds = new Set(links.map((link) => link.analysisId));
  const unreferenced = requireReferenced
    ? analyses.filter((a) => !linkedIds.has(a.id)).map((a) => a.id)
    : [];
  return [
    violation('multipleApproved', layer, multipleApprovedTargets(links, approvalKeys)),
    violation(
      'danglingLink',
      layer,
      links.filter((link) => !analysisIds.has(link.analysisId)).map(targetKey),
    ),
    violation('unreferencedAnalysis', layer, unreferenced),
  ].filter((v) => v !== undefined);
}

/**
 * Reports the invariant violations a structurally valid {@link TextAnalysis} can still carry: a
 * target with more than one `approved` link, a link whose `analysisId` names no payload, and — for
 * the layers whose payloads may not outrun the text — a payload no link references. Where
 * {@link isTextAnalysis} asks whether the shape is readable, this asks whether the collections agree
 * with each other.
 *
 * Reporting is all it does: the returned violations leave the analysis untouched, so a corrupted
 * record stays readable and its corruption stays visible.
 */
export function validateTextAnalysis(analysis: TextAnalysis): AnalysisViolation[] {
  return [
    ...validateLayer('segment', analysis.segmentAnalyses, analysis.segmentAnalysisLinks, {
      targetKey: (link) => link.segmentId,
      requireReferenced: true,
    }),
    ...validateLayer('token', analysis.tokenAnalyses, analysis.tokenAnalysisLinks, {
      targetKey: (link) => link.token.tokenRef,
      requireReferenced: false,
    }),
    ...validateLayer('phrase', analysis.phraseAnalyses, analysis.phraseAnalysisLinks, {
      targetKey: (link) => phraseTargetKey(link.tokens),
      approvalKeys: (link) => link.tokens.map((t) => t.tokenRef),
      requireReferenced: true,
    }),
  ];
}
