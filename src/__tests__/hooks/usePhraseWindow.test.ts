import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import usePhraseWindow, {
  EXTEND_CHUNK,
  HARD_WINDOW_CAP,
  INITIAL_WINDOW_HALF,
} from '../../hooks/usePhraseWindow';

/**
 * The intersection-observer Jest stub records instances on the global object and exposes a helper
 * to fire intersections. Declare the shapes here so the test reads them without type assertions.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var triggerIntersection: (el: Element, isIntersecting: boolean) => void;
  // eslint-disable-next-line no-var, vars-on-top
  var ioInstances: {
    targets: Set<Element>;
    callback: (entries: { target: Element; isIntersecting: boolean }[]) => void;
  }[];
}

/**
 * Delivers both sentinels to the observer in a single callback invocation, as one happens to when
 * both lie inside the arming margin at once. The shared stub's per-element trigger lets a render
 * settle between the two, so it cannot reproduce a same-delivery pair.
 */
function triggerBothSentinels(leading: Element, trailing: Element): void {
  global.ioInstances.forEach((instance) => {
    if (!instance.targets.has(leading) || !instance.targets.has(trailing)) return;
    instance.callback([
      { target: leading, isIntersecting: true },
      { target: trailing, isIntersecting: true },
    ]);
  });
}

/**
 * Renders {@link usePhraseWindow} against a real, attached viewport element so sentinel ref
 * callbacks register with the stubbed observer and geometry stubs are readable.
 */
function renderPhraseWindow(total: number, focusIndex: number) {
  const viewport = document.createElement('div');
  document.body.appendChild(viewport);
  const hook = renderHook<
    ReturnType<typeof usePhraseWindow>,
    { total: number; focusIndex: number }
  >(
    ({ total: t, focusIndex: f }) => {
      const viewportRef = useRef<HTMLElement | undefined>(viewport);
      return usePhraseWindow({ total: t, focusIndex: f, viewportRef });
    },
    { initialProps: { total, focusIndex } },
  );
  return { ...hook, viewport };
}

/**
 * Stubs `getBoundingClientRect` on an element to report fixed inline edges, so the window hook's
 * cull walk is deterministic in jsdom, which performs no layout.
 */
function stubRect(el: Element, left: number, right: number = left): void {
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left,
    right,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

/**
 * Mounts one stub phrase-group wrapper per given left edge, carrying the attribute the window hook
 * enumerates mounted groups by. Each is one hundred pixels wide.
 */
function mountGroupEls(viewport: HTMLElement, lefts: readonly number[]): HTMLElement[] {
  return lefts.map((left) => {
    const el = document.createElement('span');
    el.setAttribute('data-phrase-group', 'true');
    viewport.appendChild(el);
    stubRect(el, left, left + 100);
    return el;
  });
}

/**
 * Attaches the window's sentinel elements to `viewport` so the stubbed observer has real targets to
 * fire intersections against.
 */
function mountSentinels(
  viewport: HTMLElement,
  result: ReturnType<typeof usePhraseWindow>,
): { leading: HTMLElement; trailing: HTMLElement } {
  const leading = document.createElement('div');
  const trailing = document.createElement('div');
  viewport.appendChild(leading);
  viewport.appendChild(trailing);
  act(() => {
    result.leadingSentinelRef(leading);
    result.trailingSentinelRef(trailing);
  });
  return { leading, trailing };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.dir = '';
});

describe('usePhraseWindow', () => {
  it('mounts a window centered on the focused phrase', () => {
    const { result } = renderPhraseWindow(200, 100);

    expect(result.current.range).toEqual({
      start: 100 - INITIAL_WINDOW_HALF,
      end: 100 + INITIAL_WINDOW_HALF + 1,
    });
  });

  it('clamps the window at the start of the book', () => {
    const { result } = renderPhraseWindow(200, 0);

    expect(result.current.range.start).toBe(0);
  });

  it('clamps the window at the end of the book', () => {
    const { result } = renderPhraseWindow(20, 19);

    expect(result.current.range.end).toBe(20);
  });

  it('extends the window end when the trailing sentinel comes into view', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const before = result.current.range.end;
    const { trailing } = mountSentinels(viewport, result.current);

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.end).toBeGreaterThan(before);
  });

  it('extends the window start when the leading sentinel comes into view', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const before = result.current.range.start;
    const { leading } = mountSentinels(viewport, result.current);

    act(() => {
      global.triggerIntersection(leading, true);
    });

    expect(result.current.range.start).toBeLessThan(before);
  });

  it('leaves the window alone when a sentinel leaves the viewport', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const before = result.current.range;
    const { trailing } = mountSentinels(viewport, result.current);

    act(() => {
      global.triggerIntersection(trailing, false);
    });

    expect(result.current.range).toBe(before);
  });

  it('takes no step past the end of the book', () => {
    const { result, viewport } = renderPhraseWindow(20, 19);
    const { trailing } = mountSentinels(viewport, result.current);

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.end).toBe(20);
  });

  it('culls groups left far behind the viewport when the window extends forward', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const startBefore = result.current.range.start;
    const { trailing } = mountSentinels(viewport, result.current);
    // Two groups sit far enough behind the viewport's leading edge to be beyond the retention
    // margin; the rest stay inside it, so the cullable run is exactly those two.
    stubRect(viewport, 0, 1000);
    mountGroupEls(viewport, [-5000, -4000, 500, 600, 700]);

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.start).toBe(startBefore + 2);
  });

  it('culls groups left far ahead of the viewport when the window extends backward', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const endBefore = result.current.range.end;
    const { leading } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    mountGroupEls(viewport, [100, 200, 8000, 9000]);

    act(() => {
      global.triggerIntersection(leading, true);
    });

    expect(result.current.range.end).toBe(endBefore - 2);
  });

  it('keeps every group still within the retention margin', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const startBefore = result.current.range.start;
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    mountGroupEls(viewport, [100, 200, 300]);

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.start).toBe(startBefore);
  });

  it('rebuilds the window around the focus when it has been scrolled away from', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    // Every mounted group sits far behind the viewport, as it would once the strip has been
    // scrolled well past them, so each extend culls the whole run from the leading edge.
    mountGroupEls(
      viewport,
      Array.from({ length: 17 }, (_, i) => -20000 + i * 100),
    );

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.start).toBeGreaterThan(100);

    act(() => {
      result.current.recenterOnFocus();
    });

    expect(result.current.range).toEqual({
      start: 100 - INITIAL_WINDOW_HALF,
      end: 100 + INITIAL_WINDOW_HALF + 1,
    });
  });

  it('keeps a group mounted when a widened strip culls forward past the whole window', () => {
    // Far more groups are mounted than the window spans, all of them far enough behind the viewport
    // to read as cullable, as they are when the rendered bounds are widened past the window.
    const { result, viewport } = renderPhraseWindow(200, 100);
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    mountGroupEls(
      viewport,
      Array.from({ length: 60 }, (_, i) => -20000 + i * 100),
    );

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.end).toBeGreaterThan(result.current.range.start);
  });

  it('keeps a group mounted when a widened strip culls backward past the whole window', () => {
    const { result, viewport } = renderPhraseWindow(200, 100);
    const { leading } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    mountGroupEls(
      viewport,
      Array.from({ length: 60 }, (_, i) => 20000 + i * 100),
    );

    act(() => {
      global.triggerIntersection(leading, true);
    });

    expect(result.current.range.end).toBeGreaterThan(result.current.range.start);
  });

  it('mounts no more groups once the window has reached its cap', () => {
    // A degenerate layout can leave nothing cullable however far the strip is scrolled; the cap is
    // what stops the window mounting the whole book in that case.
    const { result, viewport } = renderPhraseWindow(5000, 100);
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    // Every group reads as inside the viewport, so the cull walk always finds nothing to drop.
    mountGroupEls(viewport, [100, 200, 300]);

    // One commit per extend: the extend reads the committed range, so firing them all in a single
    // act would have every one of them compute from the same stale bounds.
    for (let i = 0; i < HARD_WINDOW_CAP; i += 1) {
      act(() => {
        global.triggerIntersection(trailing, true);
      });
    }

    expect(result.current.range.end - result.current.range.start).toBe(HARD_WINDOW_CAP);
  });

  it('holds the visible content still when groups mount ahead of it', () => {
    // Prepending groups pushes everything after them along by their combined width. Uncorrected,
    // that shifts what the reader is looking at — and the shift brings the sentinel back into view,
    // which mounts more groups, which shifts it again.
    const { result, viewport } = renderPhraseWindow(200, 100);
    const { leading } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    viewport.scrollLeft = 500;
    const [anchor] = mountGroupEls(viewport, [200]);
    // Reads its pre-extend offset while the extend measures, and its displaced one once the mounted
    // groups have pushed it along — the shift the correction exists to undo.
    let displaced = false;
    Object.defineProperty(anchor, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = displaced ? 500 : 200;
        return {
          top: 0,
          bottom: 0,
          left,
          right: left + 100,
          width: 100,
          height: 0,
          x: left,
          y: 0,
          toJSON: () => ({}),
        };
      },
    });

    act(() => {
      global.triggerIntersection(leading, true);
      displaced = true;
    });

    expect(viewport.scrollLeft).toBe(800);
  });

  it('rebuilds the window around a focus that jumps clear of it', () => {
    // A navigation can land anywhere in the book, and the window grows only a chunk at a time from
    // its own edges, so nothing else would ever mount the destination.
    const { result, rerender } = renderPhraseWindow(5000, 100);

    rerender({ total: 5000, focusIndex: 4000 });

    expect(result.current.range).toEqual({
      start: 4000 - INITIAL_WINDOW_HALF,
      end: 4000 + INITIAL_WINDOW_HALF + 1,
    });
  });

  it('leaves the window alone for a focus that moves within it', () => {
    // Stepping through mounted text must not recenter the bounds under the reader.
    const { result, rerender } = renderPhraseWindow(200, 100);
    const before = result.current.range;

    rerender({ total: 200, focusIndex: 101 });

    expect(result.current.range).toBe(before);
  });

  it('leaves a focus culled by scrolling culled', () => {
    // Rebuilding on the mere fact that the focus is unmounted would drag the strip straight back to
    // it, which is free scrolling made impossible.
    const { result, viewport } = renderPhraseWindow(200, 100);
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    mountGroupEls(
      viewport,
      Array.from({ length: 17 }, (_, i) => -20000 + i * 100),
    );

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.start).toBeGreaterThan(100);
  });

  it('culls from the trailing end in RTL when the window extends backward', () => {
    // Document order runs right-to-left here, so the groups a leading extend may drop sit past the
    // viewport's *left* edge.
    document.documentElement.dir = 'rtl';
    const { result, viewport } = renderPhraseWindow(200, 100);
    const endBefore = result.current.range.end;
    const { leading } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    // Later indices lie further left; the last two are beyond the retention margin.
    mountGroupEls(viewport, [900, 800, -9000, -8000]);

    act(() => {
      global.triggerIntersection(leading, true);
    });

    expect(result.current.range.end).toBe(endBefore - 2);
  });

  it('culls from the leading end in RTL when the window extends forward', () => {
    document.documentElement.dir = 'rtl';
    const { result, viewport } = renderPhraseWindow(200, 100);
    const startBefore = result.current.range.start;
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    // Earlier indices lie further right; the first two are beyond the retention margin.
    mountGroupEls(viewport, [8000, 7000, 200, 100]);

    act(() => {
      global.triggerIntersection(trailing, true);
    });

    expect(result.current.range.start).toBe(startBefore + 2);
  });

  it('extends both edges when one observer delivery carries both sentinels', () => {
    // A strip narrow enough to hold both sentinels inside the arming margin delivers them together,
    // running two extends before React re-renders.
    const { result, viewport } = renderPhraseWindow(200, 100);
    const before = result.current.range;
    const { leading, trailing } = mountSentinels(viewport, result.current);
    // Nothing is cullable, so both edges are free to grow by a full chunk.
    stubRect(viewport, 0, 1000);
    mountGroupEls(viewport, [100, 200, 300]);

    act(() => {
      triggerBothSentinels(leading, trailing);
    });

    expect(result.current.range).toEqual({
      start: before.start - EXTEND_CHUNK,
      end: before.end + EXTEND_CHUNK,
    });
  });

  it('rebuilds the window when the book shrinks past its start', () => {
    const { result, viewport, rerender } = renderPhraseWindow(200, 20);
    const { trailing } = mountSentinels(viewport, result.current);
    stubRect(viewport, 0, 1000);
    // Every mounted group sits far behind the viewport, so each extend culls the whole leading end
    // and walks the window forward rather than merely growing it.
    mountGroupEls(
      viewport,
      Array.from({ length: 17 }, (_, i) => -20000 + i * 100),
    );
    while (result.current.range.start < 100) {
      act(() => {
        global.triggerIntersection(trailing, true);
      });
    }
    const scrolledAhead = result.current.range;

    rerender({ total: 100, focusIndex: 20 });

    expect(scrolledAhead.start).toBeGreaterThanOrEqual(100);
    expect(result.current.range.start).toBeLessThan(100);
    expect(result.current.range.end).toBeLessThanOrEqual(100);
    expect(result.current.range.end).toBeGreaterThan(result.current.range.start);
  });

  it('leaves the window alone when the book shrinks to nothing', () => {
    // An empty book has no group to center on, so rebuilding would only produce another empty
    // range; the strip renders nothing either way.
    const { result, rerender } = renderPhraseWindow(200, 20);

    rerender({ total: 0, focusIndex: 0 });

    expect(result.current.range.end - result.current.range.start).toBeGreaterThanOrEqual(0);
  });

  it('holds one range identity across a render that did not move the window', () => {
    // The arc-measurement pass keys its loop-damping on whether its inputs actually changed, so a
    // fresh range object every render would re-measure on every pass and defeat it.
    const { result, rerender } = renderPhraseWindow(200, 100);
    const before = result.current.range;

    rerender({ total: 200, focusIndex: 100 });

    expect(result.current.range).toBe(before);
  });
});
