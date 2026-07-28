/**
 * Setup hooks shared by both phrase strips — the arc-split handler, the candidate-phrase-id
 * derivation, and the strip-wide context value — so the two views cannot drift apart in how a split
 * is dispatched, how hovered candidates resolve to phrase ids, or which fields the leaves receive.
 */
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import { usePhraseDispatch, usePhraseLinkByIdMap } from '../components/AnalysisStore';
import type { PhraseStripContextValue } from '../components/PhraseStripContext';
import type { PhraseMode } from '../types/phrase-mode';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';

/**
 * Returns the token list of the phrase currently being edited, or `undefined` outside edit mode.
 * Reads the by-id phrase-link map internally so both views share one derivation.
 */
export function useEditPhraseTokens(phraseMode: PhraseMode): TokenSnapshot[] | undefined {
  const phraseLinkById = usePhraseLinkByIdMap();

  return useMemo(
    () =>
      phraseMode.kind === 'edit'
        ? /* v8 ignore next -- phrase always exists in the store when edit mode is entered */
          phraseLinkById.get(phraseMode.phraseId)?.tokens
        : undefined,
    [phraseMode, phraseLinkById],
  );
}

/**
 * Returns a stable handler that splits a phrase arc at a token boundary and dispatches the
 * resulting create, update, and delete operations. Reads the by-id phrase map internally, so
 * callers supply only the document order used to keep the split fragments ordered. Splitting a
 * phrase that is not in the map is a no-op.
 */
export function useArcSplitHandler(
  tokenDocOrder: ReadonlyMap<string, number>,
): (phraseId: string, splitAfterTokenRef: string) => void {
  const phraseLinkById = usePhraseLinkByIdMap();
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

  return useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = phraseLinkById.get(phraseId);
      if (!phraseLink) return;
      splitPhraseAtBoundary(
        phraseLink,
        splitAfterTokenRef,
        { createPhrase, updatePhrase, deletePhrase },
        tokenDocOrder,
      );
    },
    [phraseLinkById, tokenDocOrder, createPhrase, updatePhrase, deletePhrase],
  );
}

/**
 * Derives the set of phrase ids that contain at least one of the hovered link-candidate tokens, so
 * the arcs of those phrases can be highlighted as link targets. Empty when nothing is hovered.
 */
export function useCandidatePhraseIds(
  candidateTokenRefs: ReadonlySet<string>,
  phraseLinkByRef: ReadonlyMap<string, PhraseAnalysisLink>,
): ReadonlySet<string> {
  return useMemo<ReadonlySet<string>>(() => {
    if (candidateTokenRefs.size === 0) return new Set();
    const ids = new Set<string>();
    phraseLinkByRef.forEach((link) => {
      if (link.tokens.some((t) => candidateTokenRefs.has(t.tokenRef))) ids.add(link.analysisId);
    });
    return ids;
  }, [candidateTokenRefs, phraseLinkByRef]);
}

/** Inputs to {@link usePhraseStripContextValue}. */
export type PhraseStripContextParams = Readonly<{
  /** Current phrase-interaction mode; controls rendering and click behavior in all leaves. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; used by phrase boxes to enter edit / confirm-unlink modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token list of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseTokens: PhraseAnalysisLink['tokens'] | undefined;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref → segment id lookup; used in edit mode to disable cross-segment tokens. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Token ref → flat document index; used to keep merged phrase token lists in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Called with a phraseId (or `undefined`) when a phrase or link candidate is hovered. */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Called with the candidate token refs (or `undefined`) when a link icon is hovered. */
  onHoverCandidateTokens: (refs: readonly string[] | undefined) => void;
  /** Called with the would-be-free token refs (or `undefined`) when a split/unlink icon is hovered. */
  onHoverSplitFreeTokens: (refs: readonly string[] | undefined) => void;
  /** When true, link buttons in slots between phrases are hidden outside the active segment. */
  hideInactiveLinkButtons: boolean;
  /** When true, phrase-level interactive controls are hidden on every phrase except the focused one. */
  simplifyPhrases: boolean;
  /** Segment id of the currently active verse, or `undefined` when nothing is active. */
  activeSegmentId: string | undefined;
  /** Tooltip shown on disabled link buttons because they are outside the focused segment. */
  crossSegmentLinkTooltip: string;
  /** Label and concise tooltip for the merge boundary button, fetched once per strip. */
  boundaryMergeLabel: string;
  /** Tooltip advertising the Alt-split gesture on the merge button while Alt is up. */
  boundaryMergeAltHint: string;
  /** Label and tooltip for the Alt-gated split marker. */
  boundarySplitLabel: string;
  /** Placeholder for all gloss inputs, fetched once per strip rather than per token. */
  glossPlaceholder: string;
  /** When true, the link-slot sliding-door transition is suppressed (duration 0ms). */
  skipLinkTransition: boolean;
  /** When true, morpheme rows and per-morpheme glosses are shown beneath each word token. */
  showMorphology: boolean;
}>;

/**
 * Builds the memoized strip-wide {@link PhraseStripContextValue} shared by every phrase group and
 * link slot in one render, so the memoized leaves don't re-render on unrelated changes.
 * Centralizing the build keeps the long dependency list in one place, so the two views cannot drift
 * apart when a field is added.
 */
export function usePhraseStripContextValue(
  params: PhraseStripContextParams,
): PhraseStripContextValue {
  const {
    phraseMode,
    setPhraseMode,
    editPhraseTokens,
    editPhraseSegmentId,
    tokenSegmentMap,
    tokenDocOrder,
    onHoverPhrase,
    onHoverCandidateTokens,
    onHoverSplitFreeTokens,
    hideInactiveLinkButtons,
    simplifyPhrases,
    activeSegmentId,
    crossSegmentLinkTooltip,
    boundaryMergeLabel,
    boundaryMergeAltHint,
    boundarySplitLabel,
    glossPlaceholder,
    skipLinkTransition,
    showMorphology,
  } = params;

  return useMemo<PhraseStripContextValue>(
    () => ({
      phraseMode,
      setPhraseMode,
      editPhraseTokens,
      editPhraseSegmentId,
      tokenSegmentMap,
      tokenDocOrder,
      onHoverPhrase,
      onHoverCandidateTokens,
      onHoverSplitFreeTokens,
      hideInactiveLinkButtons,
      simplifyPhrases,
      activeSegmentId,
      crossSegmentLinkTooltip,
      boundaryMergeLabel,
      boundaryMergeAltHint,
      boundarySplitLabel,
      glossPlaceholder,
      skipLinkTransition,
      showMorphology,
    }),
    [
      phraseMode,
      setPhraseMode,
      editPhraseTokens,
      editPhraseSegmentId,
      tokenSegmentMap,
      tokenDocOrder,
      onHoverPhrase,
      onHoverCandidateTokens,
      onHoverSplitFreeTokens,
      hideInactiveLinkButtons,
      simplifyPhrases,
      activeSegmentId,
      crossSegmentLinkTooltip,
      boundaryMergeLabel,
      boundaryMergeAltHint,
      boundarySplitLabel,
      glossPlaceholder,
      skipLinkTransition,
      showMorphology,
    ],
  );
}
