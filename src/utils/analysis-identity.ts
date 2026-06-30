/** @file Content-identity helpers for deduplicating `TokenAnalysis` payloads on write. */

import type { MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';

/**
 * Soft cap on {@link normalizedFormCache}. One project's vocabulary is far smaller than this, so the
 * cap is effectively never hit within a single project; it exists only to bound the module-global
 * cache across a long-lived WebView session that opens many different projects (each a different
 * source vocabulary, plus baseline-drift variants), so the cache cannot grow without limit for the
 * process lifetime. Generous enough that the working set of the active project always fits.
 */
const NORMALIZED_FORM_CACHE_MAX = 50_000;

/**
 * Memoizes {@link normalizeSurfaceForm} by raw input string — called once per visible un-approved
 * token on every store dispatch, so the same forms are normalized repeatedly. The cache is module-
 * global rather than project-scoped, so a bound is needed: when it reaches
 * {@link NORMALIZED_FORM_CACHE_MAX} the oldest entry is evicted (insertion-order FIFO, free from
 * `Map`), keeping memory flat across a session that opens many projects rather than retaining every
 * surface form ever seen.
 */
const normalizedFormCache = new Map<string, string>();

/**
 * Normalizes a token surface form for matching and dedupe so trivial Unicode and case differences
 * never split one analysis into two. Applies Unicode NFC (so a composed `é` matches a decomposed
 * `e` + combining acute), then a locale-independent lowercase (so a sentence-initial `"The"`
 * matches a mid-sentence `"the"`), then NFC a final time so the returned key is guaranteed
 * canonical even for the rare code point whose lowercase mapping emits a decomposed sequence — the
 * key never depends on which Unicode form an equivalent input arrived in. Locale-independent
 * lowercasing — `String.prototype.toLowerCase`, not `toLocaleLowerCase` — is deliberate so the
 * result does not depend on the host's locale; the trade-off is that locale-specific folds are not
 * applied (e.g. a Turkish dotted `İ` is not folded to an ASCII `i`), an accepted miss that can only
 * cost a suggestion, never produce a wrong one. The result is memoized per raw input
 * ({@link normalizedFormCache}, bounded by {@link NORMALIZED_FORM_CACHE_MAX}) so the per-token derive
 * path does not re-run three Unicode passes for a constant surface form on every store change.
 *
 * @param text - The raw surface text to normalize.
 * @returns The case-folded surface form in NFC.
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
 * Structural deep-equality for the JSON-shaped values an analysis carries (strings, plain objects,
 * and arrays). Used to compare glosses, features, morpheme refs, and projected morpheme lists
 * without depending on key order. Never receives `null` — the analysis types use absence
 * (`undefined`) rather than `null` — so no `null` guard is needed.
 *
 * Kept as a small, dedicated helper rather than reusing `platform-bible-utils`' `deepEqual`: that
 * package is fully mocked in this project's Jest setup and the mock does not surface `deepEqual`,
 * so depending on it here would mean the dedupe path silently ran against `undefined` under test. A
 * local, directly-tested helper keeps content-identity matching honest in the suite.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns `true` when the two values are structurally equal.
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
 * Projects a morpheme down to the fields that define analysis identity — form, gloss, and its
 * lexicon refs (entry, sense, allomorph, grammar) — dropping `id` (a per-instance UUID) and
 * `writingSystem` (a presentation detail that self-corrects on save), so two analyses that differ
 * only in those are still considered identical.
 *
 * @param morpheme - The morpheme to project.
 * @returns A plain object holding only the identity-defining fields.
 */
function morphemeIdentity(morpheme: MorphemeAnalysis) {
  const { form, gloss, entryRef, senseRef, allomorphRef, grammarRef } = morpheme;
  return { form, gloss, entryRef, senseRef, allomorphRef, grammarRef };
}

/**
 * Reports whether two `TokenAnalysis` payloads carry the same meaning and so should share one
 * stored payload instead of being duplicated. Identity is content-based: equal normalized surface
 * forms (see {@link normalizeSurfaceForm}) plus deep-equal `gloss` (all language keys), `pos`,
 * `features`, `glossSenseRef` (the lexicon sense the gloss resolves through), and `morphemes`
 * (compared on form + gloss + refs only — see {@link morphemeIdentity}). Only `morphemes` treats a
 * missing list and an empty one as equal (the absent list is normalized to `[]` before comparison);
 * every other field is compared by exact structural equality, so a missing `gloss`/`features`/
 * `glossSenseRef` does not compare equal to an empty `{}`. That direction is deliberately
 * conservative: the only risk this dedupe carries is merging two analyses that actually differ (see
 * `glossSenseRef` below), never failing to merge two that don't. `glossSenseRef` is part of
 * identity because `isEmptyTokenAnalysis` counts it as content — were it excluded here, two
 * analyses differing only in their lexicon sense would be merged on write and one sense reference
 * silently dropped. Provenance fields (`confidence`, `producer`, `sourceUser`) and the record `id`
 * are intentionally excluded — they describe who produced an analysis, not what it means.
 *
 * @param a - First analysis.
 * @param b - Second analysis.
 * @returns `true` when the two analyses are content-identical.
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
