/**
 * @file Shared phrase-strip setup hooks used by both `SegmentView` and `ContinuousView`.
 *
 *   The two views already share their render path (`PhraseStrip`) and hover-preview state
 *   (`usePhraseHoverState`), but each previously re-declared the same setup logic — the arc-split
 *   handler, the candidate-phrase-id derivation, and the strip-wide context value — verbatim. These
 *   hooks consolidate that logic so the two views can never drift apart in how a split is
 *   dispatched, how hovered candidates resolve to phrase ids, or which fields the leaf components
 *   receive.
 */
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import { usePhraseDispatch, usePhraseLinkByIdMap } from '../components/AnalysisStore';
import type { PhraseStripContextValue } from '../components/PhraseStripContext';
import type { PhraseMode } from '../types/phrase-mode';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';

/**
 * Returns a memoized handler that splits a phrase arc at a token boundary and dispatches the
 * resulting create/update/delete operations via {@link splitPhraseAtBoundary}. The handler no-ops
 * when its `phraseId` is not in the phrase-link-by-id map. Reads the by-id map internally so
 * callers only supply `tokenDocOrder`.
 *
 * @param tokenDocOrder - Word token ref → flat document index, used to keep the split fragments in
 *   document order.
 * @returns A stable `(phraseId, splitAfterTokenRef) => void` callback.
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
 * the arcs of those phrases can be highlighted as link targets. Returns an empty set when nothing
 * is hovered.
 *
 * @param candidateTokenRefs - Token refs a hovered link icon would join into a new phrase.
 * @param phraseLinkByRef - Token ref → phrase link map for the whole strip.
 * @returns The set of `analysisId`s whose phrase contains a candidate token.
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
  /** When true, the link-slot sliding-door transition is suppressed (duration 0ms). */
  skipLinkTransition: boolean;
}>;

/**
 * Builds the memoized strip-wide {@link PhraseStripContextValue} shared by every phrase group and
 * link slot in one render, so the leaf `MemoizedPhraseBox` / `MemoizedTokenLinkIcon` consumers
 * don't re-render on unrelated changes. Centralizing the build keeps the (long) dependency list in
 * one place — `SegmentView` and `ContinuousView` previously each maintained their own copy and
 * could drift apart when a field was added.
 *
 * @param params - The fields each view resolves and passes in.
 * @returns The memoized strip-wide context value.
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
    skipLinkTransition,
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
      skipLinkTransition,
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
      skipLinkTransition,
    ],
  );
}
