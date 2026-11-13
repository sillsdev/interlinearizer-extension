import type {
  Book,
  MergedContent,
  MorphemeAnalysis,
  PhraseAnalysisLink,
  SenseRef,
  TextAnalysis,
  TokenAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import { perfMarksEnabled, perfMeasureFromFirst } from '../utils/perf-marks';
import {
  selectAnalysis,
  selectAnalysisLanguage,
  selectApprovedGloss,
  selectApprovedGlossSenseRef,
  selectApprovedMorphemes,
  selectMorphemePayloadIsSolelyOwned,
  selectMorphemeResetLosesAnnotation,
  selectPhraseLinkById,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectPhraseSenseRef,
  selectResolvedTokenAnalysis,
  selectSuggestionAfterClearing,
  selectSegmentFreeTranslation,
  selectFreeTranslationsBySegment,
  selectSegmentsWithApprovedTranslation,
  selectStaleFreeTranslations,
  selectStaleMorphemesAnalysisId,
  selectUnapprovedTokenAnalysis,
  type AnalysisState,
} from '../utils/analysis-selectors';
import useLatestRef from '../hooks/useLatestRef';
import type { AnalysisEditOutcome } from '../utils/edit-outcome';
import type { Settles } from '../utils/settles';
import type { PageClient } from '../cache/pageClient';
import type { WholeAnalysis } from '../cache/wholeAnalysis';
import {
  PageClientProvider,
  usePagePoolSelector,
  useRepliesApplied,
  usePageSelector,
  useWholeSelector as useSessionWholeSelector,
} from '../cache/pageHooks';
import { useGlossCommand, useRemovalPreviews } from '../cache/sessionEdits';
import {
  placeStaleFreeTranslations,
  type PlacedStaleFreeTranslations,
} from '../utils/stale-free-translations';
import { resolvedTokenAnalysisEqual, type ResolvedTokenAnalysis } from '../utils/suggestion-engine';

export {
  useAnalysisRowDispatch,
  useApproveAnalysisDispatch,
  useConfirmMorphemesDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemeGlossDispatch,
  usePhraseDispatch,
  usePhraseGlossDispatch,
  useSegmentFreeTranslationDispatch,
  useStaleFreeTranslationDispatch,
  useStaleLocationDispatch,
} from '../cache/sessionEdits';

// #region Internal context

/** The callbacks that the enclosing provider gives every analysis hook beneath it. */
type ProviderCallbacks = {
  /**
   * Stable callback a gloss input calls to register (`true`) or unregister (`false`) itself as
   * currently holding uncommitted text. Gloss edits are committed only on blur, so without this the
   * provider could not tell the parent that an edit is in progress until then. The provider counts
   * active editors and reports the 0↔non-0 crossings via the `onPendingEditsChange` prop, driving
   * the tab's unsaved indicator while the user types.
   */
  reportEditing: (active: boolean) => void;
  /**
   * Stable entry point {@link useGlossDispatch} returns for writing a gloss. Every gloss edit is
   * per-token: editing one token never rewrites the other tokens that share its analysis. (Editing
   * every occurrence of a shared analysis is deferred; see user-questions.md "separating per-token
   * edits from global analysis edits".)
   */
  requestGlossEdit: (tokenRef: string, surfaceText: string, value: string) => void;
  /**
   * Whether the provider holds a read-only analysis ({@link useAnalysisReadOnly}). Carried on the
   * provider so every editing affordance in the tree can render its static form without threading a
   * prop.
   */
  readOnly: boolean;
};

/** Internal context that carries the enclosing analysis provider's callbacks. */
const AnalysisCallbackCtx = createContext<ProviderCallbacks | undefined>(undefined);

// #endregion

// #region Provider

/**
 * Counts the gloss inputs holding uncommitted text, telling `onPendingEditsChange` each time the
 * count leaves or returns to zero.
 *
 * @returns The stable callback that each input reports its editing through.
 */
function usePendingEdits(
  onPendingEditsChange: ((pending: boolean) => void) | undefined,
): (active: boolean) => void {
  const onChangeRef = useLatestRef(onPendingEditsChange);
  // A ref, so an input registering never re-renders the provider.
  const countRef = useRef(0);
  return useCallback(
    (active: boolean) => {
      const wasPending = countRef.current > 0;
      countRef.current += active ? 1 : -1;
      const isPending = countRef.current > 0;
      if (wasPending !== isPending) onChangeRef.current?.(isPending);
    },
    [onChangeRef],
  );
}

/** Props for {@link SessionAnalysisProvider}. */
type SessionAnalysisProviderProps = Readonly<{
  children: ReactNode;
  /** Holds the open book's pages, and sends the session's edits. */
  client: PageClient;
  /** The session's whole analysis, for the answers that span books. */
  whole: WholeAnalysis;
  sessionId: string;
  /** The BCP 47 tag that glosses and free translations are read in. */
  analysisLanguage: string;
  /**
   * Called with `true` when a gloss input starts holding uncommitted text, and with `false` once
   * none does.
   */
  onPendingEditsChange?: (pending: boolean) => void;
  /** When `true`, the subtree renders the analysis read-only, as for a Paratext 9 import. */
  readOnly?: boolean;
}>;

/** Gives the subtree a session's analysis, read from its pages and edited through its commands. */
export function SessionAnalysisProvider({
  children,
  client,
  whole,
  sessionId,
  analysisLanguage,
  onPendingEditsChange,
  readOnly = false,
}: SessionAnalysisProviderProps) {
  return (
    <PageClientProvider
      client={client}
      whole={whole}
      sessionId={sessionId}
      analysisLanguage={analysisLanguage}
    >
      <SessionCallbacks onPendingEditsChange={onPendingEditsChange} readOnly={readOnly}>
        {children}
      </SessionCallbacks>
    </PageClientProvider>
  );
}

/** Gives its subtree the analysis callbacks, with gloss edits sent to the session. */
function SessionCallbacks({
  children,
  onPendingEditsChange,
  readOnly,
}: Pick<SessionAnalysisProviderProps, 'children' | 'onPendingEditsChange'> & {
  readOnly: boolean;
}) {
  const reportEditing = usePendingEdits(onPendingEditsChange);
  const requestGlossEdit = useGlossCommand();
  const callbackRefs = useMemo(
    () => ({
      reportEditing,
      requestGlossEdit,
      readOnly,
    }),
    [reportEditing, requestGlossEdit, readOnly],
  );
  return (
    <AnalysisCallbackCtx.Provider value={callbackRefs}>
      {children}
      {perfMarksEnabled() && <ReplyRenderProbe />}
    </AnalysisCallbackCtx.Provider>
  );
}

/** Times from the earliest pending gloss commit to the render that follows the session's next reply. */
function ReplyRenderProbe() {
  const replies = useRepliesApplied();
  useLayoutEffect(() => {
    if (replies > 0) perfMeasureFromFirst('gloss-render', 'gloss-commit');
  }, [replies]);
  return undefined;
}

// #endregion

// #region Internal hooks

/**
 * Reads the nearest provider's callbacks, naming `hookName` in the guard's error. Centralizes the
 * guard that every analysis hook shares.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
function useRequiredCallbacks(hookName: string): ProviderCallbacks {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error(`${hookName} must be used inside a SessionAnalysisProvider`);
  return ctx;
}

/**
 * Registers a gloss input as currently holding uncommitted text whenever `isEditing` is true,
 * unregistering it when `isEditing` turns false or the input unmounts. The provider aggregates
 * these across all inputs and reports whether any edit is in progress, so the tab's unsaved
 * indicator can light up the moment the user starts typing — gloss writes themselves are deferred
 * to blur, which would otherwise leave the indicator dark mid-edit.
 *
 * Unmounting a focused input fires no blur, so an input dropped mid-edit — by the scroll window
 * re-seating its range, by dehydration, or by any other unmount — flushes `commit` instead of
 * losing the draft.
 *
 * @param isEditing - Whether this input's draft currently differs from its committed value.
 * @param commit - Writes the current draft to the store. May close over the latest render's draft.
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useReportGlossEditing(isEditing: boolean, commit: () => void): void {
  const { reportEditing } = useRequiredCallbacks('useReportGlossEditing');
  const commitRef = useLatestRef(commit);
  // Mirrors `isEditing` so the cleanup can tell an unmount mid-edit from one that ran because the
  // draft was already committed.
  const isEditingRef = useLatestRef(isEditing);
  useEffect(() => {
    if (!isEditing) return undefined;
    reportEditing(true);
    return () => {
      reportEditing(false);
      // Reading both refs at cleanup time is the point: a copy taken when the effect ran would hold
      // the draft from that render, which is the stale value this flush exists to avoid.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (isEditingRef.current) commitRef.current();
    };
  }, [isEditing, reportEditing, commitRef, isEditingRef]);
}

// #endregion

// #region Token hooks

/**
 * Returns the approved gloss string for the given token in the active analysis language, or `''`
 * when no approved analysis exists. Re-renders only when that token's approved analysis changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useGloss(tokenRef: string): string {
  useRequiredCallbacks('useGloss');

  return usePageSelector((state: AnalysisState) => selectApprovedGloss(state, tokenRef));
}

/**
 * Returns the sense ref on the given token's approved analysis, or `undefined` when the token has
 * no approved analysis or the analysis has no sense ref. Re-renders only when that ref changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useGlossSenseRef(tokenRef: string): SenseRef | undefined {
  useRequiredCallbacks('useGlossSenseRef');

  return usePageSelector((state: AnalysisState) => selectApprovedGlossSenseRef(state, tokenRef));
}

/**
 * Returns the merged analysis that the renderer shows for a token — its approved decision, else
 * what it is offered, else `undefined` ({@link selectResolvedTokenAnalysis}). Subscribes through
 * {@link resolvedTokenAnalysisEqual} so the result stays referentially stable across unrelated
 * changes, re-rendering only when the decision or suggestion actually changes.
 *
 * When `enabled` is `false` the selector short-circuits to `undefined` without consulting the pool,
 * so a chip that is not currently showing suggestions does no per-token pool lookup or
 * normalization on each change.
 *
 * @param tokenRef - The `Token.ref` to resolve.
 * @param surfaceText - The token's current surface text, matched against the pool when the token is
 *   unapproved.
 * @param enabled - Whether to resolve at all; `false` returns `undefined` without pool work.
 *   Defaults to `true`.
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useResolvedTokenAnalysis(
  tokenRef: string,
  surfaceText: string,
  enabled = true,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useResolvedTokenAnalysis');

  return usePagePoolSelector(
    (state, pool) =>
      enabled ? selectResolvedTokenAnalysis(state, tokenRef, surfaceText, pool) : undefined,
    resolvedTokenAnalysisEqual,
  );
}

/**
 * Returns the suggestion a token would resolve to if its approval were cleared — consulted while
 * the user has emptied an approved gloss (before the deletion commits on blur) so the previewed
 * suggestion matches the one that surfaces after commit ({@link selectSuggestionAfterClearing}).
 * Like {@link useResolvedTokenAnalysis} it subscribes through {@link resolvedTokenAnalysisEqual} for
 * referential stability and short-circuits to `undefined` (no pool work) when `enabled` is `false`,
 * so only the single token actively being cleared does any per-token derivation.
 *
 * @param tokenRef - The `Token.ref` to resolve.
 * @param surfaceText - The token's current surface text.
 * @param enabled - Whether to derive at all; `false` returns `undefined` without pool work.
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useSuggestionAfterClearing(
  tokenRef: string,
  surfaceText: string,
  enabled = true,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useSuggestionAfterClearing');

  return usePagePoolSelector(
    (state, pool) =>
      enabled ? selectSuggestionAfterClearing(state, tokenRef, surfaceText, pool) : undefined,
    resolvedTokenAnalysisEqual,
  );
}

/**
 * Returns whether the analysis in the nearest provider is read-only, as set by its `readOnly` prop.
 * Editing affordances render their static form when this is `true`.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useAnalysisReadOnly(): boolean {
  return useRequiredCallbacks('useAnalysisReadOnly').readOnly;
}

/**
 * Returns the morpheme breakdown from the approved `TokenAnalysis` for `tokenRef`, re-rendering
 * only when the morpheme array changes. Returns a stable empty array when no approved analysis
 * exists or it has no morphemes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useMorphemes(tokenRef: string): readonly MorphemeAnalysis[] {
  useRequiredCallbacks('useMorphemes');

  return usePageSelector((state: AnalysisState) => selectApprovedMorphemes(state, tokenRef));
}

/**
 * Returns the analysis that an unapproved `tokenRef` holds from its own records, such as an
 * import's unreviewed record, or `undefined` when it holds none, has an approval, or `enabled` is
 * `false`.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useUnapprovedTokenAnalysis(
  tokenRef: string,
  enabled: boolean,
): TokenAnalysis | undefined {
  useRequiredCallbacks('useUnapprovedTokenAnalysis');

  return usePageSelector((state: AnalysisState) =>
    enabled ? selectUnapprovedTokenAnalysis(state, tokenRef) : undefined,
  );
}

/**
 * Returns the id of `tokenRef`'s approved analysis while its breakdown is stale, re-rendering only
 * when that changes; `undefined` when the token has no approval or its breakdown is not stale.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useStaleMorphemesAnalysisId(tokenRef: string): string | undefined {
  useRequiredCallbacks('useStaleMorphemesAnalysisId');

  return usePageSelector((state: AnalysisState) => selectStaleMorphemesAnalysisId(state, tokenRef));
}

/**
 * Returns whether resetting `tokenRef`'s morpheme breakdown would discard glosses or lexicon
 * references no other token still holds, so the morpheme editor can confirm before discarding them.
 * A payload shared with other tokens does not qualify: it is forked rather than emptied, leaving
 * the co-linked tokens their morphemes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useMorphemeResetLosesAnnotation(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemeResetLosesAnnotation');

  return useSessionWholeSelector((state: AnalysisState) =>
    selectMorphemeResetLosesAnnotation(state, tokenRef),
  );
}

/**
 * Returns whether `tokenRef` alone holds its analysis payload, so a breakdown edit destroys the
 * glosses it strands rather than leaving them with co-linked tokens. See
 * {@link selectMorphemePayloadIsSolelyOwned} for what counts as sharing.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useMorphemePayloadIsSolelyOwned(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemePayloadIsSolelyOwned');

  return useSessionWholeSelector((state: AnalysisState) =>
    selectMorphemePayloadIsSolelyOwned(state, tokenRef),
  );
}

/**
 * The catalog's write callbacks, each keyed by `analysisId` and so global to that record. A
 * callback's promise rejects when its edit fails, after the failure is logged.
 */
export type AnalysisRowDispatch = {
  /**
   * Writes a gloss onto the record itself, changing what the record says for every token linked to
   * it. A blank value clears the gloss.
   */
  writeGloss: (analysisId: string, value: string) => Settles<AnalysisEditOutcome>;
  /**
   * Clears the gloss on several records at once, as a blank {@link AnalysisRowDispatch.writeGloss}
   * does on one, returning the records it left with nothing and so deleted.
   */
  clearGlosses: (analysisIds: readonly string[]) => Settles<readonly string[]>;
  /**
   * Re-segments the record's morpheme breakdown for every token linked to it, keeping the glosses
   * and lexicon links on every form the re-split does not drop.
   */
  writeMorphemes: (
    analysisId: string,
    forms: readonly string[],
    writingSystem: string,
  ) => Settles<AnalysisEditOutcome>;
  /** Writes a gloss onto one morpheme of the record, for every token linked to it. */
  writeMorphemeGloss: (
    analysisId: string,
    morphemeId: string,
    value: string,
  ) => Settles<AnalysisEditOutcome>;
  /**
   * Removes the records and every link to them, leaving their tokens on whatever the suggestion
   * pool still offers.
   */
  deleteAnalyses: (analysisIds: readonly string[]) => Settles<void>;
  /**
   * Folds several records into one, writing the merged content onto the survivor. Reports where the
   * edit left the survivor, because content identical to an unmerged record collapses the survivor
   * onto that record.
   */
  mergeAll: (
    survivorAnalysisId: string,
    mergedAnalysisIds: readonly string[],
    content: MergedContent,
  ) => Settles<AnalysisEditOutcome>;
};

/**
 * The write callbacks for the places an analysis went stale at, each keyed by one such place and so
 * local to it.
 */
export type StaleLocationDispatch = {
  /** Gives up the place `analysisId` went stale at, `tokenRef`, reclaiming it once nothing links it. */
  discard: (analysisId: string, tokenRef: string) => void;
  /**
   * Moves `analysisId` from the place it went stale at, `staleTokenRef`, onto the token at
   * `tokenRef`, approving it there in place of whatever that token held.
   */
  reapply: (
    analysisId: string,
    staleTokenRef: string,
    tokenRef: string,
    surfaceText: string,
  ) => void;
};

/** What each {@link StaleLocationDispatch} write would reclaim. */
export type StaleLocationReclaims = {
  /** Ids of the records that giving up `analysisId`'s stale place at `tokenRef` would reclaim. */
  discard: (analysisId: string, tokenRef: string) => Settles<readonly string[]>;
  /**
   * Ids of the records that moving `analysisId` from its stale place at `staleTokenRef` onto the
   * token at `tokenRef` would reclaim.
   */
  reapply: (
    analysisId: string,
    staleTokenRef: string,
    tokenRef: string,
    surfaceText: string,
  ) => Settles<readonly string[]>;
};

/**
 * Returns stable getters for the ids of the records that a stale-place review would reclaim, as the
 * draft stands at the call.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useStaleLocationReclaims(): StaleLocationReclaims {
  const previews = useRemovalPreviews();
  return useMemo(
    () => ({ discard: previews.discardStale, reapply: previews.reapplyStale }),
    [previews],
  );
}

/**
 * Returns a stable getter for the ids of the records that clearing the glosses on `analysisIds`
 * would remove — left empty, or folded into an identical sibling — as the draft stands at the
 * call.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useGlossClearReclaims(): (
  analysisIds: readonly string[],
) => Settles<readonly string[]> {
  return useRemovalPreviews().clearGlosses;
}

/**
 * Returns the active BCP 47 analysis-language tag.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useAnalysisLanguage(): string {
  useRequiredCallbacks('useAnalysisLanguage');

  return usePageSelector((state: AnalysisState) => selectAnalysisLanguage(state));
}

/**
 * Returns the current `TextAnalysis` snapshot, re-rendering on every analysis change. Intended for
 * components that need the full analysis (e.g. an analysis-selection popup).
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useAnalysis(): TextAnalysis {
  useRequiredCallbacks('useAnalysis');

  return useSessionWholeSelector((state: AnalysisState) => selectAnalysis(state));
}

/**
 * Returns a stable callback that creates or updates the approved `TokenAnalysis` for a token. The
 * edit is per-token: a shared payload is forked before writing, so editing one token never rewrites
 * the others. Persists immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useGlossDispatch(): (tokenRef: string, surfaceText: string, value: string) => void {
  return useRequiredCallbacks('useGlossDispatch').requestGlossEdit;
}

// #endregion

// #region Phrase hooks

/**
 * Returns a `Map` from every token ref that belongs to an approved phrase to its
 * `PhraseAnalysisLink`. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePhraseLinkMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkMap');

  return usePageSelector((state: AnalysisState) => selectPhraseLinkByTokenRef(state));
}

/**
 * Returns a `Map` from `PhraseAnalysisLink.id` to the approved `PhraseAnalysisLink` for O(1) lookup
 * of a phrase occurrence. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePhraseLinkByIdMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdMap');

  return usePageSelector((state: AnalysisState) => selectPhraseLinkById(state));
}

/**
 * Returns the approved `PhraseAnalysisLink` whose token list contains `tokenRef`, or `undefined`
 * when the token is not part of any phrase. Re-renders only when the phrase membership of this
 * token changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePhraseLinkForToken(tokenRef: string): PhraseAnalysisLink | undefined {
  useRequiredCallbacks('usePhraseLinkForToken');

  return usePageSelector((state: AnalysisState) => selectPhraseLinkByTokenRef(state).get(tokenRef));
}

/**
 * Returns the gloss string for the given phrase in the active analysis language, or `''` when
 * absent. Re-renders only when that phrase's gloss changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePhraseGloss(phraseId: string): string {
  useRequiredCallbacks('usePhraseGloss');

  return usePageSelector((state: AnalysisState) => selectPhraseGloss(state, phraseId));
}

/**
 * Returns the sense ref on the given phrase's payload, or `undefined` when the payload has none.
 * Re-renders only when that ref changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePhraseSenseRef(phraseId: string): SenseRef | undefined {
  useRequiredCallbacks('usePhraseSenseRef');

  return usePageSelector((state: AnalysisState) => selectPhraseSenseRef(state, phraseId));
}

/** Return value of {@link usePhraseDispatch}. */
export type PhraseDispatch = {
  /**
   * Creates a new approved phrase.
   *
   * @param tokens - The phrase's tokens, in document order.
   */
  createPhrase: (tokens: TokenSnapshot[]) => void;
  /**
   * Replaces the token list of an existing phrase occurrence.
   *
   * @param phraseId - `PhraseAnalysisLink.id` of the occurrence to update.
   * @param tokens - Replacement ordered `TokenSnapshot`s in document order.
   */
  updatePhrase: (phraseId: string, tokens: TokenSnapshot[]) => void;
  /** Deletes the phrase occurrence whose `PhraseAnalysisLink.id` is `phraseId`. */
  deletePhrase: (phraseId: string) => void;
  /**
   * Merges a neighboring phrase (or free token) into a target phrase in a single atomic dispatch,
   * then saves once. Prefer this over `updatePhrase` + `deletePhrase` when absorbing a neighbor so
   * no save observes the intermediate state where the neighbor's tokens belong to two phrases.
   *
   * @param targetPhraseId - ID of the phrase to keep and grow.
   * @param tokens - The combined, document-ordered token snapshots for the target phrase.
   * @param absorbedPhraseId - ID of the neighbor phrase to delete, or `undefined` when the absorbed
   *   neighbor was a free (unphrased) token.
   */
  mergePhrases: (
    targetPhraseId: string,
    tokens: TokenSnapshot[],
    absorbedPhraseId: string | undefined,
  ) => void;
  /**
   * Splits the occurrence `phraseLink` just after `splitAfterTokenRef`, the session ordering each
   * part's tokens.
   */
  splitPhrase: (phraseLink: PhraseAnalysisLink, splitAfterTokenRef: string) => void;
};

// #endregion

// #region Segment hooks

/**
 * Returns the approved free-translation string for the given segment in the active analysis
 * language, or `''` when absent. Re-renders only when that segment's free translation changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useSegmentFreeTranslation(segmentId: string): string {
  useRequiredCallbacks('useSegmentFreeTranslation');

  return usePageSelector((state: AnalysisState) => selectSegmentFreeTranslation(state, segmentId));
}

/**
 * Returns the free translation of every segment carrying a non-empty one in the active analysis
 * language, keyed by segment id. Re-renders only when that map changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useFreeTranslationsBySegment(): ReadonlyMap<string, string> {
  useRequiredCallbacks('useFreeTranslationsBySegment');

  return usePageSelector((state: AnalysisState) => selectFreeTranslationsBySegment(state));
}

/**
 * Returns whether the given segment holds an approved free translation, in whatever language.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useSegmentHasApprovedTranslation(segmentId: string): boolean {
  useRequiredCallbacks('useSegmentHasApprovedTranslation');

  return usePageSelector((state: AnalysisState) =>
    selectSegmentsWithApprovedTranslation(state).has(segmentId),
  );
}

/**
 * Returns the id of every segment holding an approved free translation, in whatever language.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function useSegmentsWithApprovedTranslation(): ReadonlySet<string> {
  useRequiredCallbacks('useSegmentsWithApprovedTranslation');

  return usePageSelector((state: AnalysisState) => selectSegmentsWithApprovedTranslation(state));
}

/**
 * Returns `book`'s stale free translations, filed by where the view shows each.
 *
 * @throws When called outside a {@link SessionAnalysisProvider}.
 */
export function usePlacedStaleFreeTranslations(book: Book): PlacedStaleFreeTranslations {
  useRequiredCallbacks('usePlacedStaleFreeTranslations');

  const stale = useSessionWholeSelector((state: AnalysisState) =>
    selectStaleFreeTranslations(state),
  );
  return useMemo(() => placeStaleFreeTranslations(stale, book), [stale, book]);
}

/** The write callbacks for reviewing stale free translations. */
export type StaleFreeTranslationDispatch = {
  /**
   * Keeps the stale translation `analysisId` as a claim about the text `segmentId` now reads,
   * `surfaceText`, approving it for that segment.
   */
  keep: (analysisId: string, segmentId: string, surfaceText: string) => void;
  /** Drops the stale translation `analysisId`. */
  discard: (analysisId: string) => void;
};

// #endregion
