/**
 * Setup hooks for a phrase strip — the arc-split handler, the candidate-phrase-id derivation, and
 * the strip-wide context value. Each is the single definition of its behavior, so no strip layout
 * can differ in how a split is dispatched, how hovered candidates resolve to phrase ids, or which
 * fields the leaves receive.
 */
import { useLocalizedStrings } from '@papi/frontend/react';
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import { usePhraseDispatch, usePhraseLinkByIdMap } from '../components/AnalysisStore';
import {
  TOKEN_CHIP_LABEL_KEYS,
  type PhraseStripContextValue,
  type TokenChipLabels,
} from '../components/PhraseStripContext';
import type { PhraseMode } from '../types/phrase-mode';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';

/**
 * Returns the token list of the phrase currently being edited, or `undefined` outside edit mode.
 * Resolves the phrase link itself, so callers need not thread the by-id map through.
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

/**
 * Localize keys behind {@link TokenChipLabels}. Hoisted to module scope because the PAPI hook
 * requires a reference-stable key array; a fresh literal each render re-fetches every render.
 */
const TOKEN_CHIP_STRING_KEYS = Object.values(TOKEN_CHIP_LABEL_KEYS);

/**
 * Resolves the labels every word token's chip formats for itself, in one lookup for the whole
 * strip. The bundle keeps a stable identity while the strings are unchanged, so passing it down
 * cannot invalidate a memoized chip.
 *
 * The bundle's identity turns on the strings by value, never on the localization hook handing back
 * the same record object twice — so a hook whose error path rebuilds that record cannot silently
 * churn the whole strip context along with it.
 */
function useTokenChipLabels(): TokenChipLabels {
  const [strings] = useLocalizedStrings(TOKEN_CHIP_STRING_KEYS);
  const tokenGloss = strings[TOKEN_CHIP_LABEL_KEYS.tokenGloss];
  const showSuggestions = strings[TOKEN_CHIP_LABEL_KEYS.showSuggestions];
  const defineMorphemes = strings[TOKEN_CHIP_LABEL_KEYS.defineMorphemes];
  const editMorphemes = strings[TOKEN_CHIP_LABEL_KEYS.editMorphemes];
  const morphemeGloss = strings[TOKEN_CHIP_LABEL_KEYS.morphemeGloss];
  const acceptSuggestion = strings[TOKEN_CHIP_LABEL_KEYS.acceptSuggestion];
  const promoteSuggestion = strings[TOKEN_CHIP_LABEL_KEYS.promoteSuggestion];
  const suggestionBreakdown = strings[TOKEN_CHIP_LABEL_KEYS.suggestionBreakdown];

  return useMemo(
    () => ({
      tokenGloss,
      showSuggestions,
      defineMorphemes,
      editMorphemes,
      morphemeGloss,
      acceptSuggestion,
      promoteSuggestion,
      suggestionBreakdown,
    }),
    [
      tokenGloss,
      showSuggestions,
      defineMorphemes,
      editMorphemes,
      morphemeGloss,
      acceptSuggestion,
      promoteSuggestion,
      suggestionBreakdown,
    ],
  );
}

/** Inputs to {@link usePhraseStripContextValue}. */
export type PhraseStripContextParams = Readonly<{
  /** Current phrase-interaction mode; controls rendering and click behavior in all leaves. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; entering edit or confirm-unlink mode goes through it. */
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
  /** Accessible label for the link button between two tokens, fetched once per strip. */
  linkTokensLabel: string;
  /** Accessible label for the unlink button between two tokens already in one phrase. */
  unlinkTokensLabel: string;
  /** Accessible label for a phrase box's gloss input, fetched once per strip. */
  phraseGlossLabel: string;
  /** Accessible label for the edit button on a phrase's floating controls pill. */
  phraseEditLabel: string;
  /** Accessible label for the unlink button on a phrase's floating controls pill. */
  phraseUnlinkLabel: string;
  /** Accessible label for a token's remove (✕) button, with `{token}` still to be substituted. */
  removeTokenFromPhraseTemplate: string;
  /** Accessible label for adding a free token to the edited phrase, with `{token}` unsubstituted. */
  addTokenToPhraseTemplate: string;
  /** Label and concise tooltip for the merge boundary button, fetched once per strip. */
  boundaryMergeLabel: string;
  /**
   * Tooltip advertising the Alt-split gesture on the merge button while Alt is up, with its `{key}`
   * placeholder still unfilled.
   */
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
 * Builds the memoized strip-wide {@link PhraseStripContextValue} for one render, so the memoized
 * leaves don't re-render on unrelated changes. The single build site for the value, keeping its
 * long dependency list in one place so adding a field cannot reach one strip layout and miss
 * another.
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
    linkTokensLabel,
    unlinkTokensLabel,
    phraseGlossLabel,
    phraseEditLabel,
    phraseUnlinkLabel,
    removeTokenFromPhraseTemplate,
    addTokenToPhraseTemplate,
    boundaryMergeLabel,
    boundaryMergeAltHint,
    boundarySplitLabel,
    glossPlaceholder,
    skipLinkTransition,
    showMorphology,
  } = params;

  const tokenChipLabels = useTokenChipLabels();

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
      linkTokensLabel,
      unlinkTokensLabel,
      phraseGlossLabel,
      phraseEditLabel,
      phraseUnlinkLabel,
      removeTokenFromPhraseTemplate,
      addTokenToPhraseTemplate,
      boundaryMergeLabel,
      boundaryMergeAltHint,
      boundarySplitLabel,
      glossPlaceholder,
      tokenChipLabels,
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
      linkTokensLabel,
      unlinkTokensLabel,
      phraseGlossLabel,
      phraseEditLabel,
      phraseUnlinkLabel,
      removeTokenFromPhraseTemplate,
      addTokenToPhraseTemplate,
      boundaryMergeLabel,
      boundaryMergeAltHint,
      boundarySplitLabel,
      glossPlaceholder,
      tokenChipLabels,
      skipLinkTransition,
      showMorphology,
    ],
  );
}
