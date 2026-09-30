import { createContext, useContext, type ReactNode } from 'react';
import useConcordanceIndex, {
  type ConcordanceIndex,
  type UseConcordanceIndexArgs,
} from '../hooks/useConcordanceIndex';

/** The concordance's index of the source text. */
export const ConcordanceIndexContext = createContext<ConcordanceIndex | undefined>(undefined);

/** Builds the concordance's index, re-rendering only the components below that read it. */
export function ConcordanceIndexProvider({
  children,
  ...args
}: Readonly<UseConcordanceIndexArgs & { children: ReactNode }>) {
  const index = useConcordanceIndex(args);
  return (
    <ConcordanceIndexContext.Provider value={index}>{children}</ConcordanceIndexContext.Provider>
  );
}

/**
 * Reads the concordance's index.
 *
 * @throws When called outside a {@link ConcordanceIndexProvider}.
 */
export function useConcordanceIndexContext(): ConcordanceIndex {
  const index = useContext(ConcordanceIndexContext);
  if (!index) throw new Error('useConcordanceIndexContext must be used within its provider');
  return index;
}
