import type {
  Book,
  MergedContent,
  MorphemeAnalysis,
  PhraseAnalysisLink,
  SenseRef,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
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
import { Provider as ReduxProvider, useDispatch, useSelector, useStore } from 'react-redux';
import { createAnalysisStore, type AnalysisDispatch, type AnalysisRootState } from '../store';
import { perfMark, perfMarksEnabled, perfMeasure, perfMeasureFromFirst } from '../utils/perf-marks';
import analysisReducer, {
  approveAnalysisForToken,
  confirmAnalysisMorphemes,
  createPhrase,
  clearAnalysisGlosses,
  deleteAnalyses,
  discardStaleAnalysis,
  discardStaleFreeTranslation,
  keepStaleFreeTranslation,
  deleteMorphemes,
  deletePhrase,
  mergeAnalysesInto,
  mergePhrases,
  selectAnalysis,
  selectAnalysisLanguage,
  selectAnalysisDeletionOutcome,
  selectEmptiedByGlossClear,
  selectApprovedGloss,
  selectApprovedGlossSenseRef,
  selectApprovedMorphemes,
  selectCatalogRows,
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
  selectStaleTokenLinks,
  selectUnapprovedTokenAnalysis,
  updatePhrase,
  writeAnalysisGloss,
  writeAnalysisMorphemeGloss,
  writeAnalysisMorphemes,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
  writeSegmentFreeTranslation,
  reapplyStaleAnalysis,
  replaceAnalysis,
  setAnalysisLanguage,
  type AnalysisDeletionOutcome,
  type AnalysisState,
} from '../store/analysisSlice';
import useLatestRef from '../hooks/useLatestRef';
import { readEditOutcome, type AnalysisEditOutcome } from '../utils/edit-outcome';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';
import type { Settles } from '../utils/settles';
import type { PageClient } from '../cache/pageClient';
import type { WholeAnalysis } from '../cache/wholeAnalysis';
import {
  PageClientProvider,
  usePagePoolSelector,
  useRepliesApplied,
  usePageSelector,
  usePageStateGetter,
  useWholeSelector as useSessionWholeSelector,
  useWholeStateGetter as useSessionWholeStateGetter,
} from '../cache/pageHooks';
import {
  useAnalysisRowCommands,
  useApproveAnalysisCommand,
  useConfirmMorphemesCommand,
  useGlossCommand,
  useMorphemeBreakdownCommand,
  useMorphemeDeleteCommand,
  useMorphemeGlossCommand,
  usePhraseCommands,
  usePhraseGlossCommand,
  useRemovalPreviews,
  useSegmentFreeTranslationCommand,
  useStaleFreeTranslationCommands,
  useStaleLocationCommands,
} from '../cache/sessionEdits';
import { hostPathEnabled } from '../utils/host-path';
import { emptyAnalysis } from '../types/empty-factories';
import type { CatalogRow, HeadingPlacement } from '../utils/analysis-query';
import {
  placeStaleFreeTranslations,
  type PlacedStaleFreeTranslations,
} from '../utils/stale-free-translations';
import { resolvedTokenAnalysisEqual, type ResolvedTokenAnalysis } from '../utils/suggestion-engine';

// #region Internal context

/**
 * Stable ref-container passed through context so {@link useGlossDispatch} can call the latest
 * `onSave` / `onGlossChange` callbacks without recreating its returned function on every parent
 * render.
 */
type CallbackRefs = {
  /** Ref to the `onSave` prop of the nearest {@link AnalysisStoreProvider}. */
  onSaveRef: { current: ((analysis: TextAnalysis, location?: string) => void) | undefined };
  /** Ref to the `onGlossChange` spy prop of the nearest {@link AnalysisStoreProvider}. */
  onGlossChangeRef: { current: ((tokenRef: string, value: string) => void) | undefined };
  /**
   * Stable callback a gloss input calls to register (`true`) or unregister (`false`) itself as
   * currently holding uncommitted text. Gloss edits are committed to the store only on blur, so
   * without this the provider could not tell the parent that an edit is in progress until then. The
   * provider counts active editors and reports the 0↔non-0 crossings via the `onPendingEditsChange`
   * prop, driving the tab's unsaved indicator while the user types.
   */
  reportEditing: (active: boolean) => void;
  /**
   * Stable entry point {@link useGlossDispatch} returns for writing a gloss. Every gloss edit is
   * per-token: the reducer forks any shared payload before the edit lands, so editing one token
   * never rewrites the others. (Editing every occurrence of a shared analysis is deferred; see
   * user-questions.md "separating per-token edits from global analysis edits".)
   */
  requestGlossEdit: (tokenRef: string, surfaceText: string, value: string) => void;
  /**
   * Whether the store holds a read-only analysis ({@link useAnalysisReadOnly}). Carried on the
   * provider so every editing affordance in the tree can render its static form without threading a
   * prop.
   */
  readOnly: boolean;
};

/** Internal context that carries callback refs alongside the Redux {@link ReduxProvider}. */
const AnalysisCallbackCtx = createContext<CallbackRefs | undefined>(undefined);

// #endregion

// #region Provider

/** Props for {@link AnalysisStoreProvider}. */
type AnalysisStoreProviderProps = Readonly<{
  /** Subtree given access to the analysis store. */
  children: ReactNode;
  /**
   * BCP 47 tag glosses and free translations are read and written in; a new tag never reseeds the
   * store.
   */
  analysisLanguage: string;
  /**
   * The initial `TextAnalysis` to seed the store. Not reactive after mount — the caller is
   * responsible for unmounting and remounting when the active project changes.
   */
  initialAnalysis?: TextAnalysis;
  /**
   * Called after every store mutation with the updated `TextAnalysis`, and with the token ref or
   * segment id the mutation was made at when it was made at one place. Use this to persist changes
   * back to the active project's storage.
   */
  onSave?: (analysis: TextAnalysis, location?: string) => void;
  /**
   * Optional spy called after each gloss write. Intended for test observability only — has no
   * effect on store behavior.
   */
  onGlossChange?: (tokenRef: string, value: string) => void;
  /**
   * Called with `true` when at least one gloss input begins holding uncommitted text and `false`
   * when none do (the last edit is committed on blur, reverted, or the input unmounts). Lets the
   * caller reflect in-progress typing in the tab's unsaved indicator before the edit commits.
   */
  onPendingEditsChange?: (pending: boolean) => void;
  /**
   * When `true`, the subtree renders the analysis as read-only: glosses and free translations show
   * as static text, and linking, splitting, phrase, suggestion, and boundary controls do not
   * render. Used for a Paratext 9 import, whose analysis only sync may change.
   */
  readOnly?: boolean;
  /**
   * Registers a listener for each analysis the draft takes from somewhere other than this store's
   * edits, such as an undo, so the store follows it in place; returns the unregistering function.
   */
  subscribeToReplacements?: (listener: (analysis: TextAnalysis) => void) => () => void;
}>;

/**
 * Provides a Redux-backed `TextAnalysis` store to the subtree. Components inside can read per-token
 * approved gloss values via {@link useGloss} and write new approved analyses via
 * {@link useGlossDispatch}. The full analysis snapshot is accessible via {@link useAnalysis}.
 */
export function AnalysisStoreProvider({
  children,
  initialAnalysis,
  analysisLanguage,
  onSave,
  onGlossChange,
  onPendingEditsChange,
  readOnly = false,
  subscribeToReplacements,
}: AnalysisStoreProviderProps) {
  // Lazy initialization: useRef(createStore()) would create and discard a store on every render
  const storeRef = useRef<ReturnType<typeof createAnalysisStore> | undefined>(undefined);
  if (!storeRef.current) {
    perfMark('store-create');
    storeRef.current = createAnalysisStore({
      analysis: { analysis: initialAnalysis ?? emptyAnalysis(), analysisLanguage },
    });
  }
  const store = storeRef.current;

  useEffect(
    () => subscribeToReplacements?.((analysis) => store.dispatch(replaceAnalysis(analysis))),
    [subscribeToReplacements, store],
  );

  // Layout phase, so no frame paints the previous language's glosses beside the new selection.
  useLayoutEffect(() => {
    store.dispatch(setAnalysisLanguage(analysisLanguage));
  }, [store, analysisLanguage]);

  // Runs after the subtree's first commit, which is when the store's first readers have rendered.
  useLayoutEffect(() => perfMeasure('store-mount', 'store-create'), []);

  // Use refs so the dispatch callback never needs to re-create when parent re-renders
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onGlossChangeRef = useRef(onGlossChange);
  onGlossChangeRef.current = onGlossChange;

  const reportEditing = usePendingEdits(onPendingEditsChange);

  /**
   * Dispatches {@link writeGloss} (forking any shared payload before writing), then persists via
   * `onSave` and notifies the `onGlossChange` spy.
   *
   * @param tokenRef - `Token.ref` of the token being glossed.
   * @param surfaceText - Surface text, recorded so the analysis can detect baseline drift.
   * @param value - New gloss string; blank (empty or whitespace) clears the active language's
   *   gloss.
   */
  const requestGlossEdit = useCallback(
    (tokenRef: string, surfaceText: string, value: string) => {
      perfMark('gloss-commit');
      store.dispatch(writeGloss(tokenRef, surfaceText, value));
      onSaveRef.current?.(store.getState().analysis.analysis, tokenRef);
      onGlossChangeRef.current?.(tokenRef, value);
    },
    [store],
  );

  const callbackRefs = useMemo(
    () => ({
      onSaveRef,
      onGlossChangeRef,
      reportEditing,
      requestGlossEdit,
      readOnly,
    }),
    [reportEditing, requestGlossEdit, readOnly],
  );

  return (
    <ReduxProvider store={store}>
      <AnalysisCallbackCtx.Provider value={callbackRefs}>{children}</AnalysisCallbackCtx.Provider>
      {perfMarksEnabled() && <DispatchRenderProbe />}
    </ReduxProvider>
  );
}

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

/**
 * Gives the subtree a session's analysis on the host path, in place of an
 * {@link AnalysisStoreProvider}.
 */
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
      onSaveRef: { current: undefined },
      onGlossChangeRef: { current: undefined },
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

/**
 * Times each render of a changed analysis from the earliest pending dispatch, and from the earliest
 * pending gloss commit.
 */
function DispatchRenderProbe() {
  const analysis = useSelector((state: AnalysisRootState) => state.analysis.analysis);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    if (mountedRef.current) {
      perfMeasureFromFirst('dispatch-render', 'dispatch');
      perfMeasureFromFirst('gloss-render', 'gloss-commit');
    }
    mountedRef.current = true;
  }, [analysis]);
  return undefined;
}

// #endregion

// #region Internal hooks

/**
 * Reads the nearest provider's callback refs, naming `hookName` in the guard's error. Centralizes
 * the guard that every analysis hook shares.
 *
 * @throws When called outside an {@link AnalysisStoreProvider} or a {@link SessionAnalysisProvider}.
 */
function useRequiredCallbacks(hookName: string): CallbackRefs {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error(`${hookName} must be used inside an AnalysisStoreProvider`);
  return ctx;
}

function useStoreSelector<T>(
  select: (state: AnalysisState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  return useSelector((state: AnalysisRootState) => select(state.analysis), isEqual);
}

/** The store's state as it stands when called. */
function useStoreStateGetter(): () => AnalysisState {
  const store = useStore<AnalysisRootState>();
  return useCallback(() => store.getState().analysis, [store]);
}

const onHostPath = hostPathEnabled();

/** Reads what the view shows: the held pages on the host path, the store otherwise. */
const useViewSelector = onHostPath ? usePageSelector : useStoreSelector;

/** Reads an answer that spans books: the session's whole analysis on the host path. */
const useWholeSelector = onHostPath ? useSessionWholeSelector : useStoreSelector;

/** The state the view reads, as it stands when called. */
const useViewStateGetter = onHostPath ? usePageStateGetter : useStoreStateGetter;

/** The state read for answers that span books, as it stands when called. */
const useWholeStateGetter = onHostPath ? useSessionWholeStateGetter : useStoreStateGetter;

/** What the session says a stale discard or reapply would reclaim. */
function useStaleReclaimsFromSession(): StaleLocationReclaims {
  const previews = useRemovalPreviews();
  return useMemo(
    () => ({ discard: previews.discardStale, reapply: previews.reapplyStale }),
    [previews],
  );
}

/** What the session says a gloss clear would reclaim. */
function useGlossClearReclaimsFromSession(): (
  analysisIds: readonly string[],
) => Settles<readonly string[]> {
  return useRemovalPreviews().clearGlosses;
}

/** The first token of the phrase occurrence `phraseId` names, which an edit to it is made at. */
function phraseStart(state: AnalysisRootState, phraseId: string): string | undefined {
  /* v8 ignore next -- a phrase is edited only while it is on screen, and so in the store */
  return selectPhraseLinkById(state.analysis).get(phraseId)?.tokens[0].tokenRef;
}

/**
 * Shared setup for the mutation hooks: resolves the provider callbacks and Redux dispatch — naming
 * `hookName` in the guard's error — and returns a stable `save` that reads the latest analysis from
 * the store and forwards it to `onSave`. Factors out the dispatch-then-save pattern every write
 * hook repeats.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
function useAnalysisSave(hookName: string): {
  callbacks: CallbackRefs;
  dispatch: AnalysisDispatch;
  save: (location?: string) => void;
} {
  const callbacks = useRequiredCallbacks(hookName);
  const dispatch = useDispatch<AnalysisDispatch>();
  const store = useStore<AnalysisRootState>();
  const save = useCallback(
    (location?: string) => {
      const { analysis } = store.getState().analysis;
      callbacks.onSaveRef.current?.(analysis, location);
    },
    [store, callbacks],
  );
  return { callbacks, dispatch, save };
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
 * @throws When called outside an {@link AnalysisStoreProvider} or a {@link SessionAnalysisProvider}.
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
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useGloss(tokenRef: string): string {
  useRequiredCallbacks('useGloss');

  return useViewSelector((state: AnalysisState) => selectApprovedGloss(state, tokenRef));
}

/**
 * Returns the sense ref on the given token's approved analysis, or `undefined` when the token has
 * no approved analysis or the analysis has no sense ref. Re-renders only when that ref changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useGlossSenseRef(tokenRef: string): SenseRef | undefined {
  useRequiredCallbacks('useGlossSenseRef');

  return useViewSelector((state: AnalysisState) => selectApprovedGlossSenseRef(state, tokenRef));
}

function useResolvedTokenAnalysisFromStore(
  tokenRef: string,
  surfaceText: string,
  enabled = true,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useResolvedTokenAnalysis');

  return useViewSelector(
    (state: AnalysisState) =>
      enabled ? selectResolvedTokenAnalysis(state, tokenRef, surfaceText) : undefined,
    resolvedTokenAnalysisEqual,
  );
}

function useResolvedTokenAnalysisFromPages(
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
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useResolvedTokenAnalysis = onHostPath
  ? useResolvedTokenAnalysisFromPages
  : useResolvedTokenAnalysisFromStore;

function useSuggestionAfterClearingFromStore(
  tokenRef: string,
  surfaceText: string,
  enabled: boolean,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useSuggestionAfterClearing');

  return useViewSelector(
    (state: AnalysisState) =>
      enabled ? selectSuggestionAfterClearing(state, tokenRef, surfaceText) : undefined,
    resolvedTokenAnalysisEqual,
  );
}

function useSuggestionAfterClearingFromPages(
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
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useSuggestionAfterClearing = onHostPath
  ? useSuggestionAfterClearingFromPages
  : useSuggestionAfterClearingFromStore;

/**
 * Returns whether the analysis in the nearest provider is read-only, as set by its `readOnly` prop.
 * Editing affordances render their static form when this is `true`.
 *
 * @throws When called outside an {@link AnalysisStoreProvider} or a {@link SessionAnalysisProvider}.
 */
export function useAnalysisReadOnly(): boolean {
  return useRequiredCallbacks('useAnalysisReadOnly').readOnly;
}

/**
 * Returns the morpheme breakdown from the approved `TokenAnalysis` for `tokenRef`, re-rendering
 * only when the morpheme array changes. Returns a stable empty array when no approved analysis
 * exists or it has no morphemes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useMorphemes(tokenRef: string): readonly MorphemeAnalysis[] {
  useRequiredCallbacks('useMorphemes');

  return useViewSelector((state: AnalysisState) => selectApprovedMorphemes(state, tokenRef));
}

/**
 * Returns the analysis that an unapproved `tokenRef` holds from its own records, such as an
 * import's unreviewed record, or `undefined` when it holds none, has an approval, or `enabled` is
 * `false`.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useUnapprovedTokenAnalysis(
  tokenRef: string,
  enabled: boolean,
): TokenAnalysis | undefined {
  useRequiredCallbacks('useUnapprovedTokenAnalysis');

  return useViewSelector((state: AnalysisState) =>
    enabled ? selectUnapprovedTokenAnalysis(state, tokenRef) : undefined,
  );
}

/**
 * Returns the id of `tokenRef`'s approved analysis while its breakdown is stale, re-rendering only
 * when that changes; `undefined` when the token has no approval or its breakdown is not stale.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useStaleMorphemesAnalysisId(tokenRef: string): string | undefined {
  useRequiredCallbacks('useStaleMorphemesAnalysisId');

  return useViewSelector((state: AnalysisState) => selectStaleMorphemesAnalysisId(state, tokenRef));
}

function useConfirmMorphemesDispatchFromStore(): (analysisId: string, tokenRef?: string) => void {
  const { dispatch, save } = useAnalysisSave('useConfirmMorphemesDispatch');

  return useCallback(
    (analysisId: string, tokenRef?: string) => {
      dispatch(confirmAnalysisMorphemes({ analysisId }));
      save(tokenRef);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that keeps an analysis's stale breakdown as it stands, clearing the
 * mark for every token linked to it. Persists immediately, recording the optional `tokenRef` as the
 * place the confirmation was made at.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useConfirmMorphemesDispatch = onHostPath
  ? useConfirmMorphemesCommand
  : useConfirmMorphemesDispatchFromStore;

/**
 * Returns whether resetting `tokenRef`'s morpheme breakdown would discard glosses or lexicon
 * references no other token still holds, so the morpheme editor can confirm before discarding them.
 * A payload shared with other tokens does not qualify: it is forked rather than emptied, leaving
 * the co-linked tokens their morphemes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useMorphemeResetLosesAnnotation(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemeResetLosesAnnotation');

  return useWholeSelector((state: AnalysisState) =>
    selectMorphemeResetLosesAnnotation(state, tokenRef),
  );
}

/**
 * Returns whether `tokenRef` alone holds its analysis payload, so a breakdown edit destroys the
 * glosses it strands rather than leaving them with co-linked tokens. See
 * {@link selectMorphemePayloadIsSolelyOwned} for what counts as sharing.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useMorphemePayloadIsSolelyOwned(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemePayloadIsSolelyOwned');

  return useWholeSelector((state: AnalysisState) =>
    selectMorphemePayloadIsSolelyOwned(state, tokenRef),
  );
}

/**
 * Returns one row per distinct token analysis in the draft, each carrying the usage data the
 * analysis catalog lists it by, in the analysis's own order. Narrowing and ordering are the
 * caller's, so a keystroke re-runs only that pass.
 *
 * The result keeps its reference while the analyses and their links keep theirs, so an unrelated
 * write — a free translation, a phrase link — leaves the list unrendered. It changes with
 * `currentBook`, which the per-book usage count is taken against, with `headingPlacements`, which
 * places each heading's usages among its verse's text, and with the analysis language its glosses
 * are read in.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useCatalogRows(
  currentBook: string,
  headingPlacements: ReadonlyMap<string, HeadingPlacement>,
): readonly CatalogRow[] {
  useRequiredCallbacks('useCatalogRows');

  return useWholeSelector((state: AnalysisState) =>
    selectCatalogRows(state, currentBook, headingPlacements),
  );
}

/**
 * The catalog's write callbacks, each keyed by `analysisId` and so global to that record. On the
 * host path, a callback's promise rejects when its edit fails, after the failure is logged.
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
   * pool still offers. See {@link useAnalysisDeletionOutcome} for what deleting one will cost.
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

function useAnalysisRowDispatchFromStore(): AnalysisRowDispatch {
  const { dispatch, save } = useAnalysisSave('useAnalysisRowDispatch');
  const store = useStore<AnalysisRootState>();

  /**
   * Dispatches one write and reports where it left the record, persisting once afterwards. Every
   * write path shares it, so they cannot disagree about what counts as a merge.
   */
  const writeAndReport = useCallback(
    (analysisId: string, action: Parameters<AnalysisDispatch>[0]): AnalysisEditOutcome => {
      dispatch(action);
      const { analysis, analysisLanguage, lastCollapseSurvivorId } = store.getState().analysis;
      save();
      return readEditOutcome(analysis, lastCollapseSurvivorId, analysisId, analysisLanguage);
    },
    [dispatch, save, store],
  );

  const handleWriteGloss = useCallback(
    (analysisId: string, value: string) =>
      writeAndReport(analysisId, writeAnalysisGloss({ analysisId, value })),
    [writeAndReport],
  );

  const handleClearGlosses = useCallback(
    (analysisIds: readonly string[]) => {
      const emptied = selectEmptiedByGlossClear(store.getState().analysis, analysisIds);
      dispatch(clearAnalysisGlosses({ analysisIds }));
      save();
      return emptied;
    },
    [dispatch, save, store],
  );

  const handleWriteMorphemes = useCallback(
    (analysisId: string, forms: readonly string[], writingSystem: string) =>
      writeAndReport(analysisId, writeAnalysisMorphemes({ analysisId, forms, writingSystem })),
    [writeAndReport],
  );

  const handleWriteMorphemeGloss = useCallback(
    (analysisId: string, morphemeId: string, value: string) =>
      writeAndReport(analysisId, writeAnalysisMorphemeGloss({ analysisId, morphemeId, value })),
    [writeAndReport],
  );

  const handleDeleteAnalyses = useCallback(
    (analysisIds: readonly string[]) => {
      dispatch(deleteAnalyses({ analysisIds }));
      save();
    },
    [dispatch, save],
  );

  const handleMergeAll = useCallback(
    (survivorAnalysisId: string, mergedAnalysisIds: readonly string[], content: MergedContent) =>
      writeAndReport(
        survivorAnalysisId,
        mergeAnalysesInto({ survivorAnalysisId, mergedAnalysisIds, content }),
      ),
    [writeAndReport],
  );

  return useMemo(
    () => ({
      writeGloss: handleWriteGloss,
      clearGlosses: handleClearGlosses,
      writeMorphemes: handleWriteMorphemes,
      writeMorphemeGloss: handleWriteMorphemeGloss,
      deleteAnalyses: handleDeleteAnalyses,
      mergeAll: handleMergeAll,
    }),
    [
      handleWriteGloss,
      handleClearGlosses,
      handleWriteMorphemes,
      handleWriteMorphemeGloss,
      handleDeleteAnalyses,
      handleMergeAll,
    ],
  );
}

/**
 * Returns stable callbacks for editing the analysis records that the catalog lists. Every callback
 * here is keyed by `analysisId` and so rewrites the record for all its tokens at once — the
 * opposite of the `tokenRef`-keyed hooks above, which fork a shared payload to keep an edit local
 * to one token. The key is the whole of the distinction; neither family takes a scope flag.
 *
 * Each write reports where it left the record, so the caller can tell the reader that an edit
 * collapsed the row onto a sibling rather than letting it vanish unexplained.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useAnalysisRowDispatch = onHostPath
  ? useAnalysisRowCommands
  : useAnalysisRowDispatchFromStore;

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

function useStaleLocationDispatchFromStore(): StaleLocationDispatch {
  const { dispatch, save } = useAnalysisSave('useStaleLocationDispatch');

  const discard = useCallback(
    (analysisId: string, tokenRef: string) => {
      dispatch(discardStaleAnalysis({ analysisId, tokenRef }));
      save();
    },
    [dispatch, save],
  );

  const reapply = useCallback(
    (analysisId: string, staleTokenRef: string, tokenRef: string, surfaceText: string) => {
      dispatch(reapplyStaleAnalysis({ analysisId, staleTokenRef, tokenRef, surfaceText }));
      save();
    },
    [dispatch, save],
  );

  return useMemo(() => ({ discard, reapply }), [discard, reapply]);
}

/**
 * Returns stable callbacks for reviewing the places that analyses went stale at. Each persists
 * immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useStaleLocationDispatch = onHostPath
  ? useStaleLocationCommands
  : useStaleLocationDispatchFromStore;

/** Returns a stable getter for the ids of the records a write would remove, without committing it. */
function useReclaimedBy(): (action: Parameters<typeof analysisReducer>[1]) => string[] {
  const store = useStore<AnalysisRootState>();

  // Runs the write through the reducer itself, so this cannot disagree with it.
  return useCallback(
    (action: Parameters<typeof analysisReducer>[1]) => {
      const before = store.getState().analysis;
      const kept = new Set(
        analysisReducer(before, action).analysis.tokenAnalyses.map((ta) => ta.id),
      );
      return before.analysis.tokenAnalyses.map((ta) => ta.id).filter((id) => !kept.has(id));
    },
    [store],
  );
}

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

function useStaleLocationReclaimsFromStore(): StaleLocationReclaims {
  const reclaimedBy = useReclaimedBy();

  const discard = useCallback(
    (analysisId: string, tokenRef: string) =>
      reclaimedBy(discardStaleAnalysis({ analysisId, tokenRef })),
    [reclaimedBy],
  );

  const reapply = useCallback(
    (analysisId: string, staleTokenRef: string, tokenRef: string, surfaceText: string) =>
      reclaimedBy(reapplyStaleAnalysis({ analysisId, staleTokenRef, tokenRef, surfaceText })),
    [reclaimedBy],
  );

  return useMemo(() => ({ discard, reapply }), [discard, reapply]);
}

/**
 * Returns stable getters for the ids of the records that a stale-place review would reclaim, as the
 * draft stands at the call.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useStaleLocationReclaims = onHostPath
  ? useStaleReclaimsFromSession
  : useStaleLocationReclaimsFromStore;

function useGlossClearReclaimsFromStore(): (
  analysisIds: readonly string[],
) => Settles<readonly string[]> {
  const reclaimedBy = useReclaimedBy();
  return useCallback(
    (analysisIds: readonly string[]) => reclaimedBy(clearAnalysisGlosses({ analysisIds })),
    [reclaimedBy],
  );
}

/**
 * Returns a stable getter for the ids of the records that clearing the glosses on `analysisIds`
 * would remove — left empty, or folded into an identical sibling — as the draft stands at the
 * call.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useGlossClearReclaims = onHostPath
  ? useGlossClearReclaimsFromSession
  : useGlossClearReclaimsFromStore;

/**
 * Returns a stable getter for what deleting a record would do to the tokens that approve it — left
 * blank, or falling back to a surviving homograph — so the deletion's announcement can name the
 * concrete consequence. Returns `undefined` for an id that resolves to no record.
 *
 * A getter rather than a subscription: the outcome is read once, just before the delete, and
 * subscribing every row to it would recompute the suggestion pool per row on every store change.
 *
 * The getter is given the live-text lookup per call, so it reads the book as it stands at the
 * moment of the delete.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useAnalysisDeletionOutcome(): (
  analysisId: string,
  liveSurfaceText: (tokenRef: string) => string | undefined,
) => AnalysisDeletionOutcome | undefined {
  useRequiredCallbacks('useAnalysisDeletionOutcome');
  const getState = useWholeStateGetter();

  return useCallback(
    (analysisId: string, liveSurfaceText: (tokenRef: string) => string | undefined) =>
      selectAnalysisDeletionOutcome(getState(), analysisId, liveSurfaceText),
    [getState],
  );
}

/**
 * Returns the active BCP 47 analysis-language tag.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useAnalysisLanguage(): string {
  useRequiredCallbacks('useAnalysisLanguage');

  return useViewSelector((state: AnalysisState) => selectAnalysisLanguage(state));
}

/**
 * Returns the current `TextAnalysis` snapshot, re-rendering on every analysis change. Intended for
 * components that need the full analysis (e.g. an analysis-selection popup).
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useAnalysis(): TextAnalysis {
  useRequiredCallbacks('useAnalysis');

  return useWholeSelector((state: AnalysisState) => selectAnalysis(state));
}

/**
 * Returns a stable callback that creates or updates the approved `TokenAnalysis` for a token. The
 * edit is per-token: a shared payload is forked before writing, so editing one token never rewrites
 * the others. Persists immediately.
 *
 * @throws When called outside an {@link AnalysisStoreProvider} or a {@link SessionAnalysisProvider}.
 */
export function useGlossDispatch(): (tokenRef: string, surfaceText: string, value: string) => void {
  return useRequiredCallbacks('useGlossDispatch').requestGlossEdit;
}

function useApproveAnalysisDispatchFromStore(): (
  tokenRef: string,
  surfaceText: string,
  analysisId: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useApproveAnalysisDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, analysisId: string) => {
      dispatch(approveAnalysisForToken({ tokenRef, surfaceText, analysisId }));
      save(tokenRef);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that approves an existing shared `TokenAnalysis` payload for a token —
 * the persisted half of accepting a suggestion (the suggested payload) or promoting a candidate (a
 * chosen alternative). Persists immediately. Accepting approves the token's link to the existing
 * payload — flipping one it already holds, or adding one — and never rewrites the shared content,
 * so no other token's gloss changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useApproveAnalysisDispatch = onHostPath
  ? useApproveAnalysisCommand
  : useApproveAnalysisDispatchFromStore;

function useMorphemeBreakdownDispatchFromStore(): (
  tokenRef: string,
  surfaceText: string,
  forms: string[],
  writingSystem: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeBreakdownDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, forms: string[], writingSystem: string) => {
      dispatch(writeMorphemes(tokenRef, surfaceText, forms, writingSystem));
      save(tokenRef);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that replaces the morpheme breakdown on the approved `TokenAnalysis`
 * for a given token. The edit is per-token: a shared payload is forked before re-segmenting, so
 * editing one token's breakdown never rewrites the others. Persists immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useMorphemeBreakdownDispatch = onHostPath
  ? useMorphemeBreakdownCommand
  : useMorphemeBreakdownDispatchFromStore;

function useMorphemeDeleteDispatchFromStore(): (tokenRef: string) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeDeleteDispatch');

  return useCallback(
    (tokenRef: string) => {
      dispatch(deleteMorphemes({ tokenRef }));
      save(tokenRef);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that removes the morpheme breakdown from the approved `TokenAnalysis`
 * for a given token (deleting the analysis record entirely when removing the breakdown leaves it
 * with no other content — no gloss, POS, features, or lexicon sense reference). Persists
 * immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useMorphemeDeleteDispatch = onHostPath
  ? useMorphemeDeleteCommand
  : useMorphemeDeleteDispatchFromStore;

function useMorphemeGlossDispatchFromStore(): (
  tokenRef: string,
  morphemeId: string,
  value: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeGlossDispatch');

  return useCallback(
    (tokenRef: string, morphemeId: string, value: string) => {
      dispatch(writeMorphemeGloss({ tokenRef, morphemeId, value }));
      save(tokenRef);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that writes a gloss on a single morpheme within the approved
 * `TokenAnalysis` for a given token. The edit is per-token: a shared payload is forked before
 * writing, so editing one token's morpheme gloss never rewrites the others. Persists immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useMorphemeGlossDispatch = onHostPath
  ? useMorphemeGlossCommand
  : useMorphemeGlossDispatchFromStore;

// #endregion

// #region Phrase hooks

/**
 * Returns a `Map` from every token ref that belongs to an approved phrase to its
 * `PhraseAnalysisLink`. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseLinkMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkMap');

  return useViewSelector((state: AnalysisState) => selectPhraseLinkByTokenRef(state));
}

/**
 * Returns a `Map` from `PhraseAnalysisLink.id` to the approved `PhraseAnalysisLink` for O(1) lookup
 * of a phrase occurrence. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseLinkByIdMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdMap');

  return useViewSelector((state: AnalysisState) => selectPhraseLinkById(state));
}

/**
 * Returns a stable getter for the current phrase-link-by-id map, for event-time reads that must not
 * subscribe the caller to store updates — e.g. the segmentation dispatch's force-break, which reads
 * the phrases only when a boundary edit fires and would otherwise re-render the whole view tree on
 * every phrase change.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseLinkByIdGetter(): () => Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdGetter');
  const getState = useViewStateGetter();

  return useCallback(() => selectPhraseLinkById(getState()), [getState]);
}

/**
 * Returns the approved `PhraseAnalysisLink` whose token list contains `tokenRef`, or `undefined`
 * when the token is not part of any phrase. Re-renders only when the phrase membership of this
 * token changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseLinkForToken(tokenRef: string): PhraseAnalysisLink | undefined {
  useRequiredCallbacks('usePhraseLinkForToken');

  return useViewSelector((state: AnalysisState) => selectPhraseLinkByTokenRef(state).get(tokenRef));
}

/**
 * Returns the gloss string for the given phrase in the active analysis language, or `''` when
 * absent. Re-renders only when that phrase's gloss changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseGloss(phraseId: string): string {
  useRequiredCallbacks('usePhraseGloss');

  return useViewSelector((state: AnalysisState) => selectPhraseGloss(state, phraseId));
}

/**
 * Returns the sense ref on the given phrase's payload, or `undefined` when the payload has none.
 * Re-renders only when that ref changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePhraseSenseRef(phraseId: string): SenseRef | undefined {
  useRequiredCallbacks('usePhraseSenseRef');

  return useViewSelector((state: AnalysisState) => selectPhraseSenseRef(state, phraseId));
}

function usePhraseGlossDispatchFromStore(): (phraseId: string, value: string) => void {
  const { dispatch, save } = useAnalysisSave('usePhraseGlossDispatch');
  const store = useStore<AnalysisRootState>();

  return useCallback(
    (phraseId: string, value: string) => {
      const location = phraseStart(store.getState(), phraseId);
      dispatch(writePhraseGloss({ phraseId, value }));
      save(location);
    },
    [dispatch, save, store],
  );
}

/**
 * Returns a stable callback that writes the gloss of a phrase occurrence, persisting it
 * immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const usePhraseGlossDispatch = onHostPath
  ? usePhraseGlossCommand
  : usePhraseGlossDispatchFromStore;

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
   * Splits the occurrence `phraseLink` just after `splitAfterTokenRef`, ordering each part's tokens
   * by `tokenDocOrder`. On the host path, the session orders the tokens itself.
   */
  splitPhrase: (
    phraseLink: PhraseAnalysisLink,
    splitAfterTokenRef: string,
    tokenDocOrder: ReadonlyMap<string, number>,
  ) => void;
};

function usePhraseDispatchFromStore(): PhraseDispatch {
  const { dispatch, save } = useAnalysisSave('usePhraseDispatch');
  const store = useStore<AnalysisRootState>();

  const handleCreatePhrase = useCallback(
    (tokens: TokenSnapshot[]): string => {
      const action = dispatch(createPhrase(tokens));
      save(tokens[0].tokenRef);
      return action.payload.id;
    },
    [dispatch, save],
  );

  const handleUpdatePhrase = useCallback(
    (phraseId: string, tokens: TokenSnapshot[]) => {
      dispatch(updatePhrase({ phraseId, tokens }));
      save(tokens[0].tokenRef);
    },
    [dispatch, save],
  );

  const handleDeletePhrase = useCallback(
    (phraseId: string) => {
      const location = phraseStart(store.getState(), phraseId);
      dispatch(deletePhrase({ phraseId }));
      save(location);
    },
    [dispatch, save, store],
  );

  const handleMergePhrases = useCallback(
    (targetPhraseId: string, tokens: TokenSnapshot[], absorbedPhraseId: string | undefined) => {
      dispatch(mergePhrases({ targetPhraseId, tokens, absorbedPhraseId }));
      save(tokens[0].tokenRef);
    },
    [dispatch, save],
  );

  return useMemo(
    () => ({
      createPhrase: handleCreatePhrase,
      updatePhrase: handleUpdatePhrase,
      deletePhrase: handleDeletePhrase,
      mergePhrases: handleMergePhrases,
      splitPhrase: (phraseLink, splitAfterTokenRef, tokenDocOrder) =>
        splitPhraseAtBoundary(
          phraseLink,
          splitAfterTokenRef,
          {
            createPhrase: handleCreatePhrase,
            updatePhrase: handleUpdatePhrase,
            deletePhrase: handleDeletePhrase,
          },
          tokenDocOrder,
        ),
    }),
    [handleCreatePhrase, handleUpdatePhrase, handleDeletePhrase, handleMergePhrases],
  );
}

/**
 * Returns stable callbacks for editing phrase occurrences. Each persists immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const usePhraseDispatch = onHostPath ? usePhraseCommands : usePhraseDispatchFromStore;

// #endregion

// #region Segment hooks

/**
 * Returns the approved free-translation string for the given segment in the active analysis
 * language, or `''` when absent. Re-renders only when that segment's free translation changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useSegmentFreeTranslation(segmentId: string): string {
  useRequiredCallbacks('useSegmentFreeTranslation');

  return useViewSelector((state: AnalysisState) => selectSegmentFreeTranslation(state, segmentId));
}

/**
 * Returns the free translation of every segment carrying a non-empty one in the active analysis
 * language, keyed by segment id. Re-renders only when that map changes.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useFreeTranslationsBySegment(): ReadonlyMap<string, string> {
  useRequiredCallbacks('useFreeTranslationsBySegment');

  return useViewSelector((state: AnalysisState) => selectFreeTranslationsBySegment(state));
}

/**
 * Returns whether the given segment holds an approved free translation, in whatever language.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useSegmentHasApprovedTranslation(segmentId: string): boolean {
  useRequiredCallbacks('useSegmentHasApprovedTranslation');

  return useViewSelector((state: AnalysisState) =>
    selectSegmentsWithApprovedTranslation(state).has(segmentId),
  );
}

/**
 * Returns the id of every segment holding an approved free translation, in whatever language.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useSegmentsWithApprovedTranslation(): ReadonlySet<string> {
  useRequiredCallbacks('useSegmentsWithApprovedTranslation');

  return useViewSelector((state: AnalysisState) => selectSegmentsWithApprovedTranslation(state));
}

/**
 * Returns `book`'s stale free translations, filed by where the view shows each.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function usePlacedStaleFreeTranslations(book: Book): PlacedStaleFreeTranslations {
  useRequiredCallbacks('usePlacedStaleFreeTranslations');

  const stale = useWholeSelector((state: AnalysisState) => selectStaleFreeTranslations(state));
  return useMemo(() => placeStaleFreeTranslations(stale, book), [stale, book]);
}

/**
 * Returns every place in the draft an analysis went stale at, as its stale link, in link order.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export function useStaleTokenLinks(): readonly TokenAnalysisLink[] {
  useRequiredCallbacks('useStaleTokenLinks');

  return useWholeSelector((state: AnalysisState) => selectStaleTokenLinks(state));
}

function useSegmentFreeTranslationDispatchFromStore(): (
  segmentId: string,
  surfaceText: string,
  value: string,
  adoptStaleAnalysisId?: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useSegmentFreeTranslationDispatch');

  return useCallback(
    (segmentId: string, surfaceText: string, value: string, adoptStaleAnalysisId?: string) => {
      dispatch(writeSegmentFreeTranslation(segmentId, surfaceText, value, adoptStaleAnalysisId));
      save(segmentId);
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that writes a free-translation value for the given segment, persisting
 * it immediately. Mirrors {@link useGlossDispatch}: a blank value clears the translation and may
 * drop the now-empty `SegmentAnalysis` record. A segment with no approved translation adopts the
 * stale one that `adoptStaleAnalysisId` names, where given, as the translation the value was typed
 * over.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useSegmentFreeTranslationDispatch = onHostPath
  ? useSegmentFreeTranslationCommand
  : useSegmentFreeTranslationDispatchFromStore;

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

function useStaleFreeTranslationDispatchFromStore(): StaleFreeTranslationDispatch {
  const { dispatch, save } = useAnalysisSave('useStaleFreeTranslationDispatch');

  const keep = useCallback(
    (analysisId: string, segmentId: string, surfaceText: string) => {
      dispatch(keepStaleFreeTranslation({ analysisId, segmentId, surfaceText }));
      save();
    },
    [dispatch, save],
  );

  const discard = useCallback(
    (analysisId: string) => {
      dispatch(discardStaleFreeTranslation({ analysisId }));
      save();
    },
    [dispatch, save],
  );

  return useMemo(() => ({ keep, discard }), [keep, discard]);
}

/**
 * Returns stable callbacks for reviewing stale free translations. Each persists immediately.
 *
 * @throws When called outside a {@link SessionAnalysisProvider} on the host path, or outside an
 *   {@link AnalysisStoreProvider} otherwise.
 */
export const useStaleFreeTranslationDispatch = onHostPath
  ? useStaleFreeTranslationCommands
  : useStaleFreeTranslationDispatchFromStore;

// #endregion
