/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  SourceTextProvider,
  useConcordanceEntriesContext,
  useSourceTextContext,
} from '../../components/SourceTextContext';
import useConcordanceEntries from '../../hooks/useConcordanceEntries';
import useSourceTextReader, { type SourceText } from '../../hooks/useSourceTextReader';
import type { ConcordanceEntry } from '../../utils/concordance';
import { GEN_1_1_BOOK } from '../test-helpers';

// Reading books and building entries are the hooks' own concerns; the provider only hands on what
// they build.
jest.mock('../../hooks/useConcordanceEntries');
jest.mock('../../hooks/useSourceTextReader');

const TEXT: SourceText = {
  status: 'ready',
  booksRead: 1,
  bookCount: 1,
  readings: new Map(),
  liveVersions: new Map(),
  isPartial: false,
  textForms: undefined,
  refresh: () => {},
  request: () => {},
};

const ENTRIES: readonly ConcordanceEntry[] = [];

/** Wraps a hook in a provider with GEN 1:1 live and the concordance shown. */
function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SourceTextProvider enabled liveBook={GEN_1_1_BOOK} projectId="src" shown writingSystem="en">
      {children}
    </SourceTextProvider>
  );
}

beforeEach(() => {
  jest.mocked(useSourceTextReader).mockReturnValue(TEXT);
  jest.mocked(useConcordanceEntries).mockReturnValue(ENTRIES);
});

describe('SourceTextProvider', () => {
  it('reads the text from its props and hands it to what it wraps', () => {
    const { result } = renderHook(() => useSourceTextContext(), { wrapper });

    expect(result.current).toBe(TEXT);
    expect(useSourceTextReader).toHaveBeenCalledWith({
      enabled: true,
      liveBook: GEN_1_1_BOOK,
      projectId: 'src',
      writingSystem: 'en',
    });
  });

  it('builds the entries from the text it read and hands them to what it wraps', () => {
    const { result } = renderHook(() => useConcordanceEntriesContext(), { wrapper });

    expect(result.current).toBe(ENTRIES);
    expect(useConcordanceEntries).toHaveBeenCalledWith({
      text: TEXT,
      shown: true,
      writingSystem: 'en',
    });
  });
});

describe('useSourceTextContext', () => {
  it('throws outside a provider', () => {
    // React logs the render error before rethrowing it; silenced so the expected throw is quiet.
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useSourceTextContext())).toThrow(
      'useSourceTextContext must be used within its provider',
    );
  });
});

describe('useConcordanceEntriesContext', () => {
  it('throws outside a provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useConcordanceEntriesContext())).toThrow(
      'useConcordanceEntriesContext must be used within its provider',
    );
  });
});
