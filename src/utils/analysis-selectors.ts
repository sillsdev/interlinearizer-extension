import { createSelector } from '@reduxjs/toolkit';
import type {
  MorphemeAnalysis,
  PhraseAnalysisLink,
  SenseRef,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { morphemeCarriesAnnotation } from './analysis-identity';
import type { StaleFreeTranslation } from './stale-free-translations';
import { preferredLinkByKey } from './pick-rules';
import {
  buildPoolIndex,
  deriveTokenSuggestion,
  withoutAnalyses,
  withPendingAnalyses,
  type PoolIndex,
  type ResolvedTokenAnalysis,
  type TokenSuggestion,
} from './suggestion-engine';

// #region Types

/** A `TextAnalysis` and the language its glosses and free translations are read in. */
export type AnalysisState = {
  /** The analysis that the selectors read. */
  analysis: TextAnalysis;
  /** BCP 47 tag identifying the language used when reading gloss values. */
  analysisLanguage: string;
};

// #endregion

/**
 * The annotated forms a re-split to `forms` would strand: those whose morpheme carries a gloss or a
 * lexicon reference and which the new breakdown leaves no morpheme to hold, in the order the old
 * breakdown listed them. Empty when the re-split keeps every annotated form, which is the common
 * case.
 *
 * Forms are matched as a re-split itself matches them — by form, first-come-first-served within a
 * repeated form — so the answer can never disagree with what the write goes on to drop. A form is
 * counted once per occurrence: re-splitting "ba ba" to a single "ba" strands the second.
 *
 * Bare forms are left out. Losing one costs only the segmentation, which the reader is retyping
 * anyway, and prompting about it would train them to click through the prompt that does carry a
 * loss.
 */
export function morphemeFormsLostByResplit(
  old: readonly MorphemeAnalysis[] | undefined,
  forms: readonly string[],
): string[] {
  const remaining = new Map<string, number>();
  forms.forEach((form) => remaining.set(form, (remaining.get(form) ?? 0) + 1));
  return (old ?? []).reduce<string[]>((lost, morpheme) => {
    const spare = remaining.get(morpheme.form) ?? 0;
    if (spare > 0) remaining.set(morpheme.form, spare - 1);
    else if (morphemeCarriesAnnotation(morpheme)) lost.push(morpheme.form);
    return lost;
  }, []);
}

// #region Selectors

/** Projects `tokenAnalyses` out of `AnalysisState` for use as a `createSelector` input. */
const selectTokenAnalyses = (state: AnalysisState) => state.analysis.tokenAnalyses;

/** Projects `tokenAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
const selectTokenAnalysisLinks = (state: AnalysisState) => state.analysis.tokenAnalysisLinks;

/** Projects `analysisLanguage` out of `AnalysisState` for use as a `createSelector` input. */
export const selectAnalysisLanguage = (state: AnalysisState) => state.analysisLanguage;

/**
 * Memoized selector that builds a `Map` from `TokenAnalysis.id` to `TokenAnalysis` for O(1) lookup.
 * Recomputes only when `tokenAnalyses` changes reference.
 */
const selectAnalysisById = createSelector(
  selectTokenAnalyses,
  (tokenAnalyses) => new Map(tokenAnalyses.map((ta) => [ta.id, ta])),
);

/**
 * Memoized selector that builds a `Map` from `tokenRef` to the approved `TokenAnalysis.id` for that
 * token. Of several approved links on one token (the data model allows at most one), the one an
 * approval tie resolves to is indexed; links naming no payload are left out. Recomputes only when
 * `tokenAnalysisLinks` or `tokenAnalyses` change reference.
 */
const selectApprovedIdByTokenRef = createSelector(
  selectTokenAnalysisLinks,
  selectAnalysisById,
  (links, byId) => {
    const winners = preferredLinkByKey(links, (link) =>
      link.status === 'approved' && byId.has(link.analysisId) ? link.token.tokenRef : undefined,
    );
    return new Map([...winners].map(([tokenRef, link]) => [tokenRef, link.analysisId]));
  },
);

const NO_PENDING: readonly TokenAnalysis[] = [];

/**
 * Memoized selector mapping each token to the payloads its persisted non-approved links hold — what
 * an import records without approving — best-first: `'suggested'` links ahead of the rest, each in
 * link order. `'rejected'`, `'stale'`, and orphaned links are left out, a stale link's ref possibly
 * naming a different word by now, and a payload a token links twice is listed once.
 */
const selectPendingAnalysesByTokenRef = createSelector(
  selectTokenAnalysisLinks,
  selectAnalysisById,
  (links, byId) => {
    const index = new Map<string, TokenAnalysis[]>();
    const file = (link: TokenAnalysisLink) => {
      const analysis = byId.get(link.analysisId);
      if (!analysis) return;
      const pending = index.get(link.token.tokenRef);
      if (!pending) index.set(link.token.tokenRef, [analysis]);
      else if (!pending.includes(analysis)) pending.push(analysis);
    };
    links.forEach((l) => {
      if (l.status === 'suggested') file(l);
    });
    links.forEach((l) => {
      if (l.status === 'candidate') file(l);
    });
    return index;
  },
);

/** Memoized selector mapping each token to the ids of the payloads it links as `'rejected'`. */
const selectRejectedAnalysisIdsByTokenRef = createSelector(selectTokenAnalysisLinks, (links) => {
  const index = new Map<string, Set<string>>();
  links.forEach((l) => {
    if (l.status !== 'rejected') return;
    const rejected = index.get(l.token.tokenRef);
    if (rejected) rejected.add(l.analysisId);
    else index.set(l.token.tokenRef, new Set([l.analysisId]));
  });
  return index;
});

/**
 * Returns the approved gloss string for `tokenRef` in the active analysis language, or `''` when no
 * approved analysis exists or the analysis has no gloss for the active language.
 */
export function selectApprovedGloss(state: AnalysisState, tokenRef: string): string {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return '';
  const ta = selectAnalysisById(state).get(approvedId);
  const lang = selectAnalysisLanguage(state);
  return ta?.gloss?.[lang] ?? '';
}

/**
 * Returns the sense ref on `tokenRef`'s approved analysis, or `undefined` when the token has no
 * approved analysis or the analysis has no sense ref.
 */
export function selectApprovedGlossSenseRef(
  state: AnalysisState,
  tokenRef: string,
): SenseRef | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return undefined;
  return selectAnalysisById(state).get(approvedId)?.glossSenseRef;
}

/**
 * Memoized selector mapping each approved `TokenAnalysis.id` to the number of distinct tokens whose
 * approved link points at it — the blast radius of a global edit to that payload. At most one
 * approved analysis per token is counted, so multiple approved links on the same token are never
 * double-counted. Recomputes only when the approved-analysis index changes reference.
 */
const selectApprovedTokenCountByAnalysisId = createSelector(
  selectApprovedIdByTokenRef,
  (idByTokenRef) => {
    const counts = new Map<string, number>();
    idByTokenRef.forEach((analysisId) => {
      counts.set(analysisId, (counts.get(analysisId) ?? 0) + 1);
    });
    return counts;
  },
);

/**
 * Memoized selector that builds the suggestion-engine pool index from the approved analyses: each
 * distinct approved payload filed under its normalized surface form with its approval frequency.
 * This is the read-only corpus the engine derives suggestions from — only approved analyses enter,
 * since the frequencies it is built from count approved links alone. Recomputes only when
 * `tokenAnalyses` or `tokenAnalysisLinks` change reference.
 */
export const selectPoolIndex = createSelector(
  selectAnalysisById,
  selectApprovedTokenCountByAnalysisId,
  buildPoolIndex,
);

/**
 * What deleting a `TokenAnalysis` would do to the tokens that approve it, so a delete can be
 * announced with its concrete consequence.
 */
export interface AnalysisDeletionOutcome {
  /**
   * `'blank'` when the affected tokens are left reading as unanalyzed, `'fallback'` when another
   * analysis takes over for any of them or, where `uncertain`, may.
   */
  kind: 'blank' | 'fallback';
  /** How many tokens the deletion affects. */
  usageCount: number;
  /**
   * What the affected tokens will read once the deletion commits. Absent when `uncertain`, or when
   * the analysis they will read carries no gloss in the active analysis language, leaving no word
   * to quote at the user.
   */
  fallbackGloss?: string;
  /**
   * Whether the affected tokens may not all come to read the same thing — because they would read
   * different analyses, or some cannot be read to tell.
   */
  uncertain?: boolean;
  /**
   * How many tokens record this analysis without approving it — an import's unreviewed records,
   * offered to those tokens as suggestions. They go with the deletion like the approvals do.
   */
  unappliedCount: number;
}

/**
 * Reports what {@link deleteAnalyses} would do to the given row, for its announcement to name.
 * Returns `undefined` when the id resolves to no payload, so a stale row cannot delete a record
 * that is already gone.
 *
 * Judges each affected token's fallback as the renderer will: its own surviving unapproved records
 * first, then the pool's match for its text as it now stands less any analysis it rejected, read
 * through `liveSurfaceText`. A ref with no live text is skipped when `isReadable` accepts it,
 * because the text that was read no longer holds that token. Any other ref with no live text leaves
 * the outcome `uncertain`.
 */
export function selectAnalysisDeletionOutcome(
  state: AnalysisState,
  analysisId: string,
  liveSurfaceText: (tokenRef: string) => string | undefined,
  isReadable: (tokenRef: string) => boolean,
): AnalysisDeletionOutcome | undefined {
  const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
  if (!analysis) return undefined;

  const approvedTokenCounts = selectApprovedTokenCountByAnalysisId(state);

  // Counted off the same index the catalog row counts by, so the confirmation and the row it opened
  // from cannot name two different numbers: both count the tokens an approval sits on rather than
  // the approvals themselves.
  //
  // Non-approved links are left out of this number though the deletion drops them too: they are not
  // places the analysis is applied, so counting one here would name a consequence no token displays.
  const usageCount = approvedTokenCounts.get(analysisId) ?? 0;

  // Counted by distinct token, matching usageCount, so a token an import recorded twice reads as the
  // one place it is that the deletion touches.
  const unappliedCount = new Set(
    state.analysis.tokenAnalysisLinks
      .filter((l) => l.analysisId === analysisId && l.status !== 'approved')
      .map((l) => l.token.tokenRef),
  ).size;

  // The fallback is what the affected tokens come to read, so a record nothing approves has none
  // however many homographs the pool still offers for its form.
  if (usageCount === 0) return { kind: 'blank', usageCount, unappliedCount };

  // Ask the engine, so the confirmation names the peer that actually wins. The payload is dropped
  // from the pool outright rather than discounted by one approval: a deletion removes all of its
  // approvals at once, and a discounted multi-token payload would compete to replace itself.
  const survivingPool = buildPoolIndex(
    selectAnalysisById(state),
    new Map([...approvedTokenCounts].filter(([id]) => id !== analysisId)),
  );

  // A token reads its own record whatever its text, so only a pool pick needs the live form.
  const pendingByToken = selectPendingAnalysesByTokenRef(state);
  const rejectedByToken = selectRejectedAnalysisIdsByTokenRef(state);
  const picks = new Set<TokenAnalysis | undefined>();
  let unreadable = false;
  state.analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.analysisId !== analysisId || l.status !== 'approved') return;
    const { tokenRef } = l.token;
    const recorded = pendingByToken.get(tokenRef)?.find((ta) => ta.id !== analysisId);
    if (recorded) {
      picks.add(recorded);
      return;
    }
    const live = liveSurfaceText(tokenRef);
    if (live === undefined) {
      if (isReadable(tokenRef)) return;
      unreadable = true;
      return;
    }
    picks.add(
      withoutAnalyses(deriveTokenSuggestion(survivingPool, live), rejectedByToken.get(tokenRef))
        ?.suggested,
    );
  });

  if (unreadable || picks.size > 1)
    return { kind: 'fallback', usageCount, unappliedCount, uncertain: true };
  const [pick] = picks;
  if (!pick) return { kind: 'blank', usageCount, unappliedCount };

  const gloss = pick.gloss?.[state.analysisLanguage];
  return {
    kind: 'fallback',
    usageCount,
    unappliedCount,
    ...(gloss ? { fallbackGloss: gloss } : {}),
  };
}

/**
 * What `tokenRef` is offered: its own persisted non-approved analyses ranked ahead of the `pool`
 * offer, less any analysis the token rejected.
 */
function offerForToken(
  state: AnalysisState,
  tokenRef: string,
  pool: TokenSuggestion | undefined,
): TokenSuggestion | undefined {
  return withPendingAnalyses(
    selectPendingAnalysesByTokenRef(state).get(tokenRef) ?? NO_PENDING,
    withoutAnalyses(pool, selectRejectedAnalysisIdsByTokenRef(state).get(tokenRef)),
  );
}

/**
 * Returns the merged analysis the renderer shows for a token: its approved decision when one
 * exists, otherwise what it is offered, or `undefined` when the token has neither. What a token is
 * offered is its own persisted non-approved analyses ranked ahead of the pool's match for its
 * surface form, less any analysis it rejected. This is the single source the gloss renderer reads —
 * it never combines stored decisions and the derived view itself. An approved token carries the
 * offer only as promotable alternatives, so a confirmed token never shows a suggestion.
 *
 * Unlike the reference-stable per-token reads ({@link selectApprovedGloss} returns a primitive,
 * {@link selectApprovedMorphemes} a stable array), this freshly allocates its result object — and
 * the suggested branch a fresh `candidates` array — on every call. A `useSelector` consumer must
 * therefore NOT rely on the default `Object.is` equality: subscribe through a per-token memoized
 * selector or pass a shallow/custom `equalityFn` (or `useMemo` the result), or every change to the
 * held pages will re-render the token.
 *
 * @param state - The analysis state that holds the token's decisions.
 * @param tokenRef - The token to resolve.
 * @param surfaceText - The token's surface form, matched against `pool`.
 * @param pool - The pool to match against; defaults to the one built from `state`.
 */
export function selectResolvedTokenAnalysis(
  state: AnalysisState,
  tokenRef: string,
  surfaceText: string,
  pool: PoolIndex = selectPoolIndex(state),
): ResolvedTokenAnalysis | undefined {
  const offered = offerForToken(state, tokenRef, deriveTokenSuggestion(pool, surfaceText));
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId !== undefined) {
    const analysis = selectAnalysisById(state).get(approvedId);
    /* v8 ignore next -- approvedId comes from the byId-filtered approved map, so the payload is present */
    if (!analysis) return undefined;
    return { status: 'approved', analysis, alternatives: offered };
  }
  return offered ? { status: 'suggested', ...offered } : undefined;
}

/**
 * Returns the suggestion a token would resolve to if its own approval were removed — the preview
 * the gloss UI shows the instant an approved gloss is cleared, before the empty value commits on
 * blur. Re-derives this surface form's bucket with the token's approved payload discounted by one
 * approval (dropped when this was its last), so the previewed pick matches what the committed
 * deletion will surface rather than the approved payload's mere alternatives. The token's own
 * persisted non-approved analyses rank ahead and those it rejected are left out, as once the
 * deletion commits. Returns `undefined` when the token has no approval (callers only consult this
 * for an approved token) or when nothing is left to offer once that approval is discounted.
 *
 * @param state - The analysis state that holds the token's decisions.
 * @param tokenRef - The approved token whose gloss is being cleared.
 * @param surfaceText - The token's surface form, matched against `pool`.
 * @param pool - The pool to match against; defaults to the one built from `state`.
 */
export function selectSuggestionAfterClearing(
  state: AnalysisState,
  tokenRef: string,
  surfaceText: string,
  pool: PoolIndex = selectPoolIndex(state),
): ResolvedTokenAnalysis | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return undefined;
  const suggestion = offerForToken(
    state,
    tokenRef,
    deriveTokenSuggestion(pool, surfaceText, approvedId),
  );
  return suggestion ? { status: 'suggested', ...suggestion } : undefined;
}

/**
 * Returns the id of `tokenRef`'s approved analysis when its breakdown is stale, or `undefined` when
 * the token has no approval or its breakdown is not stale.
 */
export function selectStaleMorphemesAnalysisId(
  state: AnalysisState,
  tokenRef: string,
): string | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return undefined;
  return selectAnalysisById(state).get(approvedId)?.morphemesStale ? approvedId : undefined;
}

const EMPTY_MORPHEMES: readonly MorphemeAnalysis[] = [];

/**
 * Returns the morpheme array from the approved `TokenAnalysis` for `tokenRef`, or a shared
 * reference-stable empty array when no approved analysis exists or it has no morphemes.
 */
export function selectApprovedMorphemes(
  state: AnalysisState,
  tokenRef: string,
): readonly MorphemeAnalysis[] {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return EMPTY_MORPHEMES;
  const ta = selectAnalysisById(state).get(approvedId);
  return ta?.morphemes ?? EMPTY_MORPHEMES;
}

/**
 * Returns the analysis that an unapproved token holds from its own records — the first glossed in
 * the active language, as its gloss field would offer, else the first at all — or `undefined` when
 * the token has an approval or holds no such record.
 */
export function selectUnapprovedTokenAnalysis(
  state: AnalysisState,
  tokenRef: string,
): TokenAnalysis | undefined {
  if (selectApprovedIdByTokenRef(state).has(tokenRef)) return undefined;
  const pending = selectPendingAnalysesByTokenRef(state).get(tokenRef);
  return (
    pending?.find((analysis) => (analysis.gloss?.[state.analysisLanguage] ?? '') !== '') ??
    pending?.[0]
  );
}

/** Projects `phraseAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
const selectPhraseAnalysisLinksRaw = (state: AnalysisState) => state.analysis.phraseAnalysisLinks;

/**
 * Memoized selector that returns all approved `PhraseAnalysisLink`s. Recomputes only when
 * `phraseAnalysisLinks` changes reference.
 */
export const selectPhraseLinks = createSelector(selectPhraseAnalysisLinksRaw, (links) =>
  links.filter((l) => l.status === 'approved'),
);

/**
 * Memoized selector that builds a `Map` from each `tokenRef` to the approved `PhraseAnalysisLink`
 * containing it. When a token appears in multiple approved links (data-model violation), the last
 * wins. Recomputes only when approved phrase links change.
 */
export const selectPhraseLinkByTokenRef = createSelector(selectPhraseLinks, (links) => {
  const map = new Map<string, PhraseAnalysisLink>();
  links.forEach((link) => link.tokens.forEach((snap) => map.set(snap.tokenRef, link)));
  return map;
});

/**
 * Memoized selector that builds a `Map` from `PhraseAnalysisLink.id` to approved
 * `PhraseAnalysisLink` for O(1) lookup of a phrase occurrence. Recomputes only when approved phrase
 * links change.
 */
export const selectPhraseLinkById = createSelector(
  selectPhraseLinks,
  (links) => new Map(links.map((link) => [link.id, link])),
);

/**
 * Returns the gloss the phrase occurrence `phraseId` reads in the active analysis language, or `''`
 * when the occurrence or its payload is not found or it has no gloss for the active language.
 */
export function selectPhraseGloss(state: AnalysisState, phraseId: string): string {
  const link = state.analysis.phraseAnalysisLinks.find((l) => l.id === phraseId);
  if (!link) return '';
  const pa = state.analysis.phraseAnalyses.find((p) => p.id === link.analysisId);
  return pa?.gloss?.[state.analysisLanguage] ?? '';
}

/**
 * Returns the sense ref on the payload of the phrase occurrence `phraseId`. Returns `undefined`
 * when the occurrence or its payload is missing, or when the payload has no sense ref.
 */
export function selectPhraseSenseRef(state: AnalysisState, phraseId: string): SenseRef | undefined {
  const link = state.analysis.phraseAnalysisLinks.find((l) => l.id === phraseId);
  if (!link) return undefined;
  return state.analysis.phraseAnalyses.find((p) => p.id === link.analysisId)?.senseRef;
}

/** Projects `segmentAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
const selectSegmentAnalysisLinks = (state: AnalysisState) => state.analysis.segmentAnalysisLinks;

/** Projects `segmentAnalyses` out of `AnalysisState` for use as a `createSelector` input. */
const selectSegmentAnalyses = (state: AnalysisState) => state.analysis.segmentAnalyses;

/**
 * Memoized selector mapping each segment to its approved `SegmentAnalysis`, the one an approval tie
 * resolves to where several are approved. A link naming no payload is left out (read-only here; the
 * orphan is repaired on the next write).
 */
const selectApprovedSegmentAnalysisBySegment = createSelector(
  selectSegmentAnalysisLinks,
  selectSegmentAnalyses,
  (links, analyses) => {
    const byId = new Map(analyses.map((a) => [a.id, a]));
    const approved = links.flatMap((link) => {
      const analysis = byId.get(link.analysisId);
      return link.status === 'approved' && analysis ? [{ ...link, analysis }] : [];
    });
    const winners = preferredLinkByKey(approved, (link) => link.segmentId);
    return new Map([...winners].map(([segmentId, { analysis }]) => [segmentId, analysis]));
  },
);

/**
 * Returns the approved free-translation string for the given segment in the active analysis
 * language, or `''` when no approved analysis exists or it has no free translation for the active
 * language.
 */
export function selectSegmentFreeTranslation(state: AnalysisState, segmentId: string): string {
  const sa = selectApprovedSegmentAnalysisBySegment(state).get(segmentId);
  return sa?.freeTranslation?.[state.analysisLanguage] ?? '';
}

/**
 * Memoized selector returning the id of every segment holding an approved free translation, in
 * whatever language.
 */
export const selectSegmentsWithApprovedTranslation = createSelector(
  selectSegmentAnalysisLinks,
  (links): ReadonlySet<string> =>
    new Set(links.filter((link) => link.status === 'approved').map((link) => link.segmentId)),
);

/**
 * Memoized selector returning the free translation of every segment carrying a non-empty one in the
 * active analysis language, keyed by segment id.
 */
export const selectFreeTranslationsBySegment = createSelector(
  selectApprovedSegmentAnalysisBySegment,
  selectAnalysisLanguage,
  (approved, language) => {
    const bySegment = new Map<string, string>();
    approved.forEach((analysis, segmentId) => {
      const text = analysis.freeTranslation?.[language] ?? '';
      if (text !== '') bySegment.set(segmentId, text);
    });
    return bySegment;
  },
);

/**
 * Memoized selector listing every stale free translation with its text in the active analysis
 * language, `''` where it has none there, in link order.
 */
export const selectStaleFreeTranslations = createSelector(
  selectSegmentAnalysisLinks,
  selectSegmentAnalyses,
  selectAnalysisLanguage,
  (links, analyses, language): readonly StaleFreeTranslation[] => {
    const byId = new Map(analyses.map((a) => [a.id, a]));
    return links.flatMap((link) => {
      const analysis = byId.get(link.analysisId);
      if (link.status !== 'stale' || !analysis) return [];
      return [
        {
          analysisId: link.analysisId,
          segmentId: link.segmentId,
          text: analysis.freeTranslation?.[language] ?? '',
        },
      ];
    });
  },
);

// #endregion
