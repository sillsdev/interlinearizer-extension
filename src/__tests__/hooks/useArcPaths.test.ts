/** @file Unit tests for hooks/useArcPaths.ts. */
/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useArcPaths } from '../../hooks/useArcPaths';

// computeAllArcPaths reads DOM measurements; mock it to control output.
jest.mock('../../utils/phrase-arc', () => ({
  computeAllArcPaths: jest.fn(() => ({
    paths: [],
    maxLevel: 0,
    leftPadding: 0,
    rightPadding: 0,
  })),
  computeStripTopPadding: jest.fn(() => 8),
  computeStripRowGap: jest.fn(() => 24),
}));

const arcPathsMock: {
  computeAllArcPaths: jest.Mock;
  computeStripTopPadding: jest.Mock;
  computeStripRowGap: jest.Mock;
} = jest.requireMock('../../utils/phrase-arc');
const { computeAllArcPaths, computeStripTopPadding, computeStripRowGap } = arcPathsMock;

describe('useArcPaths', () => {
  beforeEach(() => {
    computeAllArcPaths.mockReturnValue({
      paths: [],
      maxLevel: 0,
      leftPadding: 0,
      rightPadding: 0,
    });
    computeStripTopPadding.mockReturnValue(8);
    computeStripRowGap.mockReturnValue(24);
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
      leftPadding: 0,
      rightPadding: 0,
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
      leftPadding: 0,
      rightPadding: 0,
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
      leftPadding: 0,
      rightPadding: 0,
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
      leftPadding: 0,
      rightPadding: 0,
    });
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.maxArcLevel).toBe(0);
  });

  it('updates maxArcLevel when it changes between measurements', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      leftPadding: 0,
      rightPadding: 0,
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
      leftPadding: 0,
      rightPadding: 0,
    });
    act(() => {
      rerender({ dep: 2 });
    });
    expect(result.current.maxArcLevel).toBe(1);
  });

  it('updates stripLeftPadding and stripRightPadding when they change between measurements', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      leftPadding: 0,
      rightPadding: 0,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => useArcPaths(containerRef, true, false, [dep]),
      { initialProps: { dep: 1 } },
    );
    expect(result.current.stripLeftPadding).toBe(0);
    expect(result.current.stripRightPadding).toBe(0);

    // A later measurement reserves gutter padding on both sides.
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      leftPadding: 8,
      rightPadding: 16,
    });
    act(() => {
      rerender({ dep: 2 });
    });
    expect(result.current.stripLeftPadding).toBe(8);
    expect(result.current.stripRightPadding).toBe(16);
  });

  it('resets stripLeftPadding and stripRightPadding to 0 when transitioning to disabled', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      leftPadding: 8,
      rightPadding: 16,
    });
    const containerRef = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ enabled }) => useArcPaths(containerRef, enabled, false, []),
      { initialProps: { enabled: true } },
    );
    expect(result.current.stripLeftPadding).toBe(8);
    expect(result.current.stripRightPadding).toBe(16);

    // Transition to disabled — both paddings must reset to 0.
    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.stripLeftPadding).toBe(0);
    expect(result.current.stripRightPadding).toBe(0);
  });

  describe('re-measures when the ResizeObserver fires', () => {
    // The observer callback defers its measurement to the next animation frame to avoid a
    // synchronous setState-in-observer loop, so drive rAF manually to flush it.
    const originalResizeObserver = global.ResizeObserver;

    afterEach(() => {
      global.ResizeObserver = originalResizeObserver;
    });

    /**
     * Installs a stubbed `ResizeObserver` that records its callback and a manual rAF queue, then
     * returns helpers to fire one observer notification and flush its deferred measurement. Shared
     * by both tests so only a single mock class is defined in this file.
     *
     * @returns `pump`, which fires the observer + flushes the rAF and returns the number of
     *   `computeAllArcPaths` calls it triggered.
     */
    const installObserverHarness = (): { pump: () => number } => {
      const rafCallbacks: FrameRequestCallback[] = [];
      jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
      jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

      let observerCallback: ResizeObserverCallback | undefined;
      const stubObserver: ResizeObserver = {
        observe() {},
        unobserve() {},
        disconnect() {},
      };
      global.ResizeObserver = class implements ResizeObserver {
        /** @param callback - Stored so the test can fire it on demand. */
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

      const pump = (): number => {
        const before = computeAllArcPaths.mock.calls.length;
        act(() => {
          observerCallback?.([], stubObserver);
          const pending = rafCallbacks.splice(0);
          pending.forEach((cb) => cb(0));
        });
        return computeAllArcPaths.mock.calls.length - before;
      };

      return { pump };
    };

    it('triggers computeAllArcPaths after the rAF fires', () => {
      const { pump } = installObserverHarness();
      const containerRef = { current: document.createElement('div') };
      renderHook(() => useArcPaths(containerRef, true, false, []));

      expect(pump()).toBeGreaterThan(0);
    });

    it('stops an oscillating observer-driven re-measure once a signature repeats', () => {
      // Reproduces the cross-row gutter feedback loop: applying the hook's padding re-wraps the
      // strip, which the ResizeObserver reports, which re-measures to a *different* padding, which
      // re-wraps again, … Without the echo guard every observer pass commits new state and the
      // WebView freezes. With the guard, a re-measure whose signature matches one of the last two
      // passes is dropped, so a period-2 oscillation terminates after a bounded number of passes.
      const { pump } = installObserverHarness();

      // Alternate the measured gutter padding between two values on every call so, left unchecked,
      // the layout never reaches a fixed point.
      const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
      let toggle = false;
      computeAllArcPaths.mockImplementation(() => {
        toggle = !toggle;
        return { paths: [arc], maxLevel: 0, leftPadding: toggle ? 8 : 16, rightPadding: 0 };
      });

      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));

      // Because the guard drops the repeated signature instead of committing fresh padding, the
      // strip's padding settles to one of the two values and then never changes again, even though
      // the mocked measurement keeps alternating. The key property is termination: the value is
      // stable across many further pumps rather than flipping on every one.
      for (let i = 0; i < 4; i += 1) pump();
      const settled = result.current.stripLeftPadding;
      for (let i = 0; i < 20; i += 1) pump();
      expect(result.current.stripLeftPadding).toBe(settled);
    });
  });

  it('does not update state when arc paths have not changed', () => {
    const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
    computeAllArcPaths.mockReturnValue({
      paths: [arc],
      maxLevel: 0,
      leftPadding: 0,
      rightPadding: 0,
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
