/**
 * Pure suggestion-engine core: builds the analysis pool, ranks competing payloads, and derives
 * per-token suggestions. Everything here is a pure function over plain data, so the engine is
 * trivially testable; the memoized selectors that feed it live in the store.
 *
 * Suggestions and candidates are never persisted — they are derived on read, and only approved
 * human decisions are stored. The pool is the set of approved analyses in the current draft.
 */

import type { AssignmentStatus, TokenAnalysis } from 'interlinearizer';
import { normalizeSurfaceForm } from './analysis-identity';

/**
 * Shared empty candidate list returned for every non-homograph match, so the common case never
 * allocates a throwaway array. Read-only and never mutated by any consumer.
 */
const NO_CANDIDATES: readonly TokenAnalysis[] = [];

/** One distinct approved payload in the pool together with how many tokens currently approve it. */
export interface PoolEntry {
  /** The shared approved payload. */
  analysis: TokenAnalysis;
  /** Number of tokens whose approved link points at this payload — its approval frequency. */
  frequency: number;
}

/**
 * The analysis pool indexed for matching: normalized surface form → the distinct approved payloads
 * sharing that form. Each bucket is pre-ranked best-first at build time and never re-sorted per
 * token, so its head is the suggested pick. A single-element bucket is the common case; multiple
 * entries mean a homograph.
 */
export type PoolIndex = ReadonlyMap<string, readonly PoolEntry[]>;

/** The engine's derived proposal for one un-approved token. Never persisted. */
export interface TokenSuggestion {
  /** The top-ranked matching payload — the engine's single best pick. */
  suggested: TokenAnalysis;
  /**
   * The remaining matching payloads, in rank order — the alternatives a reviewer can promote
   * instead. Empty unless the surface form is a homograph. Read-only, because the non-homograph
   * case returns one shared empty array.
   */
  candidates: readonly TokenAnalysis[];
}

/**
 * The merged per-token read the renderer consumes: the token's approved decision when one exists,
 * otherwise the engine's derived suggestion. The selector producing this yields `undefined`, not
 * modeled here, when the token has neither — an unanalyzed token with no pool match.
 */
export type ResolvedTokenAnalysis =
  | {
      /** The token has a human-confirmed analysis, canonical for rendering. */
      status: 'approved';
      /** The approved payload. */
      analysis: TokenAnalysis;
      /**
       * Pool alternatives for this surface form, so the suggestion dropdown can offer re-promotion
       * even after the token is approved. `undefined` when the pool has no match — the token was
       * manually glossed with no pool peers.
       */
      poolSuggestion?: TokenSuggestion;
    }
  | ({
      /** The token has no approved analysis; the engine proposes one derived from the pool. */
      status: 'suggested';
    } & TokenSuggestion);

/**
 * Orders two competing pool entries best-first, breaking a frequency tie by the lower analysis id.
 * That tiebreak is deterministic and content-independent, so the elected suggestion never flickers
 * between equally-frequent homographs as unrelated edits reorder the pool.
 */
function comparePoolEntries(a: PoolEntry, b: PoolEntry): number {
  if (a.frequency !== b.frequency) return b.frequency - a.frequency;
  return a.analysis.id < b.analysis.id ? -1 : 1;
}

/**
 * Groups the approved analyses into the {@link PoolIndex} used for matching, filing each distinct
 * payload under the normalized form of its surface text along with its approval frequency.
 *
 * Because the write path dedupes identical analyses and only shares a payload across tokens with
 * the same normalized surface form, every token under one key truly competes for the same word — so
 * two entries under one key are genuine homographs, never accidental near-duplicates.
 *
 * Keying on the normalized surface form alone, rather than also the writing system, is correct for
 * v1: the pool is a single source project whose word tokens share one writing system, and NFC keeps
 * different scripts on distinct code points, so equal normalized forms already imply the same
 * writing system.
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
 * Derives one token's suggestion from the pool by matching on its normalized surface form, or
 * `undefined` when nothing matches. Callers are responsible for only asking about tokens that have
 * no approved analysis, since an approved token reads its decision rather than a suggestion.
 *
 * @param excludeAnalysisId - An approved payload to discount by one approval before ranking,
 *   previewing the suggestion this token would fall back to if its own approval were removed. Used
 *   the instant an approved gloss is cleared, before the empty value commits, so the preview
 *   matches the pool the committed deletion will produce rather than the approved payload's mere
 *   alternatives.
 */
export function deriveTokenSuggestion(
  poolIndex: PoolIndex,
  surfaceText: string,
  excludeAnalysisId?: string,
): TokenSuggestion | undefined {
  const entries = poolIndex.get(normalizeSurfaceForm(surfaceText));
  if (!entries) return undefined;
  // Common path: the bucket is already ranked best-first by buildPoolIndex, so read it as-is. When
  // discounting this token's own approval, drop that payload's one approval (removing it when this
  // was its last) and re-rank the remainder before reading the head.
  const ranked =
    excludeAnalysisId === undefined
      ? entries
      : entries
          .map((entry) =>
            entry.analysis.id === excludeAnalysisId
              ? { analysis: entry.analysis, frequency: entry.frequency - 1 }
              : entry,
          )
          .filter((entry) => entry.frequency > 0)
          .sort(comparePoolEntries);
  if (ranked.length === 0) return undefined;
  // The head is the suggested pick and the tail are the candidates — no per-call re-sort on the
  // common path. A non-homograph bucket (the common case) has a single entry, so reuse one shared
  // empty array instead of allocating a throwaway `[]` per call.
  return {
    suggested: ranked[0].analysis,
    candidates: ranked.length > 1 ? ranked.slice(1).map((e) => e.analysis) : NO_CANDIDATES,
  };
}

/**
 * One renderable suggestion entry: a payload id, its gloss in the active language, and the
 * assignment status the UI colors and labels it by.
 */
export interface GlossedSuggestionEntry {
  /** The matching payload's id — the approve/promote target and the React key. */
  id: string;
  /** The payload's gloss in the active analysis language; never blank. */
  gloss: string;
  /**
   * How the row is offered: `'suggested'` for the engine's pick on an un-approved token (the
   * "accept" row), or `'candidate'` for a promotable alternative. Carried on the entry rather than
   * re-derived from row position, so dropping a blank-in-language pick can never leave a candidate
   * masquerading as the accept row.
   */
  status: Extract<AssignmentStatus, 'suggested' | 'candidate'>;
}

/**
 * Flattens the merged per-token read into the entries the gloss UI renders, in rank order, keeping
 * only those with a non-blank gloss in the active language.
 *
 * This is the single home of suggestion-presentation policy — which matches are renderable, how a
 * blank-in-active-language pick falls through, the approved payload's exclusion from its own
 * promote list, and each row's assignment status — so every surface ranks, colors, and labels
 * suggestions identically instead of re-deriving any of it from row position.
 *
 * Status is assigned _after_ blank picks are dropped. So when the engine's top pick has no gloss in
 * the active language, the next-ranked glossed match becomes the accept row rather than the whole
 * suggestion vanishing. An already-approved token has no accept row at all: every pool peer is a
 * promotion, so even the top row reads as one.
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
 * Equality predicate for two {@link ResolvedTokenAnalysis} results, for use as a selector's
 * `equalityFn` so a per-token subscription stays referentially stable across unrelated store
 * changes.
 *
 * The selector freshly allocates its wrapper object — and, on the suggested branch, a fresh
 * candidates array — on every call, so a default `Object.is` comparison would re-render every
 * visible suggested token on any store change. Comparing the payloads by reference instead is both
 * correct and cheap, because the pool only ever re-files the same reference-stable store objects:
 * the result is equal whenever the rendered suggestion is unchanged, even when an incidental edit
 * elsewhere rebuilt the pool index around those same payloads.
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
