/** @file Content-identity helpers for deduplicating `TokenAnalysis` payloads on write. */

import type { MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';

/**
 * Normalizes a token surface form for matching and dedupe so trivial Unicode and case differences
 * never split one analysis into two. Applies Unicode NFC (so a composed `é` matches a decomposed
 * `e` + combining acute) then a locale-independent lowercase (so a sentence-initial `"The"` matches
 * a mid-sentence `"the"`). Locale-independent lowercasing — `String.prototype.toLowerCase`, not
 * `toLocaleLowerCase` — is deliberate so the result does not depend on the host's locale.
 *
 * @param text - The raw surface text to normalize.
 * @returns The NFC-normalized, lowercased surface form.
 */
export function normalizeSurfaceForm(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/**
 * Structural deep-equality for the JSON-shaped values an analysis carries (strings, plain objects,
 * and arrays). Used to compare glosses, features, morpheme refs, and projected morpheme lists
 * without depending on key order. Never receives `null` — the analysis types use absence
 * (`undefined`) rather than `null` — so no `null` guard is needed.
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
 * Projects a morpheme down to the fields that define analysis identity — form, gloss, and the four
 * lexicon refs — dropping `id` (a per-instance UUID) and `writingSystem` (a presentation detail
 * that self-corrects on save), so two analyses that differ only in those are still considered
 * identical.
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
 * `features`, and `morphemes` (compared on form + gloss + refs only — see {@link morphemeIdentity}).
 * A missing field and an empty one of the same kind compare equal. Provenance fields (`confidence`,
 * `producer`, `sourceUser`) and the record `id` are intentionally excluded — they describe who
 * produced an analysis, not what it means.
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
    deepEqual((a.morphemes ?? []).map(morphemeIdentity), (b.morphemes ?? []).map(morphemeIdentity))
  );
}
