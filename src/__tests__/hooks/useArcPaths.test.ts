/** @file Unit tests for hooks/useArcPaths.ts. */
/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useArcPaths } from '../../hooks/useArcPaths';

// computeAllArcPaths reads DOM measurements; mock it to control output.
jest.mock('../../utils/phrase-arc', () => ({
  computeAllArcPaths: jest.fn(() => ({
    paths: [],
    maxLevel: 0,
    requiredRowGapPx: 0,
  })),
  computeStripTopPadding: jest.fn(() => 8),
}));

const arcPathsMock: { computeAllArcPaths: jest.Mock; computeStripTopPadding: jest.Mock } =
  jest.requireMock('../../utils/phrase-arc');
const { computeAllArcPaths, computeStripTopPadding } = arcPathsMock;

describe('useArcPaths', () => {
  beforeEach(() => {
    computeAllArcPaths.mockReturnValue({
      paths: [],
      maxLevel: 0,
      requiredRowGapPx: 0,
    });
    computeStripTopPadding.mockReturnValue(8);
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
      maxLevel: 0,
      requiredRowGapPx: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.arcPaths).toHaveLength(1);

    // Transition to disabled
    computeAllArcPaths.mockReturnValue({
      paths: [],
      maxLevel: 0,
      requiredRowGapPx: 0,
    });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.arcPaths).toHaveLength(0);
  });

  it('resets maxArcLevel from a non-zero value to 0 when transitioning to disabled', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 1,
      requiredRowGapPx: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.maxArcLevel).toBe(1);

    // Transition to disabled — maxArcLevel must reset to 0.
    computeAllArcPaths.mockReturnValue({
      paths: [],
      maxLevel: 0,
      requiredRowGapPx: 0,
    });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.maxArcLevel).toBe(0);
  });

  it('resets requiredRowGapPx to 0 when transitioning to disabled', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      requiredRowGapPx: 20,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.requiredRowGapPx).toBe(20);

    computeAllArcPaths.mockReturnValue({
      paths: [],
      maxLevel: 0,
      requiredRowGapPx: 0,
    });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.requiredRowGapPx).toBe(0);
  });

  it('updates maxArcLevel when it changes between measurements', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      requiredRowGapPx: 0,
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
      maxLevel: 1,
      requiredRowGapPx: 0,
    });
    act(() => {
      rerender({ dep: 2 });
    });
    expect(result.current.maxArcLevel).toBe(1);
  });

  it('re-measures when the ResizeObserver fires', () => {
    let observerCallback: ResizeObserverCallback | undefined;
    global.ResizeObserver = class implements ResizeObserver {
      /** @param callback - Stored so tests can fire it on demand. */
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback;
      }

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      observe() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      unobserve() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      disconnect() {}
    };
    const containerEl = document.createElement('div');
    const containerRef = { current: containerEl };
    renderHook(() => useArcPaths(containerRef, true, false, []));
    const callsBefore = computeAllArcPaths.mock.calls.length;

    act(() => {
      observerCallback?.([], new ResizeObserver(() => {}));
    });

    expect(computeAllArcPaths.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not update state when arc paths have not changed', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      requiredRowGapPx: 0,
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
