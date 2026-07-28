import type { MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';

/**
 * Soft cap on the normalized-form cache. One project's vocabulary is far smaller than this, so the
 * cap is effectively never hit within a single project. It exists only to bound the module-global
 * cache across a long-lived WebView session that opens many projects, each with its own vocabulary
 * plus baseline-drift variants, so memory cannot grow without limit for the process lifetime.
 */
const NORMALIZED_FORM_CACHE_MAX = 50_000;

/**
 * Memoizes {@link normalizeSurfaceForm} by raw input string. Normalization runs once per visible
 * un-approved token on every store dispatch, so the same handful of forms would otherwise be
 * re-derived constantly. Bounded by {@link NORMALIZED_FORM_CACHE_MAX} because the cache is
 * module-global rather than project-scoped.
 */
const normalizedFormCache = new Map<string, string>();

/**
 * Normalizes a token surface form for matching and dedupe, so trivial Unicode and case differences
 * never split one analysis into two.
 *
 * Normalization is applied on both sides of the case fold: the leading pass makes a composed `é`
 * match a decomposed `e` + combining acute, and the trailing pass re-canonicalizes the rare code
 * point whose lowercase mapping emits a decomposed sequence. The result therefore never depends on
 * which Unicode form an equivalent input arrived in.
 *
 * The fold is deliberately locale-independent so the result does not vary with the host's locale.
 * The trade-off is that locale-specific folds are skipped — a Turkish dotted `İ` is not folded to
 * an ASCII `i` — an accepted miss, since it can only cost a suggestion, never produce a wrong one.
 */
export function normalizeSurfaceForm(text: string): string {
  const cached = normalizedFormCache.get(text);
  if (cached !== undefined) return cached;
  const normalized = text.normalize('NFC').toLowerCase().normalize('NFC');
  /* v8 ignore start -- eviction is an internal memory bound with no caller-observable effect (the
     result is identical whether cached, recomputed, or evicted); the 50k-entry cap makes it
     impractical to drive from a unit test and there is nothing behavioral to assert if we did */
  // Evict the oldest entry (Map iterates in insertion order) before exceeding the cap, so the
  // module-global cache stays flat across a session that opens many projects.
  if (normalizedFormCache.size >= NORMALIZED_FORM_CACHE_MAX) {
    const oldest = normalizedFormCache.keys().next().value;
    if (oldest !== undefined) normalizedFormCache.delete(oldest);
  }
  /* v8 ignore stop */
  normalizedFormCache.set(text, normalized);
  return normalized;
}

/**
 * Structural deep-equality for the JSON-shaped values an analysis carries, used to compare glosses,
 * features, and morpheme refs without depending on key order. Never receives `null`, since the
 * analysis types use absence rather than `null`.
 *
 * Kept as a dedicated local helper rather than reusing `platform-bible-utils`' equivalent: that
 * package is fully mocked in this project's Jest setup and the mock does not surface it, so
 * depending on it here would mean the dedupe path silently ran against `undefined` under test.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  /* v8 ignore next -- analysis fields are never null; guard only satisfies Object.entries typing */
  if (!a || !b) return false;
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) return false;
  const bByKey = new Map(bEntries);
  return aEntries.every(([key, value]) => bByKey.has(key) && deepEqual(value, bByKey.get(key)));
}

/**
 * Projects a morpheme down to the fields that define analysis identity, dropping `id` (a
 * per-instance UUID) and `writingSystem` (a presentation detail that self-corrects on save), so two
 * analyses differing only in those still count as identical.
 */
function morphemeIdentity(morpheme: MorphemeAnalysis) {
  const { form, gloss, entryRef, senseRef, allomorphRef, grammarRef } = morpheme;
  return { form, gloss, entryRef, senseRef, allomorphRef, grammarRef };
}

/**
 * Reports whether two token analyses carry the same meaning and so should share one stored payload
 * rather than being duplicated.
 *
 * Identity is content-based: normalized surface form plus the gloss, part of speech, features,
 * lexicon sense, and morphemes. Provenance (`confidence`, `producer`, `sourceUser`) and the record
 * `id` are excluded — they describe who produced an analysis, not what it means. The lexicon sense
 * _is_ part of identity, because excluding it would merge two analyses differing only in their
 * sense and silently drop one reference.
 *
 * Only morphemes treat a missing list and an empty one as equal; every other field is compared by
 * exact structural equality, so a missing gloss does not equal an empty one. That asymmetry is
 * deliberately conservative: the only risk this dedupe carries is merging two analyses that
 * genuinely differ, never failing to merge two that don't.
 */
export function analysesAreIdentical(a: TokenAnalysis, b: TokenAnalysis): boolean {
  return (
    normalizeSurfaceForm(a.surfaceText) === normalizeSurfaceForm(b.surfaceText) &&
    deepEqual(a.gloss, b.gloss) &&
    a.pos === b.pos &&
    deepEqual(a.features, b.features) &&
    deepEqual(a.glossSenseRef, b.glossSenseRef) &&
    deepEqual((a.morphemes ?? []).map(morphemeIdentity), (b.morphemes ?? []).map(morphemeIdentity))
  );
}
