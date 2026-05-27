/** @file Analysis store backed by Redux Toolkit with per-token subscriptions via `useSelector`. */
import type { TextAnalysis } from 'interlinearizer';
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Provider as ReduxProvider, useDispatch, useSelector, useStore } from 'react-redux';
import {
  defaultAnalysis,
  selectAnalysis,
  selectApprovedGloss,
  writeGloss,
} from '../store/analysisSlice';
import { createAnalysisStore, type AnalysisDispatch, type AnalysisRootState } from '../store';

// ---------------------------------------------------------------------------
// Internal callback context — holds refs so useGlossDispatch stays stable
// ---------------------------------------------------------------------------

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
};

/** Internal context that carries callback refs alongside the Redux {@link ReduxProvider}. */
const AnalysisCallbackCtx = createContext<CallbackRefs | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

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
   * effect on store behaviour.
   */
  onGlossChange?: (tokenRef: string, value: string) => void;
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
 * @returns A context provider wrapping the subtree
 */
export function AnalysisStoreProvider({
  children,
  initialAnalysis,
  analysisLanguage,
  onSave,
  onGlossChange,
}: AnalysisStoreProviderProps) {
  const store = useRef(
    createAnalysisStore({
      analysis: { analysis: initialAnalysis ?? defaultAnalysis, analysisLanguage },
    }),
  ).current;

  // Use refs so the dispatch callback never needs to re-create when parent re-renders
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onGlossChangeRef = useRef(onGlossChange);
  onGlossChangeRef.current = onGlossChange;

  const callbackRefs = useMemo(() => ({ onSaveRef, onGlossChangeRef }), []);

  return (
    <ReduxProvider store={store}>
      <AnalysisCallbackCtx.Provider value={callbackRefs}>{children}</AnalysisCallbackCtx.Provider>
    </ReduxProvider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns the approved gloss string for the given token in the store's active analysis language,
 * re-rendering only when that token's approved analysis changes.
 *
 * @param tokenRef - The token whose gloss to read.
 * @returns The current approved gloss string, or `''` when no approved analysis exists.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGloss(tokenRef: string): string {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error('useGloss must be used inside an AnalysisStoreProvider');

  return useSelector((state: AnalysisRootState) => selectApprovedGloss(state.analysis, tokenRef));
}

/**
 * Returns the current `TextAnalysis` snapshot, re-rendering on every analysis change. Intended for
 * components that need the full analysis (e.g. an analysis-selection popup).
 *
 * @returns The current `TextAnalysis` from the nearest {@link AnalysisStoreProvider}.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysis(): TextAnalysis {
  const ctx = useContext(AnalysisCallbackCtx);
  if (!ctx) throw new Error('useAnalysis must be used inside an AnalysisStoreProvider');

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
  const callbacks = useContext(AnalysisCallbackCtx);
  if (!callbacks) throw new Error('useGlossDispatch must be used inside an AnalysisStoreProvider');

  const dispatch = useDispatch<AnalysisDispatch>();
  const store = useStore<AnalysisRootState>();

  return useCallback(
    (tokenRef: string, surfaceText: string, value: string) => {
      dispatch(writeGloss(tokenRef, surfaceText, value));
      const { analysis } = store.getState().analysis;
      callbacks.onSaveRef.current?.(analysis);
      callbacks.onGlossChangeRef.current?.(tokenRef, value);
    },
    [dispatch, store, callbacks],
  );
}
