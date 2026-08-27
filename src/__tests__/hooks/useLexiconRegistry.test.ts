/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import useLexiconRegistry from '../../hooks/useLexiconRegistry';

describe('useLexiconRegistry', () => {
  it('offers no lexicon affordance while no lexicon is registered', () => {
    const { result } = renderHook(() => useLexiconRegistry());

    expect(result.current.can('search')).toBe(false);
  });

  it('treats every ref as foreign while no lexicon is registered', () => {
    const { result } = renderHook(() => useLexiconRegistry());

    expect(result.current.isForeign({ authority: 'some-lexicon' })).toBe(true);
  });

  it('resolves no sense while no lexicon is registered', async () => {
    const { result } = renderHook(() => useLexiconRegistry());

    await expect(
      result.current.resolveSense({ authority: 'some-lexicon', senseId: 's-1' }),
    ).resolves.toBeUndefined();
  });

  it('hands back one registry, so a consumer can hold on to it', () => {
    const { result, rerender } = renderHook(() => useLexiconRegistry());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});
