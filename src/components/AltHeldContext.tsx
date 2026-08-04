import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Carries only whether the Alt key is currently held, so an Alt press re-renders just the split-gap
 * markers that consume it.
 *
 * Defaults to `false`, so consumers outside a provider read "not held".
 */
const AltHeldContext = createContext(false);

/** Props for {@link AltHeldProvider}. */
type AltHeldProviderProps = Readonly<{
  /** Whether the Alt key is currently held. */
  value: boolean;
  /** The subtree whose split-gap markers read the Alt-held state. */
  children: ReactNode;
}>;

/** Provides the current Alt-held state to the split-gap markers beneath it. */
export function AltHeldProvider({ value, children }: AltHeldProviderProps) {
  return <AltHeldContext.Provider value={value}>{children}</AltHeldContext.Provider>;
}

/**
 * Reads whether the Alt key is currently held, falling back to `false` outside a provider so leaf
 * components can be unit-tested without wiring one.
 */
export function useAltHeldValue(): boolean {
  return useContext(AltHeldContext);
}
