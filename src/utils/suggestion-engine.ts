/**
 * @file Pure suggestion-engine core: builds the analysis pool, ranks competing payloads, and
 *   derives per-token suggestions. Everything here is a pure function over plain data so the engine
 *   is trivially testable; the memoized Redux selectors that feed it live in
 *   `store/analysisSlice`.
 *
 *   Suggestions and candidates are never persisted — they are derived on read; only the approved
 *   human decisions are stored. The pool is the set of approved analyses in the current draft.
 */

import type { Token, TokenAnalysis } from 'interlinearizer';
import { normalizeSurfaceForm } from './analysis-identity';

/** One distinct approved payload in the pool together with how many tokens currently approve it. */
export interface PoolEntry {
  /** The shared approved `TokenAnalysis` payload. */
  analysis: TokenAnalysis;
  /** Number of tokens whose approved link points at this payload — its approval frequency. */
  frequency: number;
}

/**
 * The analysis pool indexed for matching: normalized surface form → the distinct approved payloads
 * sharing that form. A single-element list is the common case; multiple entries mean a homograph
 * (competing analyses of the same surface form).
 */
export type PoolIndex = ReadonlyMap<string, PoolEntry[]>;

/** The engine's derived proposal for one un-approved token (never persisted — derived on read). */
export interface TokenSuggestion {
  /** The top-ranked matching payload — the engine's single best pick (the `suggested` analysis). */
  suggested: TokenAnalysis;
  /**
   * The remaining matching payloads, in rank order — the `candidate` alternatives a reviewer can
   * promote instead of the suggestion. Empty unless the surface form is a homograph.
   */
  candidates: TokenAnalysis[];
}

/**
 * The merged per-token read the renderer consumes: the token's approved decision when one exists,
 * otherwise the engine's derived suggestion. The selector that produces this returns `undefined`
 * (not modeled here) when the token has neither — an unanalyzed token with no pool match.
 */
export type ResolvedTokenAnalysis =
  | {
      /** The token has a human-confirmed analysis; `analysis` is canonical for rendering. */
      status: 'approved';
      /** The approved payload. */
      analysis: TokenAnalysis;
    }
  | ({
      /** The token has no approved analysis; the engine proposes one derived from the pool. */
      status: 'suggested';
    } & TokenSuggestion);

/**
 * Groups the approved analyses into the {@link PoolIndex} used for matching: each distinct payload
 * is filed under the normalized form of its `surfaceText` ({@link normalizeSurfaceForm}), carrying
 * its approval frequency. Because the write path dedupes identical analyses and
 * `appendApprovedAnalysis` only shares a payload across tokens with the same normalized surface
 * form, every token under one key truly competes for the same word — so two entries under one key
 * are genuine homographs, never accidental near-duplicates.
 *
 * Keying on the normalized surface form alone (not also the writing system) is correct for v1: the
 * pool is a single source project, whose word tokens share one writing system, and NFC keeps
 * different scripts on distinct code points — so equal normalized forms already imply the same
 * writing system. A future cross-project / lexicon-backed pool would need to additionally key by
 * writing system; that cross-project pool is out of scope for v1.
 *
 * @param analysisById - Map from `TokenAnalysis.id` to its payload (every approved id resolves
 *   here).
 * @param approvedCountByAnalysisId - Map from each approved `TokenAnalysis.id` to its approval
 *   frequency; its keys are exactly the distinct approved payloads.
 * @returns The pool indexed by normalized surface form.
 */
export function buildPoolIndex(
  analysisById: ReadonlyMap<string, TokenAnalysis>,
  approvedCountByAnalysisId: ReadonlyMap<string, number>,
): PoolIndex {
  const index = new Map<string, PoolEntry[]>();
  approvedCountByAnalysisId.forEach((frequency, analysisId) => {
    const analysis = analysisById.get(analysisId);
    /* v8 ignore next -- every approved id resolves in analysisById, so a missing payload is unreachable */
    if (!analysis) return;
    const key = normalizeSurfaceForm(analysis.surfaceText);
    const bucket = index.get(key);
    if (bucket) bucket.push({ analysis, frequency });
    else index.set(key, [{ analysis, frequency }]);
  });
  return index;
}

/**
 * Orders the competing payloads for one surface form best-first: most-approved first, ties broken
 * by the lowest `analysis.id`. The id tiebreak is deterministic and content-independent, so the
 * elected suggestion never flickers between equally-frequent homographs as unrelated edits reorder
 * the pool. Returns a new array; the input is not mutated.
 *
 * @param entries - The pool entries sharing one normalized surface form.
 * @returns A new array sorted by descending frequency, then ascending `analysis.id`.
 */
export function rankPoolEntries(entries: readonly PoolEntry[]): PoolEntry[] {
  return [...entries].sort((a, b) => {
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    return a.analysis.id < b.analysis.id ? -1 : 1;
  });
}

/**
 * Derives the suggestion for one token from the pool by matching on its normalized surface form
 * ({@link normalizeSurfaceForm}). When the form matches, the most-approved payload becomes the
 * `suggested` analysis and the rest become ranked `candidate`s ({@link rankPoolEntries}); when it
 * does not match, there is no suggestion. The caller is responsible for only asking about tokens
 * that have no approved analysis (an approved token reads its decision, not a suggestion).
 *
 * @param poolIndex - The pool indexed by normalized surface form.
 * @param surfaceText - The token's raw surface text.
 * @returns The token's suggestion, or `undefined` when no pooled analysis matches.
 */
export function deriveTokenSuggestion(
  poolIndex: PoolIndex,
  surfaceText: string,
): TokenSuggestion | undefined {
  const entries = poolIndex.get(normalizeSurfaceForm(surfaceText));
  if (!entries) return undefined;
  const ranked = rankPoolEntries(entries);
  return { suggested: ranked[0].analysis, candidates: ranked.slice(1).map((e) => e.analysis) };
}

/**
 * Derives suggestions across a batch of tokens — e.g. the visible window — by matching each one
 * against the pool. A token is skipped (absent from the result) when it is punctuation (analysis is
 * a word-level concern) or already has an approved analysis (its human decision stands and is read
 * directly, never re-suggested). Remaining word tokens that match the pool map to their
 * {@link deriveTokenSuggestion}; word tokens with no match are simply omitted.
 *
 * @param poolIndex - The pool indexed by normalized surface form.
 * @param tokens - The tokens to derive over (words and punctuation may be intermixed).
 * @param approvedByTokenRef - Map from `Token.ref` to its approved `TokenAnalysis.id`; its keys are
 *   the tokens whose decision already stands, which are skipped.
 * @returns A map from `Token.ref` to its derived suggestion, holding only the matched, unapproved
 *   word tokens.
 */
export function deriveSuggestions(
  poolIndex: PoolIndex,
  tokens: readonly Token[],
  approvedByTokenRef: ReadonlyMap<string, string>,
): Map<string, TokenSuggestion> {
  const result = new Map<string, TokenSuggestion>();
  tokens.forEach((token) => {
    if (token.type !== 'word' || approvedByTokenRef.has(token.ref)) return;
    const suggestion = deriveTokenSuggestion(poolIndex, token.surfaceText);
    if (suggestion) result.set(token.ref, suggestion);
  });
  return result;
}
