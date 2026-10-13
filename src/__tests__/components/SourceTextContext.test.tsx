/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import {
  useConcordanceEntriesContext,
  useSourceTextContext,
} from '../../components/SourceTextContext';

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
