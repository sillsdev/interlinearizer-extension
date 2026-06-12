import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment } from 'interlinearizer';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import useSegmentWindow from '../../hooks/useSegmentWindow';
import { verseKey } from '../../components/InterlinearNavContext';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';

/**
 * The intersection-observer Jest stub records instances on the global object and exposes a helper
 * to fire intersections. Declare the shapes here so the test reads them without type assertions.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var triggerIntersection: (el: Element, isIntersecting: boolean) => void;
  // eslint-disable-next-line no-var, vars-on-top
  var ioInstances: { targets: Set<Element> }[];
}

/**
 * Builds a single-token word segment for the given chapter/verse. Token surface text is irrelevant
 * to windowing, so it is a fixed stub.
 *
 * @param chapter - Chapter number for the segment's refs.
 * @param verse - Verse number for the segment's refs.
 * @returns A minimal {@link Segment}.
 */
function makeSegment(chapter: number, verse: number): Segment {
  return {
    id: `GEN ${chapter}:${verse}`,
    startRef: { book: 'GEN', chapter, verse },
    endRef: { book: 'GEN', chapter, verse },
    baselineText: 'word',
    tokens: [
      {
        ref: `GEN ${chapter}:${verse}:0`,
        surfaceText: 'word',
        writingSystem: 'en',
        type: 'word',
        charStart: 0,
        charEnd: 4,
      },
    ],
  };
}

/**
 * Builds a book whose segments span two chapters: `chapter1Count` verses in chapter 1 followed by
 * `chapter2Count` verses in chapter 2.
 *
 * @param chapter1Count - Number of verses in chapter 1.
 * @param chapter2Count - Number of verses in chapter 2.
 * @returns A {@link Book} with the combined flat segment list.
 */
function makeBook(chapter1Count: number, chapter2Count: number): Book {
  const segments: Segment[] = [];
  for (let v = 1; v <= chapter1Count; v += 1) segments.push(makeSegment(1, v));
  for (let v = 1; v <= chapter2Count; v += 1) segments.push(makeSegment(2, v));
  return { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments };
}

/**
 * Renders {@link useSegmentWindow} with a real, attached scroll container so sentinel ref callbacks
 * register with the stubbed observer and `scrollHeight`/`scrollTop` are writable for assertions.
 *
 * @param book - The book to window.
 * @param scrRef - The scripture reference whose verse anchors the window.
 * @returns The render-hook result plus the scroll container element.
 */
function renderSegmentWindow(
  book: Book,
  scrRef: SerializedVerseRef,
  focusedTokenRef?: string,
  onSettled?: () => void,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Mirrors the context's internal-nav classification: a test calls `markInternal(ref)` to mimic an
  // internally-originated navigation (a segment/strip click) before a rerender; the hook's
  // `consumeInternalNav` matches+clears it, exactly as the real context does.
  const pendingInternal = new Set<string>();
  const markInternal = (ref: SerializedVerseRef) => pendingInternal.add(verseKey(ref));
  const consumeInternalNav = (ref: SerializedVerseRef) => {
    const key = verseKey(ref);
    if (!pendingInternal.has(key)) return false;
    pendingInternal.delete(key);
    return true;
  };
  // Records each gated continuous-scroll value the hook reports at a recenter midpoint, so a test can
  // assert the strip-visibility flip lands with (not after) the window rebuild.
  const displayContinuousScrollReports: boolean[] = [];
  const onDisplayContinuousScrollChange = (v: boolean) => displayContinuousScrollReports.push(v);
  const hook = renderHook<
    ReturnType<typeof useSegmentWindow>,
    { b: Book; ref: SerializedVerseRef; focus?: string | undefined; cont?: boolean }
  >(
    ({ b, ref, focus, cont }) => {
      const scrollContainerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentWindow({
        book: b,
        scrRef: ref,
        focusedTokenRef: focus,
        continuousScroll: cont ?? false,
        scrollContainerRef,
        consumeInternalNav,
        onDisplayContinuousScrollChange,
        onSettled,
      });
    },
    { initialProps: { b: book, ref: scrRef, focus: focusedTokenRef, cont: false } },
  );
  return {
    ...hook,
    container,
    markInternal,
    hasPendingInternal: (ref: SerializedVerseRef) => pendingInternal.has(verseKey(ref)),
    displayContinuousScrollReports,
  };
}

/**
 * Mounts the rendered window's sentinel elements into `container` so the observer has real targets.
 * Returns the created top/bottom elements.
 *
 * @param container - The scroll container the sentinels live in.
 * @param topRef - The hook's top sentinel ref callback.
 * @param bottomRef - The hook's bottom sentinel ref callback.
 * @returns The mounted sentinel elements.
 */
function mountSentinels(
  container: HTMLElement,
  topRef: (el: HTMLElement | null) => void,
  bottomRef: (el: HTMLElement | null) => void,
) {
  const top = document.createElement('div');
  const bottom = document.createElement('div');
  container.appendChild(top);
  container.appendChild(bottom);
  act(() => {
    topRef(top);
    bottomRef(bottom);
  });
  return { top, bottom };
}

/**
 * Installs a stub `ResizeObserver` that records the most recently created callback (and the
 * elements it observes) and returns a `fire` helper (invokes it inside `act`) plus a `restore` to
 * put the original observer back. Shared by every test that drives the scroll-compensation /
 * re-snap observer by hand, so the stub class is declared once at module scope rather than
 * re-declared in each test.
 *
 * @returns `fire` to invoke the recorded observer callback, `observedTargets` to read the elements
 *   the most recent observer watches, and `restore` to reinstate the original.
 */
function installResizeObserver(): {
  fire: () => void;
  observedTargets: () => Element[];
  restore: () => void;
} {
  const original = global.ResizeObserver;
  let callback: ResizeObserverCallback | undefined;
  let observed: Element[] = [];
  const stub: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };
  class StubResizeObserver implements ResizeObserver {
    /** @param cb - Stored so a test can fire it on demand. */
    constructor(cb: ResizeObserverCallback) {
      callback = cb;
      observed = [];
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    observe(el: Element) {
      observed.push(el);
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    unobserve() {}

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    disconnect() {
      observed = [];
    }
  }
  global.ResizeObserver = StubResizeObserver;
  return {
    fire: () =>
      act(() => {
        callback?.([], stub);
      }),
    observedTargets: () => [...observed],
    restore: () => {
      global.ResizeObserver = original;
    },
  };
}

/**
 * Stubs `getBoundingClientRect` on an element to report fixed top and bottom edges, so the window
 * hook's geometry reads (cull walks, extend anchors, sentinel offsets) are deterministic in jsdom.
 *
 * @param el - The element to stub.
 * @param top - The `top` value the rect should report.
 * @param bottom - The `bottom` value the rect should report; defaults to `top` (zero height).
 */
function stubRect(el: Element, top: number, bottom: number = top): void {
  el.getBoundingClientRect = () => ({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

/**
 * Mounts one stub segment root per id into `container`, carrying the `data-segment-id` attribute
 * the window hook uses to enumerate mounted segments for cull measurement and extend anchoring.
 *
 * @param container - The scroll container to mount into.
 * @param ids - Segment ids in window order.
 * @returns The mounted elements, index-aligned with `ids`.
 */
function mountSegmentEls(container: HTMLElement, ids: readonly string[]): HTMLElement[] {
  return ids.map((id) => {
    const el = document.createElement('div');
    el.setAttribute('data-segment-id', id);
    container.appendChild(el);
    return el;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  global.ioInstances = [];
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('useSegmentWindow', () => {
  it('centers the initial window on the active verse, clamped to the book start', () => {
    const book = makeBook(20, 0);
    const { result } = renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 1 });

    // Anchor at index 0; the window cannot extend before the start, so it runs [0, 9).
    expect(result.current.windowSegments[0].id).toBe('GEN 1:1');
    expect(result.current.windowSegments).toHaveLength(9);
  });

  it('spans chapter boundaries when the anchor is near the end of a chapter', () => {
    const book = makeBook(10, 10);
    const { result } = renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 10 });

    const ids = result.current.windowSegments.map((s) => s.id);
    expect(ids).toContain('GEN 1:10');
    expect(ids).toContain('GEN 2:1');
  });

  it('falls back to the first segment of the chapter when no exact verse matches', () => {
    const book = makeBook(10, 10);
    const { result } = renderSegmentWindow(book, { book: 'GEN', chapterNum: 2, verseNum: 999 });

    // No GEN 2:999, so the anchor is the first chapter-2 segment (GEN 2:1, flat index 10).
    expect(result.current.windowSegments.map((s) => s.id)).toContain('GEN 2:1');
  });

  it('falls back to index 0 when the book has no matching book or chapter', () => {
    const book = makeBook(5, 0);
    const { result } = renderSegmentWindow(book, { book: 'EXO', chapterNum: 1, verseNum: 1 });

    expect(result.current.windowSegments[0].id).toBe('GEN 1:1');
  });

  it('appends later segments when the bottom sentinel intersects', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 15,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    const before = result.current.windowSegments.length;
    act(() => global.triggerIntersection(bottom, true));

    expect(result.current.windowSegments.length).toBeGreaterThan(before);
  });

  it('ignores a non-intersecting sentinel entry', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 15,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    const before = result.current.windowSegments.length;
    act(() => global.triggerIntersection(bottom, false));

    expect(result.current.windowSegments).toHaveLength(before);
  });

  it('prepends earlier segments and holds the anchor segment still when the top sentinel intersects', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 20,
    });
    const { top } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    const firstBefore = result.current.windowSegments[0].id;
    // Mount the window's segment roots so the extend can anchor on the old first segment. The
    // prepend pushes that anchor down by 300px (100 → 400); the correction must add exactly that
    // delta to scrollTop so the visible content holds still.
    const els = mountSegmentEls(
      container,
      result.current.windowSegments.map((s) => s.id),
    );
    stubRect(els[0], 100);
    container.scrollTop = 50;
    act(() => {
      global.triggerIntersection(top, true);
      stubRect(els[0], 400);
    });

    expect(result.current.windowSegments[0].id).not.toBe(firstBefore);
    expect(container.scrollTop).toBe(350);
  });

  it('holds the anchor segment still when a bottom extend culls content above the viewport', () => {
    const book = makeBook(60, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // Container viewport spans [0, 600); the first two segments sit far above the retention line
    // (bottom < -800), so the extend culls them. Removing their height shifts the old last segment
    // (the anchor) up by 50px across the mutation; the correction must subtract that delta.
    stubRect(container, 0, 600);
    const els = mountSegmentEls(
      container,
      result.current.windowSegments.map((s) => s.id),
    );
    stubRect(els[0], -1200, -1000);
    stubRect(els[1], -1000, -850);
    const anchor = els[els.length - 1];
    stubRect(anchor, 500);
    container.scrollTop = 1700;
    act(() => {
      global.triggerIntersection(bottom, true);
      stubRect(anchor, 450);
    });

    expect(result.current.windowSegments[0].id).toBe('GEN 1:3');
    expect(container.scrollTop).toBe(1650);
  });

  it('does not cull segments that are still within the retention margin', () => {
    const book = makeBook(60, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // The first segment ends 700px above the viewport — beyond the sentinel margin but inside the
    // retention line (800px) — so the extend must keep it mounted.
    stubRect(container, 0, 600);
    const els = mountSegmentEls(
      container,
      result.current.windowSegments.map((s) => s.id),
    );
    stubRect(els[0], -900, -700);
    act(() => global.triggerIntersection(bottom, true));

    expect(result.current.windowSegments[0].id).toBe('GEN 1:1');
  });

  it('culls far-below segments when a top extend prepends earlier ones', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 20,
    });
    const { top } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // Container viewport spans [0, 600); the last two segments start beyond the retention line
    // below it (top > 1400), so the top extend culls them from the bottom edge.
    stubRect(container, 0, 600);
    const ids = result.current.windowSegments.map((s) => s.id);
    const els = mountSegmentEls(container, ids);
    stubRect(els[els.length - 2], 1500, 1600);
    stubRect(els[els.length - 1], 1600, 1700);
    act(() => global.triggerIntersection(top, true));

    const after = result.current.windowSegments.map((s) => s.id);
    expect(after).not.toContain(ids[ids.length - 1]);
    expect(after).not.toContain(ids[ids.length - 2]);
    expect(after).toContain(ids[ids.length - 3]);
  });

  it('skips the scroll correction when the anchor segment was unmounted across the mutation', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 20,
    });
    const { top } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    const els = mountSegmentEls(
      container,
      result.current.windowSegments.map((s) => s.id),
    );
    stubRect(els[0], 100);
    container.scrollTop = 50;
    // Remove the anchor element before the layout effect measures it (as React would when the
    // segment unmounts in the same commit): the correction must stand down rather than measure a
    // detached rect.
    act(() => {
      global.triggerIntersection(top, true);
      els[0].remove();
    });

    expect(container.scrollTop).toBe(50);
  });

  it('does not extend past the book start when already at the top', () => {
    const book = makeBook(20, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    const { top } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    const before = result.current.windowSegments.length;
    act(() => global.triggerIntersection(top, true));

    expect(result.current.windowSegments).toHaveLength(before);
  });

  it('does not extend past the book end when already at the bottom', () => {
    const book = makeBook(6, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 6,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // The whole 6-segment book already fits in the window; the bottom is reached.
    const before = result.current.windowSegments.length;
    act(() => global.triggerIntersection(bottom, true));

    expect(result.current.windowSegments).toHaveLength(before);
  });

  it('caps the mounted window at the hard cap when nothing is cullable', () => {
    const book = makeBook(200, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // With no segment roots mounted (jsdom reports no geometry) nothing is ever cullable, so growth
    // stops exactly at the hard cap: later extends are skipped outright.
    for (let i = 0; i < 30; i += 1) {
      act(() => global.triggerIntersection(bottom, true));
    }
    expect(result.current.windowSegments).toHaveLength(120);
  });

  it('fades and recenters when external navigation moves the anchor outside the window', () => {
    const book = makeBook(60, 0);
    const { result, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    expect(result.current.windowSegments.map((s) => s.id)).not.toContain('GEN 1:50');

    act(() => {
      rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } });
    });

    // The window fades out immediately and only rebuilds after the fade timeout elapses.
    expect(result.current.isFaded).toBe(true);
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(result.current.isFaded).toBe(false);
    expect(result.current.windowSegments.map((s) => s.id)).toContain('GEN 1:50');
  });

  it('fades and recenters when the segments identity changes at the same anchor index', () => {
    // A book swap (or a re-tokenized book) hands the hook a new `segments` array whose anchor can
    // resolve to the same index as before; the identity check must still detect the change and
    // recenter rather than leaving the window on stale segment objects.
    const book = makeBook(10, 0);
    const { result, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    expect(result.current.isFaded).toBe(false);

    act(() => rerender({ b: makeBook(10, 0), ref: { book: 'GEN', chapterNum: 1, verseNum: 1 } }));

    expect(result.current.isFaded).toBe(true);
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(result.current.isFaded).toBe(false);
  });

  it('lags displayScrRef through the fade so the highlight moves only with the window swap', () => {
    const book = makeBook(60, 0);
    const { result, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    expect(result.current.displayScrRef.verseNum).toBe(1);

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));

    // While the fade is running the highlight must still point at the old verse.
    expect(result.current.isFaded).toBe(true);
    expect(result.current.displayScrRef.verseNum).toBe(1);

    // Once the fade completes and the window swaps, the highlight moves to the new verse.
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(result.current.displayScrRef.verseNum).toBe(50);
  });

  it('reports the gated continuous-scroll value only at the recenter midpoint', () => {
    const book = makeBook(60, 0);
    const { rerender, displayContinuousScrollReports } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 1 },
      undefined,
    );

    // Toggle continuous scroll on while triggering a recenter (external nav). The report must NOT fire
    // during the fade-out — only when the window rebuilds at the midpoint, so the parent's strip
    // mounts in the same commit.
    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 }, cont: true }));
    expect(displayContinuousScrollReports).toEqual([]);

    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(displayContinuousScrollReports).toEqual([true]);
  });

  it('moves displayScrRef immediately for internal navigation (no fade)', () => {
    const book = makeBook(60, 0);
    const { result, rerender, markInternal } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 5,
    });

    const target: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 50 };
    markInternal(target);
    act(() => rerender({ b: book, ref: target }));

    expect(result.current.isFaded).toBe(false);
    expect(result.current.displayScrRef.verseNum).toBe(50);
  });

  it('fades and recenters even when external navigation lands inside the current window', () => {
    const book = makeBook(60, 0);
    const { result, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 5,
    });

    // GEN 1:6 already sits inside the initial window, yet an external nav must still fade so the
    // segment list and continuous strip animate together.
    act(() => {
      rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 6 } });
    });
    expect(result.current.isFaded).toBe(true);

    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(result.current.isFaded).toBe(false);
    expect(result.current.windowSegments.map((s) => s.id)).toContain('GEN 1:6');
  });

  it('snaps the recentered verse to the top of the list behind the fade', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { result, container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    // Mark the newly-active segment so the layout effect can find it via aria-current.
    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    act(() => {
      rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } });
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    expect(result.current.isFaded).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('grows the snap spacer when scrollIntoView cannot reach the top', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    const spacer = document.createElement('div');
    spacer.setAttribute('data-snap-spacer', '');
    container.appendChild(spacer);

    // Simulate scrollIntoView failing to reach the top: after the call the target still reports a
    // positive offset below the container top (the content below is too short for the browser to
    // scroll the target all the way up).
    const containerRect = { top: 0, left: 0, right: 0, bottom: 400, width: 0, height: 400 };
    jest
      .spyOn(container, 'getBoundingClientRect')
      .mockReturnValue({ ...containerRect, x: 0, y: 0, toJSON: () => containerRect });
    const activeRect = { top: 30, left: 0, right: 0, bottom: 60, width: 0, height: 30 };
    jest
      .spyOn(active, 'getBoundingClientRect')
      .mockReturnValue({ ...activeRect, x: 0, y: 0, toJSON: () => activeRect });

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(spacer.style.height).toBe('30px');
  });

  it('does not grow the snap spacer when scrollIntoView reaches the top', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    const spacer = document.createElement('div');
    spacer.setAttribute('data-snap-spacer', '');
    spacer.style.height = '50px';
    container.appendChild(spacer);

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    // scrollIntoView succeeded (remainingOffset is 0 in jsdom) — spacer stays at 0 from the reset.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(spacer.style.height).toBe('0px');
  });

  it('re-snaps the recentered verse after paint to correct for late layout settling', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    // The synchronous layout-effect snap has fired once; the post-paint re-snap loop is still pending.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Flushing the first animation frame re-snaps against the now-painted layout.
    act(() => jest.advanceTimersByTime(16));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('does not re-snap on idle frames after the single post-paint snap', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    // Layout-effect snap: 1. The post-paint rAF re-snap has not run yet.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // The post-paint frame re-snaps once against the painted layout: 2 total.
    act(() => jest.advanceTimersByTime(16));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    // No further resizes fire (jsdom doesn't lay out), so the event-driven snap stays quiet — unlike
    // the old per-frame loop it does not keep snapping on idle frames. The quiet timer then reports
    // settled and the deadline elapses with no extra snaps.
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS * 2));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('re-snaps against each later settling wave relayed through the compensation observer', () => {
    const { fire, restore } = installResizeObserver();
    try {
      const book = makeBook(60, 0);
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      const onSettled = jest.fn();
      const { container, result, rerender } = renderSegmentWindow(
        book,
        { book: 'GEN', chapterNum: 1, verseNum: 1 },
        undefined,
        onSettled,
      );
      const active = document.createElement('div');
      active.setAttribute('aria-current', 'true');
      container.appendChild(active);
      // Mount the segment wrapper so the compensation/relay observer subscribes.
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      act(() => result.current.contentRef(wrapper));

      act(() => jest.advanceTimersByTime(16));
      onSettled.mockClear();

      act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      // The post-paint rAF re-snaps once against the painted layout.
      act(() => jest.advanceTimersByTime(16));
      const afterFirstSnap = scrollIntoView.mock.calls.length;

      // Each later settling wave (arc padding applied, strip mounted) fires the resize observer; while
      // the recenter is in flight that re-snaps the verse rather than compensating.
      fire();
      fire();
      expect(scrollIntoView.mock.calls.length).toBe(afterFirstSnap + 2);

      // Once the waves stop the quiet window elapses and the recenter reports settled exactly once.
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('does not re-snap on the initial mount, only after a recenter', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 1 });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    // Flush any pending frames; the initial mount must not snap (no recenter happened).
    act(() => jest.advanceTimersByTime(16));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('snaps the active verse to the top on a fresh mount whose anchor sits mid-book', () => {
    // A cross-book remount mounts this hook fresh with the new book centered on a mid-book anchor.
    // Without a mount snap the verse renders mid-window, below the fold, at scrollTop 0.
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 30 });

    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    // The mount-snap loop runs on this fresh mid-book mount (skipped when the anchor is at the book
    // start), pulling the active verse to the top behind the loader curtain.
    act(() => jest.advanceTimersByTime(16));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('fires onSettled on the next frame for a first mount that needs no snap', () => {
    const book = makeBook(60, 0);
    const onSettled = jest.fn();
    // Anchor at the book start: no mount snap, so settle fires once the next frame paints.
    renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 1 }, undefined, onSettled);

    expect(onSettled).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(16));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('fires onSettled once the mid-book mount snap settles', () => {
    const book = makeBook(60, 0);
    Element.prototype.scrollIntoView = jest.fn();
    const onSettled = jest.fn();
    const { container } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 30 },
      undefined,
      onSettled,
    );
    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    // The mount snap re-snaps once after paint, then — no further resize waves fire in jsdom — the
    // quiet window elapses and it reports settled. Advance past the rAF, the quiet window, and the
    // deadline backstop.
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('fires onSettled after a recenter snap settles', () => {
    const book = makeBook(60, 0);
    Element.prototype.scrollIntoView = jest.fn();
    const onSettled = jest.fn();
    const { rerender, container } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 1 },
      undefined,
      onSettled,
    );
    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    // Drain the initial-mount settle (anchor at book start → next-frame settle).
    act(() => jest.advanceTimersByTime(16));
    onSettled.mockClear();

    // An external recenter rebuilds + snaps; settle fires again once the layout goes quiet.
    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
    expect(onSettled).toHaveBeenCalled();
  });

  it('fires onSettled once via the deadline when settling waves never stop', () => {
    const { fire, restore } = installResizeObserver();
    try {
      const book = makeBook(60, 0);
      Element.prototype.scrollIntoView = jest.fn();
      const onSettled = jest.fn();
      const { container, result } = renderSegmentWindow(
        book,
        { book: 'GEN', chapterNum: 1, verseNum: 30 },
        undefined,
        onSettled,
      );
      const active = document.createElement('div');
      active.setAttribute('aria-current', 'true');
      container.appendChild(active);
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      act(() => result.current.contentRef(wrapper));

      // A layout that resizes faster than the quiet window keeps relaying re-snaps, so the quiet
      // timer never fires. The deadline backstop reports settled exactly once so the curtain is never
      // stranded. Fire a resize on every quiet interval right up to the deadline.
      const ticks = Math.ceil(RECENTER_FADE_MS / 50) + 2;
      for (let i = 0; i < ticks; i += 1) {
        fire();
        act(() => jest.advanceTimersByTime(50));
      }
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('tolerates a mount with no onSettled callback', () => {
    const book = makeBook(60, 0);
    // No callback: the next-frame settle path must run without throwing on the optional call.
    renderSegmentWindow(book, { book: 'GEN', chapterNum: 1, verseNum: 1 });
    expect(() => act(() => jest.advanceTimersByTime(16))).not.toThrow();
  });

  it('re-creates the sentinel observer on recenter so the new geometry is re-evaluated', () => {
    const book = makeBook(60, 0);
    const { result, container, rerender } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    mountSentinels(container, result.current.topSentinelRef, result.current.bottomSentinelRef);

    const observerBefore = global.ioInstances[0];

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    // The recenter tears down the stale observer and subscribes a fresh one.
    expect(global.ioInstances).toHaveLength(1);
    expect(global.ioInstances[0]).not.toBe(observerBefore);
  });

  it('re-creates the sentinel observer after each extend so a still-intersecting sentinel keeps filling', () => {
    const book = makeBook(200, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 1,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );
    const observerBefore = global.ioInstances[0];

    // An IntersectionObserver only fires on transitions, so a sentinel that never leaves the arming
    // margin (compact baseline-text segments) would otherwise extend once and stall scrolling. Each
    // extend must re-subscribe a fresh observer, whose initial delivery re-evaluates the sentinel
    // and keeps the window filling.
    act(() => global.triggerIntersection(bottom, true));
    expect(result.current.windowSegments).toHaveLength(15);
    expect(global.ioInstances).toHaveLength(1);
    expect(global.ioInstances[0]).not.toBe(observerBefore);

    act(() => global.triggerIntersection(bottom, true));
    expect(result.current.windowSegments).toHaveLength(21);
  });

  it('observes both the segment wrapper and the container once the wrapper is registered', () => {
    const { observedTargets, restore } = installResizeObserver();
    try {
      const book = makeBook(40, 0);
      const { result, container } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });

      // No observer until the wrapper attaches: the wrapper is what actually grows when segment
      // heights settle (the container's own box is fixed by the panel layout), so without it there
      // is nothing meaningful to watch.
      expect(observedTargets()).toEqual([]);
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      act(() => result.current.contentRef(wrapper));

      expect(observedTargets()).toContain(wrapper);
      expect(observedTargets()).toContain(container);
    } finally {
      restore();
    }
  });

  it('disconnects the resize observer when the wrapper ref is cleared', () => {
    const { observedTargets, restore } = installResizeObserver();
    try {
      const book = makeBook(40, 0);
      const { result, container } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      act(() => result.current.contentRef(wrapper));
      expect(observedTargets()).toContain(wrapper);

      // eslint-disable-next-line no-null/no-null -- React clears ref callbacks with literal null
      act(() => result.current.contentRef(null));

      expect(observedTargets()).toEqual([]);
    } finally {
      restore();
    }
  });

  it('does not fade when the navigation was originated internally', () => {
    const book = makeBook(60, 0);
    const { result, rerender, markInternal, hasPendingInternal } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 5,
    });

    // Mark the nav internal as the context does for a click/strip nav, then drive the matching
    // scrRef change.
    const newRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 50 };
    markInternal(newRef);
    act(() => {
      rerender({ b: book, ref: newRef });
    });

    expect(result.current.isFaded).toBe(false);
    // The marker is consumed so a later external nav to the same verse still fades.
    expect(hasPendingInternal(newRef)).toBe(false);
  });

  it('fades on a later external nav to the same verse after an internal nav consumed the marker', () => {
    const book = makeBook(60, 0);
    const { result, rerender, markInternal } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 5,
    });

    const target: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 50 };
    markInternal(target);
    act(() => rerender({ b: book, ref: target }));
    expect(result.current.isFaded).toBe(false);

    // Navigate away, then back to the same verse externally (ref no longer stamped): must fade.
    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 5 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    act(() => rerender({ b: book, ref: target }));
    expect(result.current.isFaded).toBe(true);
  });

  it('unobserves the previous sentinel when its ref is cleared', () => {
    const book = makeBook(40, 0);
    const { result, container } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 15,
    });
    const { bottom } = mountSentinels(
      container,
      result.current.topSentinelRef,
      result.current.bottomSentinelRef,
    );

    // Clear the bottom sentinel ref (as React does when the node unmounts), then fire an
    // intersection on the now-detached element: it must not extend the window.
    // eslint-disable-next-line no-null/no-null -- React clears ref callbacks with literal null
    act(() => result.current.bottomSentinelRef(null));
    const before = result.current.windowSegments.length;
    act(() => global.triggerIntersection(bottom, true));

    expect(result.current.windowSegments).toHaveLength(before);
  });

  it('cleans up the observer on unmount', () => {
    const book = makeBook(40, 0);
    const { result, container, unmount } = renderSegmentWindow(book, {
      book: 'GEN',
      chapterNum: 1,
      verseNum: 15,
    });
    mountSentinels(container, result.current.topSentinelRef, result.current.bottomSentinelRef);

    expect(global.ioInstances.length).toBeGreaterThan(0);
    unmount();
    expect(global.ioInstances).toHaveLength(0);
  });

  it('initializes displayFocusedTokenRef from the initial focused token', () => {
    const book = makeBook(40, 0);
    const { result } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 15 },
      'tok-initial',
    );
    expect(result.current.displayFocusedTokenRef).toBe('tok-initial');
  });

  it('defers displayFocusedTokenRef to the recenter midpoint on external nav', () => {
    const book = makeBook(60, 0);
    const { result, rerender } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 5 },
      'tok-old',
    );

    // External nav: the focused token jumps to the new verse the same render the anchor changes.
    act(() =>
      rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 }, focus: 'tok-new' }),
    );
    // Mid-fade: the display ref must still read the old token so the active-verse buttons on the
    // still-visible old content don't re-evaluate (and dim) before the fade-out completes.
    expect(result.current.isFaded).toBe(true);
    expect(result.current.displayFocusedTokenRef).toBe('tok-old');

    // At the midpoint the window swaps behind the fade and the display ref catches up.
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(result.current.displayFocusedTokenRef).toBe('tok-new');
  });

  it('updates displayFocusedTokenRef immediately for a within-verse focus move (no fade)', () => {
    const book = makeBook(40, 0);
    const { result, rerender } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 15 },
      'tok-a',
    );

    // Same verse (anchor unchanged), focus moves token-to-token: no fade, display ref tracks at once.
    act(() =>
      rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 15 }, focus: 'tok-b' }),
    );
    expect(result.current.isFaded).toBe(false);
    expect(result.current.displayFocusedTokenRef).toBe('tok-b');
  });

  describe('above-viewport scroll compensation', () => {
    // The module-scope `installResizeObserver` swaps in a stub observer; restore the original after
    // each test in this block so the stub never leaks into another test's render.
    let restoreResizeObserver: (() => void) | undefined;
    afterEach(() => {
      restoreResizeObserver?.();
      restoreResizeObserver = undefined;
    });

    /**
     * Installs the shared stub `ResizeObserver` and registers its restore for this block's
     * `afterEach`, so callers only need the returned `fire` helper.
     *
     * @returns `fire`, which invokes the recorded observer callback inside `act`.
     */
    function installBlockResizeObserver(): { fire: () => void } {
      const { fire, restore } = installResizeObserver();
      restoreResizeObserver = restore;
      return { fire };
    }

    /**
     * Renders a window anchored at the book start, drains the initial-mount settle (which clears
     * the recenter-in-flight gate), mounts the segment wrapper plus the window's segment roots
     * (anchor candidates), and stubs the container and first-segment rects so the anchor seeds
     * deterministically (first segment visible at offset 10).
     *
     * @returns The render result plus the observer `fire` helper and the mounted segment elements.
     */
    function renderSettledWindow() {
      const { fire } = installBlockResizeObserver();
      const book = makeBook(60, 0);
      const { result, container } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      // Anchor at book start needs no mount snap, so the next frame clears recenterInFlight.
      act(() => jest.advanceTimersByTime(16));
      stubRect(container, 0, 600);
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      const els = mountSegmentEls(
        wrapper,
        result.current.windowSegments.map((s) => s.id),
      );
      stubRect(els[0], 10, 50);
      // Subscribing the observer seeds the compensation anchor from the current rects.
      act(() => result.current.contentRef(wrapper));
      return { result, container, els, fire };
    }

    it('holds the visible content still when content above the viewport grows', () => {
      const { container, els, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // Growth above the viewport pushes the anchor segment down 30px; the correction scrolls down
      // by the same amount so the visible content never moves.
      stubRect(els[0], 40, 80);
      fire();

      expect(container.scrollTop).toBe(130);
    });

    it('does not compensate while the list is scrolled to the very top', () => {
      const { container, els, fire } = renderSettledWindow();
      container.scrollTop = 0;

      stubRect(els[0], 40, 80);
      fire();

      expect(container.scrollTop).toBe(0);
    });

    it('does not move scrollTop when the anchor offset is unchanged', () => {
      const { container, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // Same rects as the seed: nothing above the viewport changed, so scrollTop is left alone.
      fire();

      expect(container.scrollTop).toBe(100);
    });

    it('re-baselines on scroll so user scrolling is never re-applied as a correction', () => {
      const { container, els, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // The user scrolls down 60px: every segment moves up by that amount on screen and the seeded
      // anchor scrolls out of the viewport. The scroll listener re-baselines onto the next visible
      // segment, so the following resize wave reads a zero delta — without it, the stale anchor
      // offset would re-apply the 60px as a phantom "correction".
      container.scrollTop = 160;
      stubRect(els[0], -50, -10);
      stubRect(els[1], -10, 30);
      fireEvent.scroll(container);
      fire();

      expect(container.scrollTop).toBe(160);
    });

    it('stands down when the anchor segment was unmounted, then resumes from the re-picked anchor', () => {
      const { container, els, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // The anchor segment unmounts (e.g. culled): the fire must not correct against a detached
      // rect — it re-picks the next visible segment instead.
      els[0].remove();
      stubRect(els[1], 5, 45);
      fire();
      expect(container.scrollTop).toBe(100);

      // The re-picked anchor is live: the next growth above the viewport compensates as usual.
      stubRect(els[1], 25, 65);
      fire();
      expect(container.scrollTop).toBe(120);
    });

    it('ignores container movement because anchor offsets are container-relative', () => {
      const { container, els, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // The strip mounts above the list: the container's top edge moves down 40px and every
      // segment moves with it. The anchor's offset below the container top is unchanged, so no
      // phantom correction fires.
      stubRect(container, 40, 640);
      stubRect(els[0], 50, 90);
      fire();

      expect(container.scrollTop).toBe(100);
    });

    it('re-baselines after an extend so the next resize does not re-apply the extend shift', () => {
      const { fire } = installBlockResizeObserver();
      // Anchor mid-book so the window starts past the book start, leaving earlier segments to
      // prepend. The mid-book mount snap settles below, clearing recenterInFlight — otherwise the
      // compensation observer stands down for the whole test.
      const book = makeBook(60, 0);
      const { result, container } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 30,
      });
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
      expect(result.current.windowSegments[0].id).not.toBe('GEN 1:1');
      stubRect(container, 0, 600);
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      const els = mountSegmentEls(
        wrapper,
        result.current.windowSegments.map((s) => s.id),
      );
      stubRect(els[0], 20, 60);
      act(() => result.current.contentRef(wrapper));
      const top = document.createElement('div');
      container.appendChild(top);
      act(() => result.current.topSentinelRef(top));
      container.scrollTop = 100;

      // A prepend pushes the old first segment (both the extend anchor and the compensation
      // anchor) down 100px; the layout effect adds that delta to scrollTop and re-baselines.
      act(() => {
        global.triggerIntersection(top, true);
        stubRect(els[0], 120, 160);
      });
      expect(container.scrollTop).toBe(200);

      // The resize wave the prepend triggers must read the re-baselined anchor offset, not the
      // stale pre-extend one — re-applying the 100px delta would land scrollTop at 300, the random
      // jump.
      fire();
      expect(container.scrollTop).toBe(200);
    });

    it('re-snaps instead of compensating while a recenter is in flight', () => {
      const { fire } = installBlockResizeObserver();
      const book = makeBook(60, 0);
      Element.prototype.scrollIntoView = jest.fn();
      const { result, container, rerender } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      act(() => jest.advanceTimersByTime(16));
      stubRect(container, 0, 600);
      const wrapper = document.createElement('div');
      container.appendChild(wrapper);
      const els = mountSegmentEls(
        wrapper,
        result.current.windowSegments.map((s) => s.id),
      );
      stubRect(els[0], 10, 50);
      act(() => result.current.contentRef(wrapper));
      container.scrollTop = 100;

      // Start an external recenter; while it is in flight the observer relays each resize to the
      // re-snap handler (which pins the verse via scrollIntoView) rather than compensating, so it
      // never moves scrollTop directly — the two corrections can't fight.
      act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
      stubRect(els[0], 50, 90);
      fire();

      expect(container.scrollTop).toBe(100);
    });
  });
});
