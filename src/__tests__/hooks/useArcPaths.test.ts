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

  const originalResizeObserver = global.ResizeObserver;

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    jest.useRealTimers();
  });

  /**
   * Installs a stubbed `ResizeObserver` with a manual rAF queue. The observer callback defers its
   * measurement to the next animation frame, so `pump` drives rAF by hand to flush it.
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

    /**
     * Fires the ResizeObserver callback and flushes the queued rAF, then reports how many
     * measurement passes (`computeAllArcPaths` calls) that observer tick triggered.
     */
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

    act(() => {
      rerender({ enabled: false });
    });
    expect(result.current.stripLeftPadding).toBe(0);
    expect(result.current.stripRightPadding).toBe(0);
  });

  describe('re-measures when the ResizeObserver fires', () => {
    it('triggers computeAllArcPaths after the rAF fires', () => {
      const { pump } = installObserverHarness();
      const containerRef = { current: document.createElement('div') };
      renderHook(() => useArcPaths(containerRef, true, false, []));

      expect(pump()).toBeGreaterThan(0);
    });

    it('stops an oscillating observer-driven re-measure once a signature repeats', () => {
      const { pump } = installObserverHarness();

      // Alternate the measured gutter padding between two values on every call so the layout never
      // reaches a fixed point unless the echo guard drops a repeated signature.
      const arc = { phraseId: 'p1', d: 'M0 0 L10 0', midX: 5, midY: 0, splitAfterTokenRef: 't' };
      let toggle = false;
      computeAllArcPaths.mockImplementation(() => {
        toggle = !toggle;
        return { paths: [arc], maxLevel: 0, leftPadding: toggle ? 8 : 16, rightPadding: 0 };
      });

      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));

      // The key property is termination: the padding settles to one value and stays stable across
      // many further pumps rather than flipping on every one.
      for (let i = 0; i < 4; i += 1) pump();
      const settled = result.current.stripLeftPadding;
      for (let i = 0; i < 20; i += 1) pump();
      expect(result.current.stripLeftPadding).toBe(settled);
    });

    it('applies a split-button shift that moves midX without touching d, level, or padding', () => {
      // A deconfliction pass nudges the split button (midX/midY, run bounds) while the arc path `d`,
      // nesting level, and gutter paddings are unchanged. The apply gate compares serialized layout
      // signatures, so the signature must include the button geometry — otherwise this pass would
      // match the applied signature, be dropped as a redundant fixed point, and the button would
      // stay in its pre-shift position.
      const { pump } = installObserverHarness();
      const before = {
        phraseId: 'p1',
        d: 'M0 0 L10 0',
        midX: 5,
        midY: 0,
        runLeft: 0,
        runRight: 10,
        splitAfterTokenRef: 't',
      };
      computeAllArcPaths.mockReturnValue({
        paths: [before],
        maxLevel: 0,
        leftPadding: 0,
        rightPadding: 0,
      });
      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));
      expect(result.current.arcPaths[0].midX).toBe(5);

      // Only midX drifts; every other field (including `d`) is identical.
      computeAllArcPaths.mockReturnValue({
        paths: [{ ...before, midX: 20 }],
        maxLevel: 0,
        leftPadding: 0,
        rightPadding: 0,
      });
      pump();
      expect(result.current.arcPaths[0].midX).toBe(20);
    });
  });

  describe('settle-aware measurement', () => {
    /** Builds a minimal measurement result whose signature is distinguished by the arc's `d` string. */
    const measurementWithPath = (d: string) => ({
      paths: [
        { phraseId: 'p1', d, midX: 5, midY: 0, runLeft: 0, runRight: 10, splitAfterTokenRef: 't' },
      ],
      maxLevel: 0,
      leftPadding: 0,
      rightPadding: 0,
    });

    it('re-applies a historical signature when the layout recovers after a transient collapse', () => {
      const { pump } = installObserverHarness();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M0 0 L10 0'));
      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));
      expect(result.current.arcPaths).toHaveLength(1);

      // Transient collapse: the phrase momentarily measures as a single box, so no arcs.
      computeAllArcPaths.mockReturnValue({
        paths: [],
        maxLevel: 0,
        leftPadding: 0,
        rightPadding: 0,
      });
      pump();
      expect(result.current.arcPaths).toHaveLength(0);

      // Recovery reproduces the pre-collapse signature — it must be re-applied, not swallowed.
      computeAllArcPaths.mockReturnValue(measurementWithPath('M0 0 L10 0'));
      pump();
      expect(result.current.arcPaths).toHaveLength(1);
    });

    it('freezes after the consecutive flip-back budget so a period-2 oscillation still terminates', () => {
      const { pump } = installObserverHarness();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M A'));
      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));

      // A → B (fresh), B → A (flip 1), A → B (flip 2), B → A (frozen: budget exhausted).
      computeAllArcPaths.mockReturnValue(measurementWithPath('M B'));
      pump();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M A'));
      pump();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M B'));
      pump();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M A'));
      pump();
      expect(result.current.arcPaths[0].d).toBe('M B');
    });

    it('re-measures after a quiet period and applies geometry that drifted without a resize event', () => {
      // A box can reach its final width after the last measurement with nothing the hook observes
      // resizing, so only the settle-verification timer can catch the drift.
      jest.useFakeTimers();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M0 0 L10 0'));
      const containerRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useArcPaths(containerRef, true, false, []));
      expect(result.current.arcPaths[0].d).toBe('M0 0 L10 0');

      // Geometry drifts silently: no observer event, only the verification timer can see it.
      computeAllArcPaths.mockReturnValue(measurementWithPath('M0 0 L20 0'));
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(result.current.arcPaths[0].d).toBe('M0 0 L20 0');
    });

    it('stops verifying once the measurement reaches a stable fixed point', () => {
      jest.useFakeTimers();
      computeAllArcPaths.mockReturnValue(measurementWithPath('M0 0 L10 0'));
      const containerRef = { current: document.createElement('div') };
      renderHook(() => useArcPaths(containerRef, true, false, []));

      // Let the whole verification chain (all rounds) run against stable geometry.
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      const settledCallCount = computeAllArcPaths.mock.calls.length;
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      expect(computeAllArcPaths.mock.calls.length).toBe(settledCallCount);
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
