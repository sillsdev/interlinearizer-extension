/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import useInterlinearizerWebViewState from '../../hooks/useInterlinearizerWebViewState';
import { makeWebViewState } from '../test-helpers';

describe('useInterlinearizerWebViewState', () => {
  it('reads the entry stored under its key', () => {
    const useWebViewState = makeWebViewState({ offerPt9Import: true });

    const { result } = renderHook(() =>
      useInterlinearizerWebViewState(useWebViewState, 'offerPt9Import', false),
    );

    expect(result.current[0]).toBe(true);
  });

  it('answers the default when no entry is stored under its key', () => {
    const useWebViewState = makeWebViewState();

    const { result } = renderHook(() =>
      useInterlinearizerWebViewState(useWebViewState, 'offerPt9Import', false),
    );

    expect(result.current[0]).toBe(false);
  });
});
