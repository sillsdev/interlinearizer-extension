import { createContext, useContext, type ReactNode } from 'react';
import useConcordanceEntries from '../hooks/useConcordanceEntries';
import useSourceTextReader, {
  type SourceText,
  type UseSourceTextReaderArgs,
} from '../hooks/useSourceTextReader';
import type { ConcordanceEntry } from '../utils/concordance';

/** The source project's whole text, as read so far. */
export const SourceTextContext = createContext<SourceText | undefined>(undefined);

/** The concordance's entries across the source text. */
export const ConcordanceEntriesContext = createContext<readonly ConcordanceEntry[] | undefined>(
  undefined,
);

/**
 * Reads the source text and builds the concordance's entries from it, re-rendering only the
 * components below that read either.
 */
export function SourceTextProvider({
  children,
  shown,
  ...args
}: Readonly<
  UseSourceTextReaderArgs & {
    /** Whether the concordance is on screen; its entries take in live-book edits only while it is. */
    shown: boolean;
    children: ReactNode;
  }
>) {
  const text = useSourceTextReader(args);
  const entries = useConcordanceEntries({ text, shown, writingSystem: args.writingSystem });
  return (
    <SourceTextContext.Provider value={text}>
      <ConcordanceEntriesContext.Provider value={entries}>
        {children}
      </ConcordanceEntriesContext.Provider>
    </SourceTextContext.Provider>
  );
}

/**
 * Reads the source text.
 *
 * @throws When called outside a {@link SourceTextProvider}.
 */
export function useSourceTextContext(): SourceText {
  const text = useContext(SourceTextContext);
  if (!text) throw new Error('useSourceTextContext must be used within its provider');
  return text;
}

/**
 * Reads the concordance's entries.
 *
 * @throws When called outside a {@link SourceTextProvider}.
 */
export function useConcordanceEntriesContext(): readonly ConcordanceEntry[] {
  const entries = useContext(ConcordanceEntriesContext);
  if (!entries) throw new Error('useConcordanceEntriesContext must be used within its provider');
  return entries;
}
