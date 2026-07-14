/**
 * @file Dedicated context carrying only whether the Alt key is currently held, consumed by the
 *   split-gap markers so an Alt press re-renders just those markers.
 *
 *   Kept separate from the memoized `SegmentationContext`: a frequently-flipping boolean folded into
 *   that context would defeat its memoization for every consumer, so the churn is isolated here.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** The Alt-held context. Defaults to `false` so consumers outside a provider read "not held". */
const AltHeldContext = createContext(false);

/** Props for {@link AltHeldProvider}. */
type AltHeldProviderProps = Readonly<{
  /** Whether the Alt key is currently held. */
  value: boolean;
  /** The subtree whose split-gap markers read the Alt-held state. */
  children: ReactNode;
}>;

/**
 * Provides the current Alt-held state to the split-gap markers beneath it.
 *
 * @param props - Component props.
 * @param props.value - Whether the Alt key is currently held.
 * @param props.children - The subtree.
 * @returns The children wrapped in the context provider.
 */
export function AltHeldProvider({ value, children }: AltHeldProviderProps) {
  return <AltHeldContext.Provider value={value}>{children}</AltHeldContext.Provider>;
}

/**
 * Reads whether the Alt key is currently held, falling back to `false` outside a provider so leaf
 * components can be unit-tested without wiring one.
 *
 * @returns `true` while Alt is held, `false` otherwise.
 */
export function useAltHeldValue(): boolean {
  return useContext(AltHeldContext);
}
