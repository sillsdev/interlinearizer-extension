/** @file External gloss store with per-token subscriptions via `useSyncExternalStore`. */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

/** Shape of the value provided by {@link GlossStoreProvider}. */
type GlossStoreContextValue = {
  /** Registers a listener that fires whenever any gloss changes. Returns an unsubscribe function. */
  subscribe: (onStoreChange: () => void) => () => void;
  /** Returns the current gloss for `tokenId`, or `''` when absent. */
  getGloss: (tokenId: string) => string;
  /** Returns the entire current gloss map. Creates a new object reference on each call. */
  getAllGlosses: () => Record<string, string>;
  /** Writes a gloss value and notifies all subscribers. */
  onGlossChange: (tokenId: string, value: string) => void;
};

const GlossStoreCtx = createContext<GlossStoreContextValue | undefined>(undefined);

/** Props for {@link GlossStoreProvider}. */
type GlossStoreProviderProps = Readonly<{
  children: ReactNode;
  /**
   * Optional initial gloss values. Intended for test seeding only — not reactive; changes after
   * mount are ignored.
   */
  initialGlosses?: Record<string, string>;
  /**
   * Optional spy called after each store write. Intended for test observability only — has no
   * effect on store behaviour.
   */
  onGlossChange?: (tokenId: string, value: string) => void;
}>;

/**
 * Provides an external gloss store to the subtree. Components inside can read per-token gloss
 * values via {@link useGloss} and write them via {@link useGlossDispatch}.
 *
 * @param props - Component props
 * @param props.children - Subtree that should have access to the gloss store
 * @param props.initialGlosses - Seed values for tests; not reactive after mount
 * @param props.onGlossChange - Spy called after each store write; for test observability only
 * @returns A context provider wrapping the subtree
 */
export function GlossStoreProvider({
  children,
  initialGlosses,
  onGlossChange: spy,
}: GlossStoreProviderProps) {
  const glossesRef = useRef<Record<string, string>>(initialGlosses ?? {});
  // Stable snapshot reference for useAllGlosses; only replaced on mutation so useSyncExternalStore
  // can detect changes via reference equality without an infinite-loop.
  const allGlossesSnapshotRef = useRef<Record<string, string>>(glossesRef.current);
  const listenersRef = useRef(new Set<() => void>());

  /**
   * Registers `listener` to be called whenever any gloss changes. Returns an unsubscribe function
   * that removes the listener from the set.
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
   * Returns the current gloss string for `tokenId`, or `''` when no gloss has been set.
   *
   * @param tokenId - The token whose gloss to retrieve.
   * @returns The stored gloss, or `''` when absent.
   */
  const getGloss = useCallback((tokenId: string) => glossesRef.current[tokenId] ?? '', []);

  /**
   * Returns the current gloss snapshot object. The same reference is returned on every call until
   * the next mutation, so `useSyncExternalStore` can detect changes via reference equality.
   *
   * @returns The current gloss map; a new object reference is produced on each mutation.
   */
  const getAllGlosses = useCallback(() => allGlossesSnapshotRef.current, []);

  /**
   * Writes `value` as the gloss for `tokenId`, replaces the snapshot reference, and notifies all
   * subscribers. Also calls the optional `spy` prop for test observability.
   *
   * @param tokenId - The token whose gloss to update.
   * @param value - The new gloss string.
   */
  const onGlossChange = useCallback(
    (tokenId: string, value: string) => {
      glossesRef.current = { ...glossesRef.current, [tokenId]: value };
      allGlossesSnapshotRef.current = glossesRef.current;
      listenersRef.current.forEach((l) => l());
      spy?.(tokenId, value);
    },
    [spy],
  );

  const ctx = useMemo(
    () => ({ subscribe, getGloss, getAllGlosses, onGlossChange }),
    [subscribe, getGloss, getAllGlosses, onGlossChange],
  );

  return <GlossStoreCtx value={ctx}>{children}</GlossStoreCtx>;
}

/**
 * Returns the gloss string for the given token, re-rendering only when that token's gloss changes.
 *
 * @param tokenId - The token whose gloss to read.
 * @returns The current gloss string, or `''` when no gloss has been set.
 * @throws When called outside a {@link GlossStoreProvider}.
 */
export function useGloss(tokenId: string): string {
  const ctx = useContext(GlossStoreCtx);
  if (!ctx) throw new Error('useGloss must be used inside a GlossStoreProvider');

  // Memoize snapshot by tokenId so useSyncExternalStore compares only the one string.
  const getSnapshot = useMemo(() => () => ctx.getGloss(tokenId), [ctx, tokenId]);

  return useSyncExternalStore(ctx.subscribe, getSnapshot);
}

/**
 * Returns the entire gloss map, re-rendering on every gloss change. Intended for components that
 * need all glosses (e.g. `ContinuousView` before it is migrated to per-token subscriptions).
 *
 * @returns A shallow copy of the current gloss record.
 * @throws When called outside a {@link GlossStoreProvider}.
 */
export function useAllGlosses(): Record<string, string> {
  const ctx = useContext(GlossStoreCtx);
  if (!ctx) throw new Error('useAllGlosses must be used inside a GlossStoreProvider');

  return useSyncExternalStore(ctx.subscribe, ctx.getAllGlosses);
}

/**
 * Returns the stable `onGlossChange` callback from the nearest {@link GlossStoreProvider}.
 *
 * @returns A function `(tokenId, value) => void` that writes the gloss and notifies subscribers.
 * @throws When called outside a {@link GlossStoreProvider}.
 */
export function useGlossDispatch(): (tokenId: string, value: string) => void {
  const ctx = useContext(GlossStoreCtx);
  if (!ctx) throw new Error('useGlossDispatch must be used inside a GlossStoreProvider');

  return ctx.onGlossChange;
}
