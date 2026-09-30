/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  ConcordanceIndexProvider,
  useConcordanceIndexContext,
} from '../../components/ConcordanceIndexContext';
import useConcordanceIndex, { type ConcordanceIndex } from '../../hooks/useConcordanceIndex';
import { GEN_1_1_BOOK } from '../test-helpers';

// Reading books is the hook's own concern; the provider only hands on whatever it builds.
jest.mock('../../hooks/useConcordanceIndex');

const INDEX: ConcordanceIndex = {
  status: 'ready',
  booksRead: 1,
  bookCount: 1,
  entries: [],
  refresh: () => {},
};

describe('ConcordanceIndexProvider', () => {
  it('builds the index from its props and hands it to what it wraps', () => {
    jest.mocked(useConcordanceIndex).mockReturnValue(INDEX);
    const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
      <ConcordanceIndexProvider
        enabled
        liveBook={GEN_1_1_BOOK}
        projectId="src"
        shown
        writingSystem="en"
      >
        {children}
      </ConcordanceIndexProvider>
    );

    const { result } = renderHook(() => useConcordanceIndexContext(), { wrapper });

    expect(result.current).toBe(INDEX);
    expect(useConcordanceIndex).toHaveBeenCalledWith({
      enabled: true,
      liveBook: GEN_1_1_BOOK,
      projectId: 'src',
      shown: true,
      writingSystem: 'en',
    });
  });
});

describe('useConcordanceIndexContext', () => {
  it('throws outside a provider', () => {
    // React logs the render error before rethrowing it; silenced so the expected throw is quiet.
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useConcordanceIndexContext())).toThrow(
      'useConcordanceIndexContext must be used within its provider',
    );
  });
});
