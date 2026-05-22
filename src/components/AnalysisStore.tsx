/** @file External analysis store with per-token subscriptions via `useSyncExternalStore`. */
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

/**
 * Shape of the React context value provided by {@link AnalysisStoreProvider}. Consumed by
 * {@link useGloss}, {@link useAnalysis}, and {@link useGlossDispatch}.
 */
type AnalysisStoreContextValue = {
  /** Registers a listener that fires whenever any analysis data changes. Returns an unsubscribe fn. */
  subscribe: (onStoreChange: () => void) => () => void;
  /** Returns the current approved gloss string for `tokenRef` in the active language, or `''`. */
  getGloss: (tokenRef: string) => string;
  /**
   * Returns the entire current `TextAnalysis` snapshot. Same reference is returned until the next
   * mutation so `useSyncExternalStore` detects changes via reference equality.
   */
  getAnalysis: () => TextAnalysis;
  /**
   * Creates a new approved `TokenAnalysis` + `TokenAnalysisLink` for `tokenRef` with the given
   * gloss, notifies subscribers, and calls the `onSave` callback with the updated analysis.
   */
  onGlossChange: (tokenRef: string, surfaceText: string, value: string) => void;
};

const AnalysisStoreCtx = createContext<AnalysisStoreContextValue | undefined>(undefined);

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

/** Empty `TextAnalysis` used as the default when no `initialAnalysis` is provided. */
const EMPTY_ANALYSIS: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

/**
 * Builds a lookup from `tokenRef` to the approved `TokenAnalysis.id` for that token. Only the last
 * approved link per token is indexed (the data model invariant says at most one should be approved;
 * this is a graceful tie-break when that invariant is violated).
 *
 * @param analysis - The `TextAnalysis` to index.
 * @param analysisById - Pre-built map of `TokenAnalysis.id` → `TokenAnalysis`.
 * @returns A map from `tokenRef` → approved `TokenAnalysis.id`.
 */
function buildApprovedGlossIndex(
  analysis: TextAnalysis,
  analysisById: Map<string, TokenAnalysis>,
): Map<string, string> {
  return analysis.tokenAnalysisLinks.reduce((index, link) => {
    if (link.status === 'approved' && analysisById.has(link.analysisId)) {
      index.set(link.token.tokenRef, link.analysisId);
    }
    return index;
  }, new Map<string, string>());
}

/**
 * Provides a `TextAnalysis`-backed store to the subtree. Components inside can read per-token
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
  onGlossChange: spy,
}: AnalysisStoreProviderProps) {
  const analysisRef = useRef<TextAnalysis>(initialAnalysis ?? EMPTY_ANALYSIS);
  const listenersRef = useRef(new Set<() => void>());

  // These two indexes are built lazily via ??= so that passing an initializer expression to useRef
  // (which evaluates on every render but is only used on the first mount) doesn't rebuild large Maps
  // across a full-Bible analysis on every re-render.

  /** Pre-built map of `TokenAnalysis.id` → `TokenAnalysis` for O(1) lookup by id. */
  const analysisByIdRef = useRef<Map<string, TokenAnalysis> | undefined>(undefined);
  analysisByIdRef.current ??= new Map(analysisRef.current.tokenAnalyses.map((ta) => [ta.id, ta]));

  /**
   * Pre-built map of `tokenRef` → approved `TokenAnalysis.id` for the active language. Reset on
   * every mutation that changes the analysis.
   */
  const approvedAnalysisIdByTokenRef = useRef<Map<string, string> | undefined>(undefined);
  approvedAnalysisIdByTokenRef.current ??= buildApprovedGlossIndex(
    analysisRef.current,
    analysisByIdRef.current,
  );

  /**
   * Registers `listener` to be called whenever any analysis data changes. Returns an unsubscribe
   * function that removes the listener from the set.
   *
   * @param listener - Zero-argument callback invoked after every store mutation.
   * @returns An unsubscribe function that, when called, removes the listener.
   */
  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  /**
   * Returns the approved gloss string for `tokenRef` in the active `analysisLanguage`, or `''` when
   * no approved analysis exists for the token.
   *
   * @param tokenRef - The token reference to look up.
   * @returns The approved gloss string, or `''` when absent.
   */
  const getGloss = useCallback(
    (tokenRef: string) => {
      // eslint-disable-next-line no-type-assertion/no-type-assertion -- ??= above guarantees non-null; TS can't see through the closure boundary
      const analysisId = approvedAnalysisIdByTokenRef.current!.get(tokenRef);
      if (!analysisId) return '';
      // eslint-disable-next-line no-type-assertion/no-type-assertion -- same: ??= guarantees non-null
      const ta = analysisByIdRef.current!.get(analysisId);
      /* v8 ignore next -- optional chaining on ta?.gloss produces a branch V8 cannot reach through the mock */
      return ta?.gloss?.[analysisLanguage] ?? '';
    },
    [analysisLanguage],
  );

  /**
   * Returns the current `TextAnalysis` snapshot. The same reference is returned on every call until
   * the next mutation so `useSyncExternalStore` can detect changes via reference equality.
   *
   * @returns The current `TextAnalysis`; a new object reference is produced on each mutation.
   */
  const getAnalysis = useCallback(() => analysisRef.current, []);

  /**
   * Creates a new approved `TokenAnalysis` + `TokenAnalysisLink` for `tokenRef` with the given
   * gloss string (under `analysisLanguage`), replaces the analysis snapshot, notifies subscribers,
   * calls `onSave`, and calls the optional `spy` prop for test observability.
   *
   * The new `TokenAnalysis` gets a UUID (`crypto.randomUUID()`) as its id to ensure global
   * uniqueness. Existing analyses for the token are left untouched — this follows the data model's
   * "multiple competing analyses" design; the UI manages selection and deletion separately.
   *
   * @param tokenRef - The `Token.ref` of the token being glossed.
   * @param surfaceText - The surface text of the token (stored as `Analysis.surfaceText`).
   * @param value - The new gloss string.
   */
  const onGlossChange = useCallback(
    (tokenRef: string, surfaceText: string, value: string) => {
      const id = crypto.randomUUID();
      const newAnalysis: TokenAnalysis = {
        id,
        surfaceText,
        gloss: { [analysisLanguage]: value },
      };
      const newLink: TokenAnalysisLink = {
        analysisId: id,
        status: 'approved',
        token: { tokenRef, surfaceText },
      };

      const next: TextAnalysis = {
        ...analysisRef.current,
        tokenAnalyses: [...analysisRef.current.tokenAnalyses, newAnalysis],
        tokenAnalysisLinks: [...analysisRef.current.tokenAnalysisLinks, newLink],
      };

      analysisRef.current = next;
      // eslint-disable-next-line no-type-assertion/no-type-assertion -- ??= above guarantees non-null; TS can't see through the closure boundary
      analysisByIdRef.current = new Map([...analysisByIdRef.current!, [id, newAnalysis]]);
      approvedAnalysisIdByTokenRef.current = buildApprovedGlossIndex(next, analysisByIdRef.current);

      listenersRef.current.forEach((l) => l());
      onSave?.(next);
      spy?.(tokenRef, value);
    },
    [analysisLanguage, onSave, spy],
  );

  const ctx = useMemo(
    () => ({ subscribe, getGloss, getAnalysis, onGlossChange }),
    [subscribe, getGloss, getAnalysis, onGlossChange],
  );

  return <AnalysisStoreCtx value={ctx}>{children}</AnalysisStoreCtx>;
}

/**
 * Returns the approved gloss string for the given token in the store's active analysis language,
 * re-rendering only when that token's approved analysis changes.
 *
 * @param tokenRef - The token whose gloss to read.
 * @returns The current approved gloss string, or `''` when no approved analysis exists.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGloss(tokenRef: string): string {
  const ctx = useContext(AnalysisStoreCtx);
  if (!ctx) throw new Error('useGloss must be used inside an AnalysisStoreProvider');

  const getSnapshot = useMemo(() => () => ctx.getGloss(tokenRef), [ctx, tokenRef]);

  return useSyncExternalStore(ctx.subscribe, getSnapshot);
}

/**
 * Returns the current `TextAnalysis` snapshot, re-rendering on every analysis change. Intended for
 * components that need the full analysis (e.g. an analysis-selection popup).
 *
 * @returns The current `TextAnalysis` from the nearest {@link AnalysisStoreProvider}.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useAnalysis(): TextAnalysis {
  const ctx = useContext(AnalysisStoreCtx);
  if (!ctx) throw new Error('useAnalysis must be used inside an AnalysisStoreProvider');

  return useSyncExternalStore(ctx.subscribe, ctx.getAnalysis);
}

/**
 * Returns the stable `onGlossChange` callback from the nearest {@link AnalysisStoreProvider}. The
 * callback creates a new approved `TokenAnalysis` for the token on each call.
 *
 * @returns A function `(tokenRef, surfaceText, value) => void`.
 * @throws When called outside an {@link AnalysisStoreProvider}.
 */
export function useGlossDispatch(): (tokenRef: string, surfaceText: string, value: string) => void {
  const ctx = useContext(AnalysisStoreCtx);
  if (!ctx) throw new Error('useGlossDispatch must be used inside an AnalysisStoreProvider');

  return ctx.onGlossChange;
}
