/** @file Unit tests for hooks/useArcPaths.ts. */
/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useArcPaths } from '../../hooks/useArcPaths';

// computeAllArcPaths reads DOM measurements; mock it to control output.
jest.mock('../../utils/phrase-arc', () => ({
  computeAllArcPaths: jest.fn(() => ({ paths: [], levelByPhraseId: new Map(), maxLevel: 0 })),
  computeStripTopPadding: jest.fn(() => 8),
}));

const arcPathsMock: { computeAllArcPaths: jest.Mock } = jest.requireMock('../../utils/phrase-arc');
const { computeAllArcPaths } = arcPathsMock;

describe('useArcPaths', () => {
  beforeEach(() => {
    computeAllArcPaths.mockReturnValue({ paths: [], levelByPhraseId: new Map(), maxLevel: 0 });
  });

  it('returns empty results when enabled is false', () => {
    const containerRef = { current: document.createElement('div') };
    const { result } = renderHook(() => useArcPaths(containerRef, false, false, []));
    expect(result.current.arcPaths).toHaveLength(0);
    expect(result.current.maxArcLevel).toBe(0);
  });

  it('returns empty results when enabled is true but containerRef.current is null', () => {
    // eslint-disable-next-line no-null/no-null
    const containerRef = { current: null };
    const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));
    expect(result.current.arcPaths).toHaveLength(0);
  });

  it('calls computeAllArcPaths when enabled and containerRef is set', () => {
    const containerEl = document.createElement('div');
    const containerRef = { current: containerEl };
    renderHook(() => useArcPaths(containerRef, true, false, []));
    expect(computeAllArcPaths).toHaveBeenCalledWith(containerEl);
  });

  it('resets to empty when transitioning from enabled to disabled', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      levelByPhraseId: new Map([['p1', 0]]),
      maxLevel: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.arcPaths).toHaveLength(1);

    // Transition to disabled
    computeAllArcPaths.mockReturnValue({ paths: [], levelByPhraseId: new Map(), maxLevel: 0 });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.arcPaths).toHaveLength(0);
  });

  it('resets maxArcLevel from a non-zero value to 0 when transitioning to disabled', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      levelByPhraseId: new Map([['p1', 1]]),
      maxLevel: 1,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.maxArcLevel).toBe(1);

    // Transition to disabled — maxArcLevel must reset to 0.
    computeAllArcPaths.mockReturnValue({ paths: [], levelByPhraseId: new Map(), maxLevel: 0 });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.maxArcLevel).toBe(0);
  });

  it('updates maxArcLevel when it changes between measurements', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      levelByPhraseId: new Map([['p1', 0]]),
      maxLevel: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => useArcPaths(containerRef, true, false, [dep]),
      { initialProps: { dep: 1 } },
    );
    expect(result.current.maxArcLevel).toBe(0);

    // Second measurement produces a different maxLevel.
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      levelByPhraseId: new Map([['p1', 1]]),
      maxLevel: 1,
    });
    act(() => {
      rerender({ dep: 2 });
    });
    expect(result.current.maxArcLevel).toBe(1);
  });

  it('does not update state when arc paths have not changed', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      levelByPhraseId: new Map([['p1', 0]]),
      maxLevel: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => useArcPaths(containerRef, true, false, [dep]),
      { initialProps: { dep: 1 } },
    );
    const firstPaths = result.current.arcPaths;

    act(() => {
      rerender({ dep: 2 });
    });
    // Same d value → identity preserved (no new array reference)
    expect(result.current.arcPaths).toBe(firstPaths);
  });
});
