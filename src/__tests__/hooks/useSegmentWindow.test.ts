import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment } from 'interlinearizer';
import { act, renderHook } from '@testing-library/react';
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

  it('prepends earlier segments and corrects scrollTop when the top sentinel intersects', () => {
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
    // Simulate the prepend growing the content: scrollHeight jumps by 100px across the mutation.
    Object.defineProperty(container, 'scrollHeight', { value: 100, configurable: true });
    container.scrollTop = 50;
    act(() => {
      global.triggerIntersection(top, true);
      Object.defineProperty(container, 'scrollHeight', { value: 200, configurable: true });
    });

    expect(result.current.windowSegments[0].id).not.toBe(firstBefore);
    expect(container.scrollTop).toBe(150);
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

  it('caps the mounted window at the maximum size while scrolling down', () => {
    const book = makeBook(80, 0);
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

    // Fire many extends; the window must never exceed the hard cap.
    for (let i = 0; i < 20; i += 1) {
      act(() => global.triggerIntersection(bottom, true));
    }
    expect(result.current.windowSegments.length).toBeLessThanOrEqual(30);
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
    const { result, rerender, displayContinuousScrollReports } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 1 },
      undefined,
    );
    expect(result.current.displayContinuousScroll).toBe(false);

    // Toggle continuous scroll on while triggering a recenter (external nav). The report must NOT fire
    // during the fade-out — only when the window rebuilds at the midpoint, so the parent's strip
    // mounts in the same commit.
    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 }, cont: true }));
    expect(displayContinuousScrollReports).toEqual([]);
    expect(result.current.displayContinuousScroll).toBe(false);

    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    expect(displayContinuousScrollReports).toEqual([true]);
    expect(result.current.displayContinuousScroll).toBe(true);
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

  it('re-snaps every frame for the whole re-snap window, then stops', () => {
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
    // Layout-effect snap: 1. The re-snap loop has not run a frame yet.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // The loop re-snaps on every frame — even when the scroll position is stable (jsdom has no
    // layout) — and does not stop until the re-snap window elapses, so a transient plateau can never
    // end it early. Run frames almost to the deadline.
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS - 16));
    const beforeDeadline = scrollIntoView.mock.calls.length;
    expect(beforeDeadline).toBeGreaterThan(2);

    // Once the window elapses the loop reports settled and stops scheduling further snaps.
    act(() => jest.advanceTimersByTime(16 * 10));
    const afterDeadline = scrollIntoView.mock.calls.length;
    act(() => jest.advanceTimersByTime(16 * 10));
    expect(scrollIntoView).toHaveBeenCalledTimes(afterDeadline);
    expect(afterDeadline).toBeGreaterThanOrEqual(beforeDeadline);
  });

  it('keeps re-snapping after a plateau when the layout shifts again later in the window', () => {
    const book = makeBook(60, 0);
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onSettled = jest.fn();
    const { container, rerender } = renderSegmentWindow(
      book,
      { book: 'GEN', chapterNum: 1, verseNum: 1 },
      undefined,
      onSettled,
    );
    const active = document.createElement('div');
    active.setAttribute('aria-current', 'true');
    container.appendChild(active);

    // Drain the initial-mount settle (anchor at book start → next-frame settle) before the recenter.
    act(() => jest.advanceTimersByTime(16));
    onSettled.mockClear();

    // Simulate the toggle-on layout: the snapped scrollTop plateaus at 100 for a few frames (the
    // early-exit would have quit here), then a later wave (strip/arc settling) shifts it. The loop
    // must re-snap against that later shift instead of having stopped on the plateau.
    const positions = [100, 100, 100, 100, 100, 250, 250, 250, 250];
    let readIdx = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => {
        const v = positions[Math.min(readIdx, positions.length - 1)];
        readIdx += 1;
        return v;
      },
      set: () => {},
    });

    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

    // Run out the whole window: the loop snaps every frame, so it catches the post-plateau shift.
    const callsBefore = scrollIntoView.mock.calls.length;
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsBefore + 5);
    expect(onSettled).toHaveBeenCalledTimes(1);
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

  it('fires onSettled once the mid-book mount snap loop settles', () => {
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

    // The mount snap loop re-snaps for the whole re-snap window, then reports settled. Advance past
    // the window (plus a frame to run the deadline check).
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('fires onSettled after a recenter snap loop settles', () => {
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

    // An external recenter rebuilds + snaps; settle fires again once its re-snap window elapses.
    act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));
    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16));
    expect(onSettled).toHaveBeenCalled();
  });

  it('fires onSettled once even when the layout never stops shifting during the re-snap window', () => {
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

    // scrollTop changes on every read (a layout that never plateaus). The loop ignores that — it is
    // time-bounded, not settle-detected — so it re-snaps for the whole window and reports settled
    // exactly once at the end, never stranding the loader curtain.
    let scrollTop = 0;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => {
        scrollTop += 1;
        return scrollTop;
      },
      set: () => {},
    });

    act(() => jest.advanceTimersByTime(RECENTER_FADE_MS + 16 * 5));
    expect(onSettled).toHaveBeenCalledTimes(1);
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
    const originalResizeObserver = global.ResizeObserver;

    afterEach(() => {
      global.ResizeObserver = originalResizeObserver;
    });

    /**
     * Installs a stub `ResizeObserver` that records the callback created for the scroll container,
     * so a test can fire it on demand. Returns a `fire` helper.
     *
     * @returns `fire`, which invokes the recorded observer callback inside `act`.
     */
    function installResizeObserver(): { fire: () => void } {
      let callback: ResizeObserverCallback | undefined;
      const stub: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };
      global.ResizeObserver = class implements ResizeObserver {
        /** @param cb - Stored so the test can fire it on demand. */
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }

        // eslint-disable-next-line @typescript-eslint/class-methods-use-this
        observe() {}

        // eslint-disable-next-line @typescript-eslint/class-methods-use-this
        unobserve() {}

        // eslint-disable-next-line @typescript-eslint/class-methods-use-this
        disconnect() {}
      };
      return {
        fire: () =>
          act(() => {
            callback?.([], stub);
          }),
      };
    }

    /**
     * Stubs `getBoundingClientRect` on an element to report a fixed top edge, so the observer can
     * read a deterministic top-sentinel offset.
     *
     * @param el - The element to stub.
     * @param top - The `top` value the rect should report.
     */
    function stubRectTop(el: HTMLElement, top: number): void {
      el.getBoundingClientRect = () => ({
        top,
        bottom: top,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    }

    /**
     * Renders a window anchored at the book start, drains the initial-mount settle (which clears
     * the recenter-in-flight gate), and mounts the top sentinel with a stubbed container rect.
     * Returns the hook result, container, top sentinel, and the resize `fire` helper.
     *
     * @returns The render result plus the observer `fire` helper and the top sentinel element.
     */
    function renderSettledWindow() {
      const { fire } = installResizeObserver();
      const book = makeBook(60, 0);
      const { result, container } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      // Anchor at book start needs no mount snap, so the next frame clears recenterInFlight.
      act(() => jest.advanceTimersByTime(16));
      stubRectTop(container, 0);
      const top = document.createElement('div');
      container.appendChild(top);
      act(() => result.current.topSentinelRef(top));
      return { result, container, top, fire };
    }

    it('adds the above-viewport growth delta to scrollTop so the visible content holds still', () => {
      const { container, top, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // Seed the baseline offset, then grow content above the viewport: the sentinel's top edge moves
      // up by 30px (more negative), so the visible content would shift down 30px without correction.
      stubRectTop(top, -50);
      fire();
      stubRectTop(top, -80);
      fire();

      expect(container.scrollTop).toBe(130);
    });

    it('does not compensate while the list is scrolled to the very top', () => {
      const { container, top, fire } = renderSettledWindow();
      container.scrollTop = 0;

      stubRectTop(top, 0);
      fire();
      stubRectTop(top, -30);
      fire();

      expect(container.scrollTop).toBe(0);
    });

    it('does not compensate when the top-sentinel offset is unchanged', () => {
      const { container, top, fire } = renderSettledWindow();
      container.scrollTop = 100;

      stubRectTop(top, -50);
      fire();
      // Same offset: no height changed above the viewport, so scrollTop is left alone.
      fire();

      expect(container.scrollTop).toBe(100);
    });

    it('re-seeds instead of compensating when the container itself resizes (strip mount/unmount)', () => {
      const { container, top, fire } = renderSettledWindow();
      container.scrollTop = 100;

      // Seed the baseline at the current container height (jsdom reports 0 by default).
      stubRectTop(top, -50);
      fire();

      // The continuous-scroll strip mounts above the list: the container's own height shrinks AND the
      // sentinel offset shifts. That offset move is not above-viewport segment growth, so the observer
      // must re-seed (leave scrollTop alone) rather than "correcting" the phantom shift.
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 80 });
      stubRectTop(top, -90);
      fire();

      expect(container.scrollTop).toBe(100);

      // Once the container height is stable again, ordinary above-viewport growth compensates as usual.
      stubRectTop(top, -120);
      fire();
      expect(container.scrollTop).toBe(130);
    });

    it('stands down while a recenter is in flight so it never fights the re-snap loop', () => {
      const { fire } = installResizeObserver();
      const book = makeBook(60, 0);
      Element.prototype.scrollIntoView = jest.fn();
      const { result, container, rerender } = renderSegmentWindow(book, {
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      act(() => jest.advanceTimersByTime(16));
      stubRectTop(container, 0);
      const top = document.createElement('div');
      container.appendChild(top);
      act(() => result.current.topSentinelRef(top));
      container.scrollTop = 100;
      stubRectTop(top, -50);
      fire();

      // Start an external recenter; while its fade + re-snap loop is in flight the observer must not
      // also move scrollTop, or the two corrections would fight.
      act(() => rerender({ b: book, ref: { book: 'GEN', chapterNum: 1, verseNum: 50 } }));
      stubRectTop(top, -90);
      fire();

      expect(container.scrollTop).toBe(100);
    });
  });
});
