import type {
  MorphemeAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Provider as ReduxProvider, useDispatch, useSelector, useStore } from 'react-redux';
import { createAnalysisStore, type AnalysisDispatch, type AnalysisRootState } from '../store';
import {
  approveAnalysisForToken,
  createPhrase,
  deleteAnalysis,
  deleteMorphemes,
  deletePhrase,
  mergeAnalysisInto,
  mergePhrases,
  selectAnalysis,
  selectAnalysisLanguage,
  selectAnalysisDeletionOutcome,
  selectApprovedGloss,
  selectApprovedMorphemes,
  selectCatalogRows,
  selectMorphemePayloadIsSolelyOwned,
  selectMorphemeResetLosesGlosses,
  selectPhraseLinkByAnalysisId,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectResolvedTokenAnalysis,
  selectSuggestionAfterClearing,
  selectSegmentFreeTranslation,
  updatePhrase,
  writeAnalysisGloss,
  writeAnalysisMorphemeGloss,
  writeAnalysisMorphemes,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
  writeSegmentFreeTranslation,
  type AnalysisDeletionOutcome,
} from '../store/analysisSlice';
import { emptyAnalysis } from '../types/empty-factories';
import type { CatalogRow } from '../utils/analysis-query';
import { resolvedTokenAnalysisEqual, type ResolvedTokenAnalysis } from '../utils/suggestion-engine';

// #region Internal context

/**
 * Stable ref-container passed through context so {@link useGlossDispatch} can call the latest
 * `onSave` / `onGlossChange` callbacks without recreating its returned function on every parent
 * render.
 */
type CallbackRefs = {
  /** Ref to the `onSave` prop of the nearest {@link AnalysisStoreProvider}. */
  onSaveRef: { current: ((analysis: TextAnalysis) => void) | undefined };
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
   * Whether un-approved tokens should render the engine's derived suggestion
   * ({@link useShowSuggestions}). Carried on the provider so the demo toggle reaches every gloss
   * input without threading a prop through the segment/phrase tree.
   */
  showSuggestions: boolean;
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
  /** BCP 47 analysis-language tag used when reading and writing `TokenAnalysis.gloss` values. */
  analysisLanguage: string;
  /**
   * The initial `TextAnalysis` to seed the store. Not reactive after mount — the caller is
   * responsible for unmounting and remounting when the active project changes.
   */
  initialAnalysis?: TextAnalysis;
  /**
   * Called after every store mutation with the updated `TextAnalysis`. Use this to persist changes
   * back to the active project's storage.
   */
  onSave?: (analysis: TextAnalysis) => void;
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
   * When `true`, un-approved tokens that match the analysis pool render the engine's derived
   * suggestion (blue) with accept / promote affordances ({@link useResolvedTokenAnalysis},
   * {@link useShowSuggestions}). Defaults to `false` so isolated tests show no suggestions; the app
   * opts in via a demo toggle.
   */
  showSuggestions?: boolean;
  /**
   * When `true`, the subtree renders the analysis as read-only: glosses and free translations show
   * as static text, and linking, splitting, phrase, suggestion, and boundary controls do not
   * render. Used for a Paratext 9 import, whose analysis only sync may change.
   */
  readOnly?: boolean;
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
  showSuggestions = false,
  readOnly = false,
}: AnalysisStoreProviderProps) {
  // Lazy initialization: useRef(createStore()) would create and discard a store on every render
  const storeRef = useRef<ReturnType<typeof createAnalysisStore> | undefined>(undefined);
  if (!storeRef.current) {
    storeRef.current = createAnalysisStore({
      analysis: { analysis: initialAnalysis ?? emptyAnalysis(), analysisLanguage },
    });
  }
  const store = storeRef.current;

  // Use refs so the dispatch callback never needs to re-create when parent re-renders
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onGlossChangeRef = useRef(onGlossChange);
  onGlossChangeRef.current = onGlossChange;
  const onPendingEditsChangeRef = useRef(onPendingEditsChange);
  onPendingEditsChangeRef.current = onPendingEditsChange;

  // Count of gloss inputs currently holding uncommitted text. Kept in a ref (not state) so
  // registering/unregistering an editor never re-renders the provider; only the 0↔non-0 crossings
  // are forwarded to the parent, which owns the indicator.
  const editingCountRef = useRef(0);
  const reportEditing = useCallback((active: boolean) => {
    const wasPending = editingCountRef.current > 0;
    editingCountRef.current += active ? 1 : -1;
    const isPending = editingCountRef.current > 0;
    if (wasPending !== isPending) onPendingEditsChangeRef.current?.(isPending);
  }, []);

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
      store.dispatch(writeGloss(tokenRef, surfaceText, value));
      onSaveRef.current?.(store.getState().analysis.analysis);
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
      showSuggestions,
      readOnly,
    }),
    [reportEditing, requestGlossEdit, showSuggestions, readOnly],
  );

  return (
    <ReduxProvider store={store}>
      <AnalysisCallbackCtx.Provider value={callbackRefs}>{children}</AnalysisCallbackCtx.Provider>
    </ReduxProvider>
  );
}

// #endregion

// #region Internal hooks

/**
 * Reads the nearest {@link AnalysisStoreProvider}'s callback refs, naming `hookName` in the guard's
 * error. Centralizes the guard every analysis hook shares.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
function useRequiredCallbacks(hookName: string): CallbackRefs {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error(`${hookName} must be used inside an AnalysisStoreProvider`);
  return ctx;
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
  save: () => void;
} {
  const callbacks = useRequiredCallbacks(hookName);
  const dispatch = useDispatch<AnalysisDispatch>();
  const store = useStore<AnalysisRootState>();
  const save = useCallback(() => {
    const { analysis } = store.getState().analysis;
    callbacks.onSaveRef.current?.(analysis);
  }, [store, callbacks]);
  return { callbacks, dispatch, save };
}

/**
 * Registers a gloss input as currently holding uncommitted text whenever `isEditing` is true,
 * unregistering it when `isEditing` turns false or the input unmounts. The provider aggregates
 * these across all inputs and reports whether any edit is in progress, so the tab's unsaved
 * indicator can light up the moment the user starts typing — gloss writes themselves are deferred
 * to blur, which would otherwise leave the indicator dark mid-edit.
 *
 * @param isEditing - Whether this input's draft currently differs from its committed value.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useReportGlossEditing(isEditing: boolean): void {
  const { reportEditing } = useRequiredCallbacks('useReportGlossEditing');
  useEffect(() => {
    if (!isEditing) return undefined;
    reportEditing(true);
    return () => reportEditing(false);
  }, [isEditing, reportEditing]);
}

// #endregion

// #region Token hooks

/**
 * Returns the approved gloss string for the given token in the store's active analysis language, or
 * `''` when no approved analysis exists. Re-renders only when that token's approved analysis
 * changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGloss(tokenRef: string): string {
  useRequiredCallbacks('useGloss');

  return useSelector((state: AnalysisRootState) => selectApprovedGloss(state.analysis, tokenRef));
}

/**
 * Returns the merged analysis the renderer shows for a token — its approved decision, else the
 * engine's derived suggestion, else `undefined` ({@link selectResolvedTokenAnalysis}). Subscribes
 * through {@link resolvedTokenAnalysisEqual} so the result stays referentially stable across
 * unrelated store changes, re-rendering only when the decision or suggestion actually changes.
 *
 * When `enabled` is `false` the selector short-circuits to `undefined` without consulting the pool,
 * so a chip that is not currently showing suggestions does no per-token pool lookup or
 * normalization on each store change.
 *
 * @param tokenRef - The `Token.ref` to resolve.
 * @param surfaceText - The token's current surface text, matched against the pool when the token is
 *   unapproved.
 * @param enabled - Whether to resolve at all; `false` returns `undefined` without pool work.
 *   Defaults to `true`.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useResolvedTokenAnalysis(
  tokenRef: string,
  surfaceText: string,
  enabled = true,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useResolvedTokenAnalysis');

  return useSelector(
    (state: AnalysisRootState) =>
      enabled ? selectResolvedTokenAnalysis(state.analysis, tokenRef, surfaceText) : undefined,
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
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useSuggestionAfterClearing(
  tokenRef: string,
  surfaceText: string,
  enabled: boolean,
): ResolvedTokenAnalysis | undefined {
  useRequiredCallbacks('useSuggestionAfterClearing');

  return useSelector(
    (state: AnalysisRootState) =>
      enabled ? selectSuggestionAfterClearing(state.analysis, tokenRef, surfaceText) : undefined,
    resolvedTokenAnalysisEqual,
  );
}

/**
 * Returns whether un-approved tokens should render the engine's derived suggestion, as set by the
 * nearest {@link AnalysisStoreProvider}'s `showSuggestions` prop (a removable demo toggle).
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useShowSuggestions(): boolean {
  return useRequiredCallbacks('useShowSuggestions').showSuggestions;
}

/**
 * Returns whether the analysis in the nearest {@link AnalysisStoreProvider} is read-only, as set by
 * its `readOnly` prop. Editing affordances render their static form when this is `true`.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysisReadOnly(): boolean {
  return useRequiredCallbacks('useAnalysisReadOnly').readOnly;
}

/**
 * Returns the morpheme breakdown from the approved `TokenAnalysis` for `tokenRef`, re-rendering
 * only when the morpheme array changes. Returns a stable empty array when no approved analysis
 * exists or it has no morphemes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemes(tokenRef: string): readonly MorphemeAnalysis[] {
  useRequiredCallbacks('useMorphemes');

  return useSelector((state: AnalysisRootState) =>
    selectApprovedMorphemes(state.analysis, tokenRef),
  );
}

/**
 * Returns whether resetting `tokenRef`'s morpheme breakdown would discard glosses no other token
 * still holds, so the morpheme editor can confirm before an irreversible loss (the app has no
 * undo). See {@link selectMorphemeResetLosesGlosses} for why a shared payload does not qualify.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemeResetLosesGlosses(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemeResetLosesGlosses');

  return useSelector((state: AnalysisRootState) =>
    selectMorphemeResetLosesGlosses(state.analysis, tokenRef),
  );
}

/**
 * Returns whether `tokenRef` alone holds its analysis payload, so a breakdown edit destroys the
 * glosses it strands rather than leaving them with co-linked tokens. See
 * {@link selectMorphemePayloadIsSolelyOwned} for what counts as sharing.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemePayloadIsSolelyOwned(tokenRef: string): boolean {
  useRequiredCallbacks('useMorphemePayloadIsSolelyOwned');

  return useSelector((state: AnalysisRootState) =>
    selectMorphemePayloadIsSolelyOwned(state.analysis, tokenRef),
  );
}

/**
 * Returns one row per distinct token analysis in the draft, each carrying the usage data the
 * analysis catalog lists it by, in the analysis's own order. Narrowing and ordering are the
 * caller's, so a keystroke re-runs only that pass.
 *
 * The result keeps its reference while the analyses and their links keep theirs, so an unrelated
 * write — a free translation, a phrase link — leaves the list unrendered. It changes with
 * `currentBook`, which the per-book usage count is taken against.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useCatalogRows(currentBook: string): readonly CatalogRow[] {
  useRequiredCallbacks('useCatalogRows');

  return useSelector((state: AnalysisRootState) => selectCatalogRows(state.analysis, currentBook));
}

/**
 * Where a catalog row's edit left the record it was aimed at.
 *
 * A write that makes a row content-identical to a sibling collapses the two, so the row the reader
 * edited is gone from the listing and another's usage count has grown by its tokens. That reads as
 * data loss unless it is reported, hence this rather than a bare `void`.
 */
export type AnalysisEditOutcome =
  | {
      /** The record survived the edit under its own id, which is the ordinary case. */
      kind: 'edited';
    }
  | {
      /** The record collapsed onto a content-identical sibling and no longer exists. */
      kind: 'merged';
      /** The surviving record's id, which the listing should now point the reader at. */
      survivingAnalysisId: string;
      /** What the survivor now reads as in the active analysis language, `''` when it has none. */
      survivingGloss: string;
      /** The survivor's usage count once the collapsed record's tokens joined it. */
      survivingUsageCount: number;
    }
  | {
      /** The edit emptied the record, which removed it and every link to it. */
      kind: 'removed';
    };

/**
 * Reports where an edit left the record `analysisId` named, so a row that vanishes can be explained
 * rather than read as lost work. Only the survivor the write recorded tells a collapse from a
 * removal; the state they leave is the same.
 */
function readEditOutcome(
  after: TextAnalysis,
  survivingAnalysisId: string | undefined,
  analysisId: string,
  analysisLanguage: string,
): AnalysisEditOutcome {
  if (after.tokenAnalyses.some((ta) => ta.id === analysisId)) return { kind: 'edited' };
  if (survivingAnalysisId === undefined) return { kind: 'removed' };

  const survivingAnalysis = after.tokenAnalyses.find((ta) => ta.id === survivingAnalysisId);
  return {
    kind: 'merged',
    survivingAnalysisId,
    /* v8 ignore next -- the survivor was just written into the state this reads */
    survivingGloss: survivingAnalysis?.gloss?.[analysisLanguage] ?? '',
    survivingUsageCount: new Set(
      after.tokenAnalysisLinks
        .filter((l) => l.analysisId === survivingAnalysisId && l.status === 'approved')
        .map((l) => l.token.tokenRef),
    ).size,
  };
}

/** The catalog's write callbacks, each keyed by `analysisId` and so global to that record. */
export type AnalysisRowDispatch = {
  /**
   * Writes a gloss onto the record itself, changing what it says for every token linked to it. A
   * blank value clears it.
   */
  writeGloss: (analysisId: string, value: string) => AnalysisEditOutcome;
  /**
   * Replaces the record's morpheme breakdown for every token linked to it. The breakdown is
   * replaced rather than reconciled, so the old morphemes' glosses go with it.
   */
  writeMorphemes: (
    analysisId: string,
    forms: readonly string[],
    writingSystem: string,
  ) => AnalysisEditOutcome;
  /** Writes a gloss onto one morpheme of the record, for every token linked to it. */
  writeMorphemeGloss: (
    analysisId: string,
    morphemeId: string,
    value: string,
  ) => AnalysisEditOutcome;
  /**
   * Removes the record and every link to it, leaving its tokens on whatever the suggestion pool
   * still offers. Irreversible — see {@link useAnalysisDeletionOutcome} for what it will cost.
   */
  deleteAnalysis: (analysisId: string) => void;
  /** Moves every link on one record to another and drops the source. */
  mergeInto: (sourceAnalysisId: string, targetAnalysisId: string) => void;
};

/**
 * Returns stable callbacks for editing the analysis records the catalog lists. Every callback here
 * is keyed by `analysisId` and so rewrites the record for all its tokens at once — the opposite of
 * the `tokenRef`-keyed hooks above, which fork a shared payload to keep an edit local to one token.
 * The key is the whole of the distinction; neither family takes a scope flag.
 *
 * Each write reports where it left the record, so the caller can tell the reader that an edit
 * collapsed the row onto a sibling rather than letting it vanish unexplained.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysisRowDispatch(): AnalysisRowDispatch {
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

  const handleDelete = useCallback(
    (analysisId: string) => {
      dispatch(deleteAnalysis({ analysisId }));
      save();
    },
    [dispatch, save],
  );

  const handleMergeInto = useCallback(
    (sourceAnalysisId: string, targetAnalysisId: string) => {
      dispatch(mergeAnalysisInto({ sourceAnalysisId, targetAnalysisId }));
      save();
    },
    [dispatch, save],
  );

  return useMemo(
    () => ({
      writeGloss: handleWriteGloss,
      writeMorphemes: handleWriteMorphemes,
      writeMorphemeGloss: handleWriteMorphemeGloss,
      deleteAnalysis: handleDelete,
      mergeInto: handleMergeInto,
    }),
    [
      handleWriteGloss,
      handleWriteMorphemes,
      handleWriteMorphemeGloss,
      handleDelete,
      handleMergeInto,
    ],
  );
}

/**
 * Returns a stable getter for what deleting a record would do to the tokens that approve it — left
 * blank, or falling back to a surviving homograph — so a confirmation can name the concrete
 * consequence. Returns `undefined` for an id that resolves to no record.
 *
 * A getter rather than a subscription: the outcome is read once, when the confirmation opens, and
 * subscribing every row to it would recompute the suggestion pool per row on every store change.
 *
 * A fallback is reported as a blank while suggestions are hidden: the surviving homograph reaches a
 * token only as a suggestion, so the affected tokens read blank whatever the pool still offers.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysisDeletionOutcome(): (
  analysisId: string,
) => AnalysisDeletionOutcome | undefined {
  const { showSuggestions, readOnly } = useRequiredCallbacks('useAnalysisDeletionOutcome');
  const store = useStore<AnalysisRootState>();
  const suggestionsVisible = showSuggestions && !readOnly;

  return useCallback(
    (analysisId: string) => {
      const outcome = selectAnalysisDeletionOutcome(store.getState().analysis, analysisId);
      if (suggestionsVisible || outcome?.kind !== 'fallback') return outcome;
      return { kind: 'blank', usageCount: outcome.usageCount };
    },
    [store, suggestionsVisible],
  );
}

/**
 * Returns the active BCP 47 analysis-language tag from the nearest {@link AnalysisStoreProvider}.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysisLanguage(): string {
  useRequiredCallbacks('useAnalysisLanguage');

  return useSelector((state: AnalysisRootState) => selectAnalysisLanguage(state.analysis));
}

/**
 * Returns the current `TextAnalysis` snapshot, re-rendering on every analysis change. Intended for
 * components that need the full analysis (e.g. an analysis-selection popup).
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysis(): TextAnalysis {
  useRequiredCallbacks('useAnalysis');

  return useSelector((state: AnalysisRootState) => selectAnalysis(state.analysis));
}

/**
 * Returns a stable callback that creates or updates the approved `TokenAnalysis` for a token. The
 * edit is per-token: the reducer forks a shared payload before writing, so editing one token never
 * rewrites the others. Commits immediately, invoking `onSave` and the optional (test-only)
 * `onGlossChange` spy.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGlossDispatch(): (tokenRef: string, surfaceText: string, value: string) => void {
  return useRequiredCallbacks('useGlossDispatch').requestGlossEdit;
}

/**
 * Returns a stable callback that approves an existing shared `TokenAnalysis` payload for a token —
 * the persisted half of accepting a suggestion (the suggested payload) or promoting a candidate (a
 * chosen alternative). Persists immediately. Accepting only adds an approved link to the existing
 * payload (raising its frequency), it does not rewrite the shared content, so no other token's
 * gloss changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useApproveAnalysisDispatch(): (
  tokenRef: string,
  surfaceText: string,
  analysisId: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useApproveAnalysisDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, analysisId: string) => {
      dispatch(approveAnalysisForToken({ tokenRef, surfaceText, analysisId }));
      save();
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that replaces the morpheme breakdown on the approved `TokenAnalysis`
 * for a given token. The edit is per-token: the reducer forks a shared payload before
 * re-segmenting, so editing one token's breakdown never rewrites the others. Commits immediately
 * and triggers `onSave`.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemeBreakdownDispatch(): (
  tokenRef: string,
  surfaceText: string,
  forms: string[],
  writingSystem: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeBreakdownDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, forms: string[], writingSystem: string) => {
      dispatch(writeMorphemes(tokenRef, surfaceText, forms, writingSystem));
      save();
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
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemeDeleteDispatch(): (tokenRef: string) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeDeleteDispatch');

  return useCallback(
    (tokenRef: string) => {
      dispatch(deleteMorphemes({ tokenRef }));
      save();
    },
    [dispatch, save],
  );
}

/**
 * Returns a stable callback that writes a gloss on a single morpheme within the approved
 * `TokenAnalysis` for a given token. The edit is per-token: the reducer forks a shared payload
 * before writing, so editing one token's morpheme gloss never rewrites the others. Commits
 * immediately and triggers `onSave`.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemeGlossDispatch(): (
  tokenRef: string,
  morphemeId: string,
  value: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useMorphemeGlossDispatch');

  return useCallback(
    (tokenRef: string, morphemeId: string, value: string) => {
      dispatch(writeMorphemeGloss({ tokenRef, morphemeId, value }));
      save();
    },
    [dispatch, save],
  );
}

// #endregion

// #region Phrase hooks

/**
 * Returns a `Map` from every token ref that belongs to an approved phrase to its
 * `PhraseAnalysisLink`. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkMap');

  return useSelector((state: AnalysisRootState) => selectPhraseLinkByTokenRef(state.analysis));
}

/**
 * Returns a `Map` from `analysisId` to the approved `PhraseAnalysisLink` for O(1) phrase lookup by
 * id. Re-renders only when the phrase link map reference changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkByIdMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdMap');

  return useSelector((state: AnalysisRootState) => selectPhraseLinkByAnalysisId(state.analysis));
}

/**
 * Returns a stable getter for the current phrase-link-by-id map, for event-time reads that must not
 * subscribe the caller to store updates — e.g. the segmentation dispatch's force-break, which reads
 * the phrases only when a boundary edit fires and would otherwise re-render the whole view tree on
 * every phrase change.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkByIdGetter(): () => Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdGetter');
  const store = useStore<AnalysisRootState>();

  return useCallback(() => selectPhraseLinkByAnalysisId(store.getState().analysis), [store]);
}

/**
 * Returns the approved `PhraseAnalysisLink` whose token list contains `tokenRef`, or `undefined`
 * when the token is not part of any phrase. Re-renders only when the phrase membership of this
 * token changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkForToken(tokenRef: string): PhraseAnalysisLink | undefined {
  useRequiredCallbacks('usePhraseLinkForToken');

  return useSelector((state: AnalysisRootState) =>
    selectPhraseLinkByTokenRef(state.analysis).get(tokenRef),
  );
}

/**
 * Returns the gloss string for the given phrase in the store's active analysis language, or `''`
 * when absent. Re-renders only when that phrase's gloss changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseGloss(phraseId: string): string {
  useRequiredCallbacks('usePhraseGloss');

  return useSelector((state: AnalysisRootState) => selectPhraseGloss(state.analysis, phraseId));
}

/**
 * Returns a stable callback that writes a gloss value for the given phrase, then calls `onSave`.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseGlossDispatch(): (phraseId: string, value: string) => void {
  const { dispatch, save } = useAnalysisSave('usePhraseGlossDispatch');

  return useCallback(
    (phraseId: string, value: string) => {
      dispatch(writePhraseGloss({ phraseId, value }));
      save();
    },
    [dispatch, save],
  );
}

/** Return value of {@link usePhraseDispatch}. */
export type PhraseDispatch = {
  /**
   * Creates a new approved phrase from an ordered list of token snapshots.
   *
   * @param tokens - Ordered `TokenSnapshot`s in document order.
   * @returns The UUID assigned to the new phrase.
   */
  createPhrase: (tokens: TokenSnapshot[]) => string;
  /**
   * Replaces the token list of an existing phrase link.
   *
   * @param phraseId - ID of the phrase to update.
   * @param tokens - Replacement ordered `TokenSnapshot`s in document order.
   */
  updatePhrase: (phraseId: string, tokens: TokenSnapshot[]) => void;
  /** Deletes a phrase analysis and its link. */
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
};

/**
 * Returns stable callbacks for creating, updating, and deleting phrases. Each callback commits
 * immediately and persists the updated analysis.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseDispatch(): PhraseDispatch {
  const { dispatch, save } = useAnalysisSave('usePhraseDispatch');

  const handleCreatePhrase = useCallback(
    (tokens: TokenSnapshot[]): string => {
      const action = dispatch(createPhrase(tokens));
      save();
      return action.payload.id;
    },
    [dispatch, save],
  );

  const handleUpdatePhrase = useCallback(
    (phraseId: string, tokens: TokenSnapshot[]) => {
      dispatch(updatePhrase({ phraseId, tokens }));
      save();
    },
    [dispatch, save],
  );

  const handleDeletePhrase = useCallback(
    (phraseId: string) => {
      dispatch(deletePhrase({ phraseId }));
      save();
    },
    [dispatch, save],
  );

  const handleMergePhrases = useCallback(
    (targetPhraseId: string, tokens: TokenSnapshot[], absorbedPhraseId: string | undefined) => {
      dispatch(mergePhrases({ targetPhraseId, tokens, absorbedPhraseId }));
      save();
    },
    [dispatch, save],
  );

  return useMemo(
    () => ({
      createPhrase: handleCreatePhrase,
      updatePhrase: handleUpdatePhrase,
      deletePhrase: handleDeletePhrase,
      mergePhrases: handleMergePhrases,
    }),
    [handleCreatePhrase, handleUpdatePhrase, handleDeletePhrase, handleMergePhrases],
  );
}

// #endregion

// #region Segment hooks

/**
 * Returns the approved free-translation string for the given segment in the store's active analysis
 * language, or `''` when absent. Re-renders only when that segment's free translation changes.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useSegmentFreeTranslation(segmentId: string): string {
  useRequiredCallbacks('useSegmentFreeTranslation');

  return useSelector((state: AnalysisRootState) =>
    selectSegmentFreeTranslation(state.analysis, segmentId),
  );
}

/**
 * Returns a stable callback that writes a free-translation value for the given segment, then calls
 * `onSave`. Mirrors {@link useGlossDispatch}: a blank value clears the translation and may drop the
 * now-empty `SegmentAnalysis` record.
 *
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useSegmentFreeTranslationDispatch(): (
  segmentId: string,
  surfaceText: string,
  value: string,
) => void {
  const { dispatch, save } = useAnalysisSave('useSegmentFreeTranslationDispatch');

  return useCallback(
    (segmentId: string, surfaceText: string, value: string) => {
      dispatch(writeSegmentFreeTranslation(segmentId, surfaceText, value));
      save();
    },
    [dispatch, save],
  );
}

// #endregion
