/** @file Analysis store backed by Redux Toolkit with per-token subscriptions via `useSelector`. */
import type {
  MorphemeAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Provider as ReduxProvider, useDispatch, useSelector, useStore } from 'react-redux';
import {
  createPhrase,
  deleteMorphemes,
  deletePhrase,
  mergePhrases,
  selectAnalysis,
  selectAnalysisLanguage,
  selectApprovedGloss,
  selectApprovedMorphemes,
  selectPhraseLinkByAnalysisId,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  updatePhrase,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
} from '../store/analysisSlice';
import { createAnalysisStore, type AnalysisDispatch, type AnalysisRootState } from '../store';
import { emptyAnalysis } from '../types/empty-factories';

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
};

/** Internal context that carries callback refs alongside the Redux {@link ReduxProvider}. */
const AnalysisCallbackCtx = createContext<CallbackRefs | undefined>(undefined);

// #endregion

// #region Provider

/** Props for {@link AnalysisStoreProvider}. */
type AnalysisStoreProviderProps = Readonly<{
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
}>;

/**
 * Provides a Redux-backed `TextAnalysis` store to the subtree. Components inside can read per-token
 * approved gloss values via {@link useGloss} and write new approved analyses via
 * {@link useGlossDispatch}. The full analysis snapshot is accessible via {@link useAnalysis}.
 *
 * @param props - Component props
 * @param props.children - Subtree that should have access to the analysis store
 * @param props.initialAnalysis - Seed `TextAnalysis`; not reactive after mount
 * @param props.analysisLanguage - BCP 47 tag for reading/writing gloss values
 * @param props.onSave - Callback receiving the updated `TextAnalysis` after each mutation
 * @param props.onGlossChange - Spy called after each gloss write; for test observability only
 * @param props.onPendingEditsChange - Called with whether any gloss input currently holds
 *   uncommitted text, so the caller can show the unsaved indicator while the user types
 * @returns A context provider wrapping the subtree
 */
export function AnalysisStoreProvider({
  children,
  initialAnalysis,
  analysisLanguage,
  onSave,
  onGlossChange,
  onPendingEditsChange,
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

  const callbackRefs = useMemo(
    () => ({ onSaveRef, onGlossChangeRef, reportEditing }),
    [reportEditing],
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
 * Reads the nearest {@link AnalysisStoreProvider}'s callback refs, throwing a hook-named error when
 * called outside a provider. Centralizes the guard every analysis hook shares.
 *
 * @param hookName - Name of the calling hook, used in the thrown error message.
 * @returns The provider's {@link CallbackRefs}.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
function useRequiredCallbacks(hookName: string): CallbackRefs {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error(`${hookName} must be used inside an AnalysisStoreProvider`);
  return ctx;
}

/**
 * Shared setup for the mutation hooks: resolves the provider callbacks and Redux dispatch, and
 * returns a stable `save` that reads the latest analysis from the store and forwards it to
 * `onSave`. Factors out the dispatch-then-save pattern every write hook repeats.
 *
 * @param hookName - Name of the calling hook, used in the guard's error message.
 * @returns The provider callbacks, the typed `dispatch`, and a stable `save` callback.
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
 * Returns the approved gloss string for the given token in the store's active analysis language,
 * re-rendering only when that token's approved analysis changes.
 *
 * @param tokenRef - The token whose gloss to read.
 * @returns The current approved gloss string, or `''` when no approved analysis exists.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGloss(tokenRef: string): string {
  useRequiredCallbacks('useGloss');

  return useSelector((state: AnalysisRootState) => selectApprovedGloss(state.analysis, tokenRef));
}

/**
 * Returns the morpheme breakdown from the approved `TokenAnalysis` for `tokenRef`, re-rendering
 * only when the morpheme array changes. Returns a stable empty array when no approved analysis
 * exists or it has no morphemes.
 *
 * @param tokenRef - The `Token.ref` to look up.
 * @returns The morpheme array from the approved analysis, or a stable empty array.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemes(tokenRef: string): readonly MorphemeAnalysis[] {
  useRequiredCallbacks('useMorphemes');

  return useSelector((state: AnalysisRootState) =>
    selectApprovedMorphemes(state.analysis, tokenRef),
  );
}

/**
 * Returns the active BCP 47 analysis-language tag from the nearest {@link AnalysisStoreProvider}.
 *
 * @returns The analysis language string.
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
 * @returns The current `TextAnalysis` from the nearest {@link AnalysisStoreProvider}.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysis(): TextAnalysis {
  useRequiredCallbacks('useAnalysis');

  return useSelector((state: AnalysisRootState) => selectAnalysis(state.analysis));
}

/**
 * Returns the stable `onGlossChange` callback from the nearest {@link AnalysisStoreProvider}. The
 * callback creates or updates the approved `TokenAnalysis` for the token on each call, then
 * synchronously invokes `onSave` and the `onGlossChange` spy.
 *
 * @returns A function `(tokenRef, surfaceText, value) => void`.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGlossDispatch(): (tokenRef: string, surfaceText: string, value: string) => void {
  const { callbacks, dispatch, save } = useAnalysisSave('useGlossDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, value: string) => {
      dispatch(writeGloss(tokenRef, surfaceText, value));
      save();
      callbacks.onGlossChangeRef.current?.(tokenRef, value);
    },
    [dispatch, save, callbacks],
  );
}

/**
 * Returns a stable callback that replaces the morpheme breakdown on the approved `TokenAnalysis`
 * for a given token. Dispatches the `writeMorphemes` action and triggers `onSave`.
 *
 * @returns A function `(tokenRef, surfaceText, forms, writingSystem) => void`, where
 *   `writingSystem` is the BCP 47 tag of the token's surface text (`Token.writingSystem`), stored
 *   on each morpheme as the writing system of its form.
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
 * for a given token (deleting the analysis record entirely when it carries no gloss). Dispatches
 * the `deleteMorphemes` action and triggers `onSave`.
 *
 * @returns A function `(tokenRef) => void`.
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
 * `TokenAnalysis` for a given token. Dispatches the `writeMorphemeGloss` action and triggers
 * `onSave`.
 *
 * @returns A function `(tokenRef, morphemeId, value) => void`.
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
 * @returns The current phrase link map.
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
 * @returns The current phrase-link-by-id map.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkByIdMap(): Map<string, PhraseAnalysisLink> {
  useRequiredCallbacks('usePhraseLinkByIdMap');

  return useSelector((state: AnalysisRootState) => selectPhraseLinkByAnalysisId(state.analysis));
}

/**
 * Returns the approved `PhraseAnalysisLink` whose token list contains `tokenRef`, or `undefined`
 * when the token is not part of any phrase. Re-renders only when the phrase membership of this
 * token changes.
 *
 * @param tokenRef - The `Token.ref` to look up.
 * @returns The matching approved `PhraseAnalysisLink`, or `undefined`.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseLinkForToken(tokenRef: string): PhraseAnalysisLink | undefined {
  useRequiredCallbacks('usePhraseLinkForToken');

  return useSelector((state: AnalysisRootState) =>
    selectPhraseLinkByTokenRef(state.analysis).get(tokenRef),
  );
}

/**
 * Returns the gloss string for the given phrase in the store's active analysis language,
 * re-rendering only when that phrase's gloss changes.
 *
 * @param phraseId - The `PhraseAnalysis.id` whose gloss to read.
 * @returns The current gloss string, or `''` when absent.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function usePhraseGloss(phraseId: string): string {
  useRequiredCallbacks('usePhraseGloss');

  return useSelector((state: AnalysisRootState) => selectPhraseGloss(state.analysis, phraseId));
}

/**
 * Returns a stable callback that writes a gloss value for the given phrase, then calls `onSave`.
 *
 * @returns A function `(phraseId, value) => void`.
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
  /**
   * Deletes a phrase analysis and its link.
   *
   * @param phraseId - ID of the phrase to delete.
   */
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
 * Returns stable callbacks for creating, updating, and deleting phrases. Each callback dispatches
 * the corresponding Redux action then calls `onSave` with the updated `TextAnalysis`, matching the
 * pattern of {@link useGlossDispatch}.
 *
 * @returns An object with `createPhrase`, `updatePhrase`, `deletePhrase`, and `mergePhrases`
 *   functions.
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
