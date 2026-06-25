/** @file Analysis store backed by Redux Toolkit with per-token subscriptions via `useSelector`. */
import type {
  MorphemeAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Provider as ReduxProvider, useDispatch, useSelector, useStore } from 'react-redux';
import {
  approveAnalysisForToken,
  createPhrase,
  deleteMorphemes,
  deletePhrase,
  forkAnalysisForToken,
  mergePhrases,
  selectAnalysis,
  selectAnalysisLanguage,
  selectApprovedGloss,
  selectApprovedLinkCountForPayload,
  selectApprovedMorphemes,
  selectPhraseLinkByAnalysisId,
  selectPhraseLinkByTokenRef,
  selectPhraseGloss,
  selectResolvedTokenAnalysis,
  selectSegmentFreeTranslation,
  updatePhrase,
  writeGloss,
  writeMorphemeGloss,
  writeMorphemes,
  writePhraseGloss,
  writeSegmentFreeTranslation,
} from '../store/analysisSlice';
import { createAnalysisStore, type AnalysisDispatch, type AnalysisRootState } from '../store';
import { emptyAnalysis } from '../types/empty-factories';
import { resolvedTokenAnalysisEqual, type ResolvedTokenAnalysis } from '../utils/suggestion-engine';
import { GlobalEditConfirmationModal } from './modals/GlobalEditConfirmationModal';

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
   * Stable entry point {@link useGlossDispatch} returns for writing a gloss. Routes through
   * {@link gateEdit}: when the provider's `confirmGlobalEdits` is on and the token's approved
   * payload is shared by more than one token, the edit is held for
   * {@link GlobalEditConfirmationModal} instead of committing. Returns whether the edit was held (so
   * a gloss input can revert its uncommitted draft) rather than committed immediately.
   */
  requestGlossEdit: (tokenRef: string, surfaceText: string, value: string) => boolean;
  /**
   * Shared global-edit gate for any human edit that fans out across a shared `TokenAnalysis`
   * payload. Runs `commit` immediately, unless `confirmGlobalEdits` is on and the token's payload
   * is shared by more than one token — then the choice is held for
   * {@link GlobalEditConfirmationModal}, where `commit` applies the edit to every sharing token and
   * `forkAndCommit` forks a per-instance copy first. Returns whether the edit was held (`true`)
   * rather than committed (`false`). One gate serves every fan-out edit kind — gloss and morpheme —
   * so they all prompt consistently; the per-token clear/delete paths fork in the reducer and do
   * not route through it.
   */
  gateEdit: (tokenRef: string, commit: () => void, forkAndCommit: () => void) => boolean;
  /**
   * Whether un-approved tokens should render the engine's derived suggestion
   * ({@link useShowSuggestions}). Carried on the provider so the demo toggle reaches every gloss
   * input without threading a prop through the segment/phrase tree.
   */
  showSuggestions: boolean;
};

/**
 * An edit the provider is holding open while {@link GlobalEditConfirmationModal} is shown. The
 * specific mutation (gloss, morpheme breakdown, or morpheme gloss) is captured in the two closures
 * so one modal can resolve any held edit without knowing its kind.
 */
type PendingGlobalEdit = {
  /** How many tokens share the payload, shown in the modal copy. Always greater than 1. */
  count: number;
  /** Applies the edit to every token sharing the payload ("update all"). */
  commit: () => void;
  /** Forks a per-instance copy for this token, then applies the edit to the copy alone. */
  forkAndCommit: () => void;
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
  /**
   * When `true`, a gloss edit to a `TokenAnalysis` payload shared by more than one token is held
   * and routed through {@link GlobalEditConfirmationModal} so the user can update every token, fork
   * a per-instance copy, or cancel — rather than silently rewriting every occurrence. Defaults to
   * `false` (edits commit immediately) so existing consumers are unaffected; the app opts in via a
   * removable toggle.
   */
  confirmGlobalEdits?: boolean;
  /**
   * When `true`, un-approved tokens that match the analysis pool render the engine's derived
   * suggestion (green) with accept / promote affordances ({@link useResolvedTokenAnalysis},
   * {@link useShowSuggestions}). Defaults to `false` so existing consumers and isolated tests show
   * no suggestions; the app opts in via a removable demo toggle.
   */
  showSuggestions?: boolean;
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
 * @param props.confirmGlobalEdits - When true, editing a payload shared by more than one token is
 *   routed through {@link GlobalEditConfirmationModal} instead of committing immediately
 * @param props.showSuggestions - When true, un-approved tokens render the engine's derived
 *   suggestion with accept / promote affordances
 * @returns A context provider wrapping the subtree
 */
export function AnalysisStoreProvider({
  children,
  initialAnalysis,
  analysisLanguage,
  onSave,
  onGlossChange,
  onPendingEditsChange,
  confirmGlobalEdits = false,
  showSuggestions = false,
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

  // Holds an edit while the global-edit confirmation modal is open. Set only when
  // `confirmGlobalEdits` is on and the edited payload is shared by more than one token.
  const [pendingEdit, setPendingEdit] = useState<PendingGlobalEdit | undefined>(undefined);

  // Shared gate for every fan-out edit (gloss and morpheme). Runs `commit` immediately unless
  // confirmation is on and the token's payload is shared by more than one token, in which case the
  // choice is held for the modal. The count is read before the write so a brand-new analysis (no
  // approved payload yet, count 0) never prompts. Returns whether the edit was held, so a
  // commit-on-blur input can revert its uncommitted draft.
  const gateEdit = useCallback(
    (tokenRef: string, commit: () => void, forkAndCommit: () => void): boolean => {
      if (confirmGlobalEdits) {
        const count = selectApprovedLinkCountForPayload(store.getState().analysis, tokenRef);
        if (count > 1) {
          setPendingEdit({ count, commit, forkAndCommit });
          return true;
        }
      }
      commit();
      return false;
    },
    [confirmGlobalEdits, store],
  );

  // Commits a gloss edit to the store: write, persist via `onSave`, then notify the `onGlossChange`
  // spy. Shared by the immediate (unshared) path and the modal's "update all" / "fork" handlers so
  // every commit route behaves identically.
  const commitGloss = useCallback(
    (tokenRef: string, surfaceText: string, value: string) => {
      store.dispatch(writeGloss(tokenRef, surfaceText, value));
      onSaveRef.current?.(store.getState().analysis.analysis);
      onGlossChangeRef.current?.(tokenRef, value);
    },
    [store],
  );

  // The gloss-write entry point exposed to inputs: routes a gloss edit through the shared gate, so a
  // gloss edit to a payload shared by more than one token prompts before fanning out. "Fork" repoints
  // this token's approved link to a private clone, then the same write lands on the clone.
  const requestGlossEdit = useCallback(
    (tokenRef: string, surfaceText: string, value: string) =>
      gateEdit(
        tokenRef,
        () => commitGloss(tokenRef, surfaceText, value),
        () => {
          store.dispatch(forkAnalysisForToken(tokenRef));
          commitGloss(tokenRef, surfaceText, value);
        },
      ),
    [gateEdit, commitGloss, store],
  );

  const callbackRefs = useMemo(
    () => ({
      onSaveRef,
      onGlossChangeRef,
      reportEditing,
      requestGlossEdit,
      gateEdit,
      showSuggestions,
    }),
    [reportEditing, requestGlossEdit, gateEdit, showSuggestions],
  );

  return (
    <ReduxProvider store={store}>
      <AnalysisCallbackCtx.Provider value={callbackRefs}>
        {children}
        {pendingEdit && (
          <GlobalEditConfirmationModal
            count={pendingEdit.count}
            onUpdateAll={() => {
              pendingEdit.commit();
              setPendingEdit(undefined);
            }}
            onForkInstead={() => {
              pendingEdit.forkAndCommit();
              setPendingEdit(undefined);
            }}
            onCancel={() => setPendingEdit(undefined)}
          />
        )}
      </AnalysisCallbackCtx.Provider>
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
 * Returns the merged analysis the renderer shows for a token — its approved decision, else the
 * engine's derived suggestion, else `undefined` ({@link selectResolvedTokenAnalysis}). Subscribes
 * through {@link resolvedTokenAnalysisEqual} so the freshly-allocated result stays referentially
 * stable across unrelated store changes: the token re-renders only when its approved decision or
 * suggestion actually changes, never on every pool rebuild.
 *
 * When `enabled` is `false` the selector short-circuits to `undefined` without consulting the pool,
 * so a chip that is not currently showing suggestions does no per-token pool lookup or
 * normalization on each store change. The only consumer ({@link TokenChip}) reads `resolved` solely
 * to render suggestions, so it passes its `showSuggestions` flag here.
 *
 * @param tokenRef - The `Token.ref` to resolve.
 * @param surfaceText - The token's current surface text, matched against the pool when the token is
 *   unapproved.
 * @param enabled - Whether to resolve at all; `false` returns `undefined` without pool work.
 *   Defaults to `true`.
 * @returns The approved or suggested analysis for the token, or `undefined` when it has neither (or
 *   when `enabled` is `false`).
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
 * Returns whether un-approved tokens should render the engine's derived suggestion, as set by the
 * nearest {@link AnalysisStoreProvider}'s `showSuggestions` prop (a removable demo toggle).
 *
 * @returns `true` when suggestions should be shown.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useShowSuggestions(): boolean {
  return useRequiredCallbacks('useShowSuggestions').showSuggestions;
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
 * Returns a stable callback that creates or updates the approved `TokenAnalysis` for a token. When
 * the provider's `confirmGlobalEdits` is on and the token's approved payload is shared by more than
 * one token, the write is held and routed through {@link GlobalEditConfirmationModal} so the user
 * can update every token, fork a per-instance copy, or cancel; otherwise it commits immediately,
 * invoking `onSave` and the optional (test-only) `onGlossChange` spy. The gating itself lives on
 * the provider so a single modal serves every gloss input (see {@link AnalysisStoreProvider}).
 *
 * @returns A function `(tokenRef, surfaceText, value) => boolean` returning whether the edit was
 *   held for confirmation (`true`) rather than committed immediately, so a commit-on-blur input can
 *   revert its uncommitted draft when the edit is parked in the modal.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGlossDispatch(): (
  tokenRef: string,
  surfaceText: string,
  value: string,
) => boolean {
  return useRequiredCallbacks('useGlossDispatch').requestGlossEdit;
}

/**
 * Returns a stable callback that approves an existing shared `TokenAnalysis` payload for a token —
 * the persisted half of accepting a suggestion (the suggested payload) or promoting a candidate (a
 * chosen alternative). Dispatches `approveAnalysisForToken` then calls `onSave`. Unlike
 * {@link useGlossDispatch} this never routes through the global-edit confirmation: accepting only
 * adds an approved link to the existing payload (raising its frequency), it does not rewrite the
 * shared content, so no other token's gloss changes.
 *
 * @returns A function `(tokenRef, surfaceText, analysisId) => void`, where `analysisId` is the
 *   payload to approve and `surfaceText` is this token's surface text, snapshotted on the new
 *   link.
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
 * for a given token. Setting a breakdown rewrites shared analysis content, so — like
 * {@link useGlossDispatch} — it routes through the global-edit gate: when `confirmGlobalEdits` is on
 * and the payload is shared by more than one token, the write is held for
 * {@link GlobalEditConfirmationModal} (update all / fork / cancel) rather than silently fanning out;
 * otherwise it commits immediately and triggers `onSave`.
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
  const { dispatch, save, callbacks } = useAnalysisSave('useMorphemeBreakdownDispatch');

  return useCallback(
    (tokenRef: string, surfaceText: string, forms: string[], writingSystem: string) => {
      const commit = () => {
        dispatch(writeMorphemes(tokenRef, surfaceText, forms, writingSystem));
        save();
      };
      callbacks.gateEdit(tokenRef, commit, () => {
        dispatch(forkAnalysisForToken(tokenRef));
        commit();
      });
    },
    [dispatch, save, callbacks],
  );
}

/**
 * Returns a stable callback that removes the morpheme breakdown from the approved `TokenAnalysis`
 * for a given token (deleting the analysis record entirely when removing the breakdown leaves it
 * with no other content — no gloss, POS, features, or lexicon sense reference). Dispatches the
 * `deleteMorphemes` action and triggers `onSave`.
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
 * `TokenAnalysis` for a given token. A morpheme gloss is shared analysis content, so — like
 * {@link useGlossDispatch} — it routes through the global-edit gate: when `confirmGlobalEdits` is on
 * and the payload is shared by more than one token, the write is held for
 * {@link GlobalEditConfirmationModal} rather than silently fanning out; otherwise it commits
 * immediately and triggers `onSave`.
 *
 * @returns A function `(tokenRef, morphemeId, value) => boolean` returning whether the edit was
 *   held for confirmation (`true`) rather than committed, so the morpheme gloss input can revert
 *   its uncommitted draft when the edit is parked in the modal.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useMorphemeGlossDispatch(): (
  tokenRef: string,
  morphemeId: string,
  value: string,
) => boolean {
  const { dispatch, save, callbacks } = useAnalysisSave('useMorphemeGlossDispatch');

  return useCallback(
    (tokenRef: string, morphemeId: string, value: string) => {
      const commit = () => {
        dispatch(writeMorphemeGloss({ tokenRef, morphemeId, value }));
        save();
      };
      return callbacks.gateEdit(tokenRef, commit, () => {
        dispatch(forkAnalysisForToken(tokenRef));
        commit();
      });
    },
    [dispatch, save, callbacks],
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

// #region Segment hooks

/**
 * Returns the approved free-translation string for the given segment in the store's active analysis
 * language, re-rendering only when that segment's free translation changes.
 *
 * @param segmentId - The `Segment.id` whose free translation to read.
 * @returns The current free-translation string, or `''` when absent.
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
 * @returns A function `(segmentId, surfaceText, value) => void`, where `surfaceText` is the
 *   segment's current baseline text, stored on the `SegmentAnalysis` record.
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
