/**
 * @file Pure suggestion-engine core: builds the analysis pool, ranks competing payloads, and
 *   derives per-token suggestions. Everything here is a pure function over plain data so the engine
 *   is trivially testable; the memoized Redux selectors that feed it live in
 *   `store/analysisSlice`.
 *
 *   Suggestions and candidates are never persisted — they are derived on read; only the approved
 *   human decisions are stored. The pool is the set of approved analyses in the current draft.
 */

import type { AssignmentStatus, TokenAnalysis } from 'interlinearizer';
import { normalizeSurfaceForm } from './analysis-identity';

/**
 * Shared empty candidate list returned for every non-homograph match (the common case), so
 * {@link deriveTokenSuggestion} never allocates a throwaway `[]` per call. Read-only and never
 * mutated by any consumer.
 */
const NO_CANDIDATES: readonly TokenAnalysis[] = [];

/** One distinct approved payload in the pool together with how many tokens currently approve it. */
export interface PoolEntry {
  /** The shared approved `TokenAnalysis` payload. */
  analysis: TokenAnalysis;
  /** Number of tokens whose approved link points at this payload — its approval frequency. */
  frequency: number;
}

/**
 * The analysis pool indexed for matching: normalized surface form → the distinct approved payloads
 * sharing that form, each bucket pre-ranked best-first ({@link comparePoolEntries}) so its head is
 * the suggested pick. A single-element list is the common case; multiple entries mean a homograph
 * (competing analyses of the same surface form). Buckets are read-only — they are ranked once at
 * build time and never re-sorted per token.
 */
export type PoolIndex = ReadonlyMap<string, readonly PoolEntry[]>;

/** The engine's derived proposal for one un-approved token (never persisted — derived on read). */
export interface TokenSuggestion {
  /** The top-ranked matching payload — the engine's single best pick (the `suggested` analysis). */
  suggested: TokenAnalysis;
  /**
   * The remaining matching payloads, in rank order — the `candidate` alternatives a reviewer can
   * promote instead of the suggestion. Empty unless the surface form is a homograph. Read-only so
   * the single shared empty array returned for the common non-homograph case is never mutated.
   */
  candidates: readonly TokenAnalysis[];
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
      /**
       * Pool alternatives for this surface form, when any exist, so the suggestion chevron can
       * offer re-promotion even after the token is approved. `undefined` when the pool has no match
       * for this surface form (the token was manually glossed with no pool peers).
       */
      poolSuggestion?: TokenSuggestion;
    }
  | ({
      /** The token has no approved analysis; the engine proposes one derived from the pool. */
      status: 'suggested';
    } & TokenSuggestion);

/**
 * Orders two competing pool entries best-first: the more-approved entry sorts before the less, and
 * a frequency tie is broken by the lower `analysis.id`. The id tiebreak is deterministic and
 * content-independent, so the elected suggestion never flickers between equally-frequent homographs
 * as unrelated edits reorder the pool. Used by {@link buildPoolIndex} to pre-rank each bucket once
 * at build time so per-token derives never re-sort.
 *
 * @param a - First pool entry.
 * @param b - Second pool entry.
 * @returns A negative number when `a` ranks first, positive when `b` ranks first.
 */
function comparePoolEntries(a: PoolEntry, b: PoolEntry): number {
  if (a.frequency !== b.frequency) return b.frequency - a.frequency;
  return a.analysis.id < b.analysis.id ? -1 : 1;
}

/**
 * Groups the approved analyses into the {@link PoolIndex} used for matching: each distinct payload
 * is filed under the normalized form of its `surfaceText` ({@link normalizeSurfaceForm}), carrying
 * its approval frequency. Because the write path dedupes identical analyses and
 * `appendApprovedAnalysis` only shares a payload across tokens with the same normalized surface
 * form, every token under one key truly competes for the same word — so two entries under one key
 * are genuine homographs, never accidental near-duplicates.
 *
 * Keying on the normalized surface form alone (not also the writing system) is correct for v1: the
 * pool is a single source project whose word tokens share one writing system, and NFC keeps
 * different scripts on distinct code points — so equal normalized forms already imply the same
 * writing system.
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
  // Pre-rank each bucket best-first once here, at pool-build time (a memoized selector recomputes
  // the pool only on approved writes), so per-token derives read the head without re-sorting.
  index.forEach((bucket) => bucket.sort(comparePoolEntries));
  return index;
}

/**
 * Derives the suggestion for one token from the pool by matching on its normalized surface form
 * ({@link normalizeSurfaceForm}). When the form matches, the matched bucket is already ranked
 * best-first ({@link buildPoolIndex}), so its head is the `suggested` analysis and the rest are the
 * ranked `candidate`s; when it does not match, there is no suggestion. The caller is responsible
 * for only asking about tokens that have no approved analysis (an approved token reads its
 * decision, not a suggestion).
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
  // The bucket is pre-ranked best-first by buildPoolIndex, so the head is the suggested pick and
  // the tail are the candidates — no per-call re-sort. A non-homograph bucket (the common case) has
  // a single entry, so reuse one shared empty array instead of allocating a throwaway `[]` per call.
  return {
    suggested: entries[0].analysis,
    candidates: entries.length > 1 ? entries.slice(1).map((e) => e.analysis) : NO_CANDIDATES,
  };
}

/**
 * One renderable suggestion entry: a payload id, its gloss in the active language, and the
 * assignment status the UI colors and labels it by.
 */
export interface GlossedSuggestionEntry {
  /** The matching payload's id — the approve/promote target and the React key. */
  id: string;
  /** The payload's gloss in the active analysis language; never blank (blank entries are dropped). */
  gloss: string;
  /**
   * How the row is offered: `'suggested'` for the engine's pick on an un-approved token (green,
   * "accept"), or `'candidate'` for every promotable alternative (blue, "promote"). Carried on the
   * entry — rather than re-derived from row position by the renderer — so dropping a blank-in-
   * language pick can never leave a candidate masquerading as the accept row.
   */
  status: Extract<AssignmentStatus, 'suggested' | 'candidate'>;
}

/**
 * Flattens the merged per-token read into the entries the gloss UI renders, in rank order, keeping
 * only those that carry a non-blank gloss in `analysisLanguage`. Centralizes the
 * suggestion-presentation policy in one place: which matches are renderable, how a blank-in-active-
 * language pick falls through to the next-ranked one rather than showing an empty button, the
 * already-approved payload's exclusion from its own promote list, and — critically — each row's
 * assignment status, so every surface ranks, colors, and labels suggestions identically instead of
 * re-deriving any of it from the raw {@link TokenSuggestion} or from row position.
 *
 * For an un-approved (`'suggested'`) token the highest-ranked renderable match is offered as
 * `'suggested'` (the green "accept" row) and the rest as `'candidate'` (blue "promote"). The status
 * is assigned _after_ dropping blank-in-language picks, so when the engine's top pick has no gloss
 * in the active language the next-ranked glossed match correctly becomes the accept row rather than
 * the whole suggestion vanishing. For an already-approved token every pool peer is a `'candidate'`
 * (promote) — the approved payload itself is excluded, and there is no accept row, so even the top
 * row reads as a promotion rather than masquerading as an "accept the suggestion" row.
 *
 * @param resolved - The token's merged approved/suggested read, or `undefined` when it has neither.
 * @param analysisLanguage - BCP 47 tag whose gloss to read from each matching payload.
 * @returns The glossed entries in rank order; empty when there is nothing renderable.
 */
export function glossedSuggestionEntries(
  resolved: ResolvedTokenAnalysis | undefined,
  analysisLanguage: string,
): GlossedSuggestionEntry[] {
  if (!resolved) return [];
  // The ranked payloads to offer, best-first. For an approved token its own payload is excluded so
  // only genuine alternatives remain; for an un-approved token the engine's pick leads.
  let ranked: readonly TokenAnalysis[];
  if (resolved.status === 'suggested') {
    ranked = [resolved.suggested, ...resolved.candidates];
  } else {
    const pool = resolved.poolSuggestion;
    if (!pool) return [];
    ranked = [pool.suggested, ...pool.candidates].filter((a) => a.id !== resolved.analysis.id);
  }
  const glossed = ranked
    .map((analysis) => ({ id: analysis.id, gloss: analysis.gloss?.[analysisLanguage] ?? '' }))
    .filter((entry) => entry.gloss !== '');
  // Assign status by post-filter rank: only an un-approved token has an "accept" row (its top
  // renderable match); an approved token offers only promotions. Done after the blank filter so a
  // dropped top pick promotes the next-ranked glossed match to the accept row rather than leaving a
  // candidate masquerading as it.
  const hasAccept = resolved.status === 'suggested';
  return glossed.map((entry, index) => ({
    ...entry,
    status: hasAccept && index === 0 ? 'suggested' : 'candidate',
  }));
}

/**
 * Equality predicate for two {@link ResolvedTokenAnalysis} results, for use as a `useSelector`
 * `equalityFn` so a per-token subscription stays referentially stable across unrelated store
 * changes. {@link selectResolvedTokenAnalysis} (in `store/analysisSlice`) freshly allocates its
 * wrapper object — and the suggested branch a fresh `candidates` array — on every call, so the
 * default `Object.is` comparison would re-render every visible suggested token on any store change.
 * This compares by the meaningful identity instead: the `analysis` / `suggested` payloads and each
 * `candidate` are reference-stable store objects (the pool only re-files the same payloads), so
 * comparing them by reference is both correct and cheap — equal whenever the rendered suggestion is
 * unchanged, even when an incidental edit elsewhere rebuilt the pool index around the same
 * payloads.
 *
 * @param a - The previous resolved analysis (or `undefined` when the token had neither).
 * @param b - The next resolved analysis (or `undefined`).
 * @returns `true` when the two describe the same approved decision or suggestion.
 */
export function resolvedTokenAnalysisEqual(
  a: ResolvedTokenAnalysis | undefined,
  b: ResolvedTokenAnalysis | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.status === 'approved' && b.status === 'approved') {
    if (a.analysis !== b.analysis) return false;
    const ap = a.poolSuggestion;
    const bp = b.poolSuggestion;
    if (ap === bp) return true;
    if (!ap || !bp) return false;
    return (
      ap.suggested === bp.suggested &&
      ap.candidates.length === bp.candidates.length &&
      ap.candidates.every((c, i) => c === bp.candidates[i])
    );
  }
  if (a.status === 'suggested' && b.status === 'suggested') {
    return (
      a.suggested === b.suggested &&
      a.candidates.length === b.candidates.length &&
      a.candidates.every((candidate, i) => candidate === b.candidates[i])
    );
  }
  // One is approved and the other suggested — different renders.
  return false;
}
