/** @file Unit tests for the usePhraseHoverState hook. */
/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { usePhraseHoverState } from '../../hooks/usePhraseHoverState';

describe('usePhraseHoverState', () => {
  it('starts with empty previews and no hovered group', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    expect(result.current.hoveredGroupKey).toBeUndefined();
    expect(result.current.candidateTokenRefs).toEqual(new Set());
    expect(result.current.splitFreeTokenRefs).toEqual(new Set());
  });

  it('stores the hovered group key', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.setHoveredGroupKey('grp-1'));

    expect(result.current.hoveredGroupKey).toBe('grp-1');
  });

  it('populates candidate token refs from an array', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.setCandidateTokenRefs(['tok-0', 'tok-1']));

    expect(result.current.candidateTokenRefs).toEqual(new Set(['tok-0', 'tok-1']));
  });

  it('clears candidate token refs when passed undefined', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.setCandidateTokenRefs(['tok-0']));
    act(() => result.current.setCandidateTokenRefs(undefined));

    expect(result.current.candidateTokenRefs).toEqual(new Set());
  });

  it('mirrors the split-hover free token set from ArcOverlay', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.handleSplitHoverChange(new Set(['tok-2'])));

    expect(result.current.splitFreeTokenRefs).toEqual(new Set(['tok-2']));
  });

  it('populates would-be-free token refs from an array', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.handleHoverSplitFreeTokens(['tok-3', 'tok-4']));

    expect(result.current.splitFreeTokenRefs).toEqual(new Set(['tok-3', 'tok-4']));
  });

  it('clears would-be-free token refs when passed undefined', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => result.current.handleHoverSplitFreeTokens(['tok-3']));
    act(() => result.current.handleHoverSplitFreeTokens(undefined));

    expect(result.current.splitFreeTokenRefs).toEqual(new Set());
  });

  it('clears every preview at once', () => {
    const { result } = renderHook(() => usePhraseHoverState());

    act(() => {
      result.current.setHoveredGroupKey('grp-1');
      result.current.setCandidateTokenRefs(['tok-0']);
      result.current.handleHoverSplitFreeTokens(['tok-3']);
    });
    act(() => result.current.clearAll());

    expect(result.current.hoveredGroupKey).toBeUndefined();
    expect(result.current.candidateTokenRefs).toEqual(new Set());
    expect(result.current.splitFreeTokenRefs).toEqual(new Set());
  });
});
