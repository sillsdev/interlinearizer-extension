/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import { useRef } from 'react';
import useSegmentHeights from '../../hooks/useSegmentHeights';
import type { HeightConfig } from '../../utils/segment-heights';
import { makeSegment, makeWordToken } from '../test-helpers';

// The measurer reads live chip styles, which jsdom does not lay out; stub it so the hook's own
// behavior — when it rebuilds, and what it feeds the table — is what these tests exercise.
jest.mock('../../utils/chip-measurer', () => ({
  // Pass-through, so a cached measurement cannot mask which forms the hook measures.
  cacheMeasurer: jest.fn((measure: (text: string) => number) => measure),
  readChipMetrics: jest.fn(() => ({ font: '14px mono', floorPx: 0, padPx: 0 })),
  readBaselineMetrics: jest.fn(() => ({ font: '14px mono', floorPx: 0, padPx: 0 })),
  createChipMeasurer: jest.fn(() => () => 100),
  createTextMeasurer: jest.fn(() => () => 100),
  getTextMetricsSource: jest.fn(() => ({ font: '', measureText: () => ({ width: 100 }) })),
}));

const chipMeasurerMock: {
  cacheMeasurer: jest.Mock;
  readChipMetrics: jest.Mock;
  readBaselineMetrics: jest.Mock;
  createChipMeasurer: jest.Mock;
  createTextMeasurer: jest.Mock;
  getTextMetricsSource: jest.Mock;
} = jest.requireMock('../../utils/chip-measurer');

/** Builds a book whose segments each carry one word token. */
function makeBook(count: number): Book {
  return {
    id: 'PSA',
    bookRef: 'PSA',
    textVersion: 'v1',
    duplicateVerseIds: [],
    segments: Array.from({ length: count }, (_unused, i) =>
      makeSegment(`PSA 1:${i + 1}`, 'a', [makeWordToken(`PSA 1:${i + 1}:0`, 'a')]),
    ),
  };
}

const CONFIG = {
  displayMode: 'token-chip',
  showMorphology: true,
  showFreeTranslation: false,
  showVerseGutter: false,
} as const;

/** Stubs an element's measured width, which jsdom otherwise reports as zero. */
function stubWidth(el: HTMLElement, width: number) {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width,
    height: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

/** A one-segment book whose four chips fit one row of a wide box but wrap inside a narrow one. */
function wideSegmentBook(): Book {
  return {
    id: 'PSA',
    bookRef: 'PSA',
    textVersion: 'v1',
    duplicateVerseIds: [],
    segments: [
      makeSegment(
        'PSA 1:1',
        'a b c d',
        ['a', 'b', 'c', 'd'].map((t, i) => makeWordToken(`PSA 1:1:${i}`, t)),
      ),
    ],
  };
}

/** The container the hook scopes its DOM reads to; a test mounts its segments and chips inside. */
let container: HTMLElement;

/** Renders the hook against a container whose measured wrap width the test controls. */
function renderSegmentHeights(book: Book, wrapWidth: number, config: HeightConfig = CONFIG) {
  stubWidth(container, wrapWidth);
  return renderHook(() => {
    const containerRef = useRef<HTMLElement | undefined>(container);
    return useSegmentHeights({ book, config, containerRef });
  });
}

/** Animation-frame callbacks the hook has queued but not yet run. */
let pendingFrames: FrameRequestCallback[] = [];

/**
 * Runs the animation frame the hook defers its segment measurement to, so the measured heights are
 * in state by the time the assertion reads them.
 */
function flushMeasurement() {
  const frames = pendingFrames;
  pendingFrames = [];
  act(() => {
    frames.forEach((frame) => frame(0));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  chipMeasurerMock.cacheMeasurer.mockImplementation((measure: (text: string) => number) => measure);
  pendingFrames = [];
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((frame) => {
    pendingFrames.push(frame);
    return pendingFrames.length;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  container.remove();
});

describe('useSegmentHeights', () => {
  beforeEach(() => {
    chipMeasurerMock.readChipMetrics.mockReturnValue({ font: '14px mono', floorPx: 0, padPx: 0 });
    chipMeasurerMock.createChipMeasurer.mockReturnValue(() => 100);
    chipMeasurerMock.getTextMetricsSource.mockReturnValue({
      font: '',
      measureText: () => ({ width: 100 }),
    });
  });

  it('predicts a height for every segment in the book, not only the mounted ones', () => {
    const { result } = renderSegmentHeights(makeBook(40), 300);
    expect(result.current.table.heights).toHaveLength(40);
  });

  it('reports a total that spans the whole book', () => {
    const { result } = renderSegmentHeights(makeBook(10), 300);
    expect(result.current.table.total).toBe(
      result.current.table.heights.reduce((a, b) => a + b, 0),
    );
  });

  it('wraps against the mounted content column rather than the padded scroll container', () => {
    // Insets sit between the two boxes, so measuring the container over-reports the room chips have.
    stubWidth(container, 1000);
    const wrapBox = document.createElement('div');
    wrapBox.setAttribute('data-wrap-box', '');
    stubWidth(wrapBox, 300);
    container.appendChild(wrapBox);

    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentHeights({ book: wideSegmentBook(), config: CONFIG, containerRef });
    });

    // Four 100px chips plus their gaps need 496px: one row inside 1000px, two inside 300px.
    expect(result.current.table.heights).toEqual([256]);
  });

  it('falls back to the scroll container before any segment has mounted', () => {
    stubWidth(container, 1000);

    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentHeights({ book: wideSegmentBook(), config: CONFIG, containerRef });
    });

    expect(result.current.table.heights).toEqual([132]);
  });

  it('rebuilds the table when the verse gutter is toggled', () => {
    // The gutter narrows where rows wrap while leaving the container the same size, so no resize
    // announces it. The book is hoisted so its identity cannot rebuild the table instead.
    const book = makeBook(3);
    const { result, rerender } = renderHook(
      ({ showVerseGutter }: { showVerseGutter: boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(undefined);
        if (!containerRef.current) containerRef.current = document.createElement('div');
        return useSegmentHeights({
          book,
          config: { ...CONFIG, showVerseGutter },
          containerRef,
        });
      },
      { initialProps: { showVerseGutter: false } },
    );
    const first = result.current.table;
    rerender({ showVerseGutter: false });
    expect(result.current.table).toBe(first);
    rerender({ showVerseGutter: true });
    expect(result.current.table).not.toBe(first);
  });

  it('reads its font from a mounted baseline run rather than from a chip', () => {
    // Baseline mode mounts no chip, so it measures the run it does render.
    const run = document.createElement('span');
    run.setAttribute('data-baseline-run', '');
    container.append(run);

    renderSegmentHeights(makeBook(2), 300, { ...CONFIG, displayMode: 'baseline-text' });

    expect(chipMeasurerMock.readBaselineMetrics).toHaveBeenCalledWith(run);
    expect(chipMeasurerMock.readChipMetrics).not.toHaveBeenCalled();
    run.remove();
  });

  it('keeps the same table across a re-render that changes nothing', () => {
    const { result, rerender } = renderSegmentHeights(makeBook(5), 300);
    const first = result.current.table;
    rerender();
    expect(result.current.table).toBe(first);
  });

  it('rebuilds the table when the book changes', () => {
    const { result, rerender } = renderHook(
      ({ book }: { book: Book }) => {
        const containerRef = useRef<HTMLElement | undefined>(undefined);
        if (!containerRef.current) containerRef.current = document.createElement('div');
        return useSegmentHeights({ book, config: CONFIG, containerRef });
      },
      { initialProps: { book: makeBook(3) } },
    );
    const first = result.current.table;
    rerender({ book: makeBook(7) });
    expect(result.current.table).not.toBe(first);
    expect(result.current.table.heights).toHaveLength(7);
  });

  it('rebuilds the table when a view toggle changes the geometry', () => {
    const { result, rerender } = renderHook(
      ({ showMorphology }: { showMorphology: boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(undefined);
        if (!containerRef.current) containerRef.current = document.createElement('div');
        return useSegmentHeights({
          book: makeBook(3),
          config: { ...CONFIG, showMorphology },
          containerRef,
        });
      },
      { initialProps: { showMorphology: true } },
    );
    const withMorphology = result.current.table.total;
    rerender({ showMorphology: false });
    expect(result.current.table.total).toBeLessThan(withMorphology);
  });
});

describe('useSegmentHeights drift reporting', () => {
  /**
   * Mounts segment elements whose measured heights the test controls, starting at the book segment
   * `from` indexes so a second batch can mount alongside a first rather than in place of it.
   */
  function mountSegments(heights: readonly number[], from = 0) {
    heights.forEach((height, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-segment-id', `PSA 1:${from + i + 1}`);
      jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 0,
        height,
        top: 0,
        left: 0,
        right: 0,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      container.append(el);
    });
  }

  it('warns when a mounted segment lays out taller than predicted', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    // A measured height far from anything the predictor produces for this fixture.
    mountSegments([500]);
    renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('height'));
  });

  it('ignores a mounted element whose segment is not in the book', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    // A stale element from a previously-loaded book lingers in the DOM.
    const stale = document.createElement('div');
    stale.setAttribute('data-segment-id', 'GEN 9:9');
    jest.spyOn(stale, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 999,
      top: 0,
      left: 0,
      right: 0,
      bottom: 999,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    container.append(stale);
    renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the mounted segments match their predictions', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mountSegments([132]);
    renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(warn).not.toHaveBeenCalled();
  });

  it('names a later segment as the worst when it drifts furthest', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mountSegments([200, 500]);
    renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('index 1'));
  });

  it('names an earlier segment as the worst when it drifts furthest', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mountSegments([500, 200]);
    renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('index 0'));
  });

  it('re-predicts the book only for the table the list reads, not again for the drift check', async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    // The predicted table spans the whole book, so a rebuild re-measures every chip in it. Each
    // segment carries its own surface form, so no cache inside one build hides a second build.
    const book: Book = {
      id: 'PSA',
      bookRef: 'PSA',
      textVersion: 'v1',
      duplicateVerseIds: [],
      segments: ['a', 'b', 'c'].map((text, i) =>
        makeSegment(`PSA 1:${i + 1}`, text, [makeWordToken(`PSA 1:${i + 1}:0`, text)]),
      ),
    };
    const measured: string[] = [];
    chipMeasurerMock.readChipMetrics.mockReturnValue({ font: '14px mono', floorPx: 0, padPx: 0 });
    chipMeasurerMock.getTextMetricsSource.mockReturnValue({
      font: '',
      measureText: () => ({ width: 100 }),
    });
    chipMeasurerMock.createChipMeasurer.mockReturnValue((surfaceText: string) => {
      measured.push(surfaceText);
      return 100;
    });
    mountSegments([500]);
    // The measurer is only reached for a chip the hook can sample metrics from.
    container.querySelector('[data-segment-id]')?.append(document.createElement('label'));
    stubWidth(container, 300);
    renderHook(() => {
      const containerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentHeights({ book, config: CONFIG, containerRef });
    });
    flushMeasurement();
    const afterFirst = measured.length;

    // A second segment mounting produces another measurement under the same layout. The mutation
    // observer that notices it delivers on a microtask, so the flush has to follow one.
    mountSegments([501], 1);
    await act(async () => {});
    flushMeasurement();

    // One pass over the book's forms: rebuilding the drift check's table too would take a second.
    expect(measured.length).toBe(afterFirst + book.segments.length);
  });
});

describe('useSegmentHeights measured segments', () => {
  /** Mounts a segment element reporting the given laid-out height. */
  function mountSegment(id: string, height: number) {
    const el = document.createElement('div');
    el.setAttribute('data-segment-id', id);
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    container.append(el);
    return el;
  }

  it('takes a laid-out segment at its measured height', () => {
    // A height far from anything the predictor produces for this fixture, so it can only be read.
    mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('keeps predicting the segments that have not laid out', () => {
    mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    expect(result.current.table.heights[1]).toBe(132);
  });

  it('keeps a culled segment at its last real height rather than collapsing it', () => {
    // A segment the window has unmounted reports zero, which is not a height it ever laid out to.
    const el = mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('keeps the same table when a re-measure finds every height unchanged', async () => {
    mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    const first = result.current.table;

    // A mutation the window makes that leaves every measured height where it was.
    container.append(document.createElement('div'));
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('skips a segment culled between being flagged and being measured', async () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    const first = result.current.table;

    // Mounted (so the mutation flags it) and then detached before the deferred read runs, which is
    // the window culling a segment in the frame it was added.
    const el = mountSegment('PSA 1:1', 500);
    await act(async () => {});
    el.remove();
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('ignores an added node that is not an element', async () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    const first = result.current.table;

    // Text nodes are added all over a rendered list and can carry no segment height.
    container.append(document.createTextNode('text'));
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('measures a segment added as the mutated node itself', async () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    // The added node carries [data-segment-id] directly, rather than wrapping one.
    mountSegment('PSA 1:1', 500);
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('keeps the table when a flagged segment re-measures to the height it already had', async () => {
    const el = mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    const first = result.current.table;

    // Re-flagged by a later mutation but still the same height, so nothing about the table changes.
    el.append(document.createElement('span'));
    container.append(el);
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('measures a segment mounted inside an added subtree', async () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    // The window mounts segments inside a wrapper, so the added node is the wrapper, not the
    // segment itself.
    const wrapper = document.createElement('div');
    const el = document.createElement('div');
    el.setAttribute('data-segment-id', 'PSA 1:1');
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 500,
      top: 0,
      left: 0,
      right: 0,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    wrapper.append(el);
    container.append(wrapper);
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('discards its measurements when a display toggle changes them', () => {
    // A height measured with morphology shown says nothing about the same segment without it.
    mountSegment('PSA 1:1', 500);
    const book = makeBook(3);
    const { result, rerender } = renderHook(
      ({ showMorphology }: { showMorphology: boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(container);
        return useSegmentHeights({ book, config: { ...CONFIG, showMorphology }, containerRef });
      },
      { initialProps: { showMorphology: true } },
    );
    flushMeasurement();
    rerender({ showMorphology: false });

    expect(result.current.table.heights[0]).toBe(90);
  });

  it('discards its measurements when the book replaces segments that reuse their ids', () => {
    // Two builds of the same fixture stand in for a retokenization: equal ids, fresh segments.
    mountSegment('PSA 1:1', 500);
    const { result, rerender } = renderHook(
      ({ book }: { book: Book }) => {
        const containerRef = useRef<HTMLElement | undefined>(container);
        return useSegmentHeights({ book, config: CONFIG, containerRef });
      },
      { initialProps: { book: makeBook(3) } },
    );
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(500);

    rerender({ book: makeBook(3) });

    expect(result.current.table.heights[0]).toBe(132);
  });

  it('discards its measurements when a segment gains or loses its free translation', () => {
    // The read-only view omits the field for a segment that has none, so a segment entering or
    // leaving that set changes its height without any toggle moving.
    mountSegment('PSA 1:1', 500);
    const book = makeBook(3);
    const { result, rerender } = renderHook(
      ({ hasFreeTranslation }: { hasFreeTranslation: (index: number) => boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(container);
        return useSegmentHeights({
          book,
          config: { ...CONFIG, showFreeTranslation: true, hasFreeTranslation },
          containerRef,
        });
      },
      { initialProps: { hasFreeTranslation: (): boolean => false } },
    );
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(500);

    rerender({ hasFreeTranslation: () => true });

    expect(result.current.table.heights[0]).toBe(132 + 34);
  });

  it('never exposes a table mixing the new toggles with measurements from the old ones', () => {
    // Asserts on every render, not the settled one: a discard deferred to an effect is invisible
    // once effects have flushed.
    mountSegment('PSA 1:1', 500);
    const book = makeBook(3);
    const tables: number[][] = [];
    const { rerender } = renderHook(
      ({ showMorphology }: { showMorphology: boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(container);
        const result = useSegmentHeights({
          book,
          config: { ...CONFIG, showMorphology },
          containerRef,
        });
        tables.push([...result.table.heights]);
        return result;
      },
      { initialProps: { showMorphology: true } },
    );
    flushMeasurement();
    tables.length = 0;
    rerender({ showMorphology: false });

    expect(tables).toEqual([[90, 90, 90]]);
  });

  it('re-measures when the window mounts a different set of segments', async () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(132);

    mountSegment('PSA 1:1', 500);
    // Mutation records are delivered on a microtask, so yield before the frame runs.
    await act(async () => {});
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });
});

describe('useSegmentHeights on container resize', () => {
  /** Installs a ResizeObserver stub, returning a trigger that reports a new container width. */
  function stubResizeObserver() {
    const original = global.ResizeObserver;
    // The hook constructs more than one observer; fire them all, since the test cares about the
    // width re-read rather than about which observer announced the resize.
    const callbacks: ResizeObserverCallback[] = [];
    const stub: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };
    class StubResizeObserver implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      observe() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      unobserve() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      disconnect() {}
    }
    global.ResizeObserver = StubResizeObserver;
    return {
      fire: () => {
        act(() => {
          callbacks.forEach((cb) => cb([], stub));
        });
      },
      restore: () => {
        global.ResizeObserver = original;
      },
    };
  }

  it('rebuilds the table when the container width changes', () => {
    const observer = stubResizeObserver();
    try {
      const el = document.createElement('div');
      let width = 1000;
      jest.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));
      // Six chips per segment, so the wrap width genuinely decides how many rows each takes.
      const book = {
        id: 'PSA',
        bookRef: 'PSA',
        textVersion: 'v1',
        duplicateVerseIds: [],
        segments: Array.from({ length: 8 }, (_unused, i) =>
          makeSegment(
            `PSA 1:${i + 1}`,
            'a b c d e f',
            Array.from({ length: 6 }, (_u, t) => makeWordToken(`PSA 1:${i + 1}:${t}`, `w${t}`)),
          ),
        ),
      };
      const { result } = renderHook(() => {
        const containerRef = useRef<HTMLElement | undefined>(el);
        return useSegmentHeights({ book, config: CONFIG, containerRef });
      });
      const wide = result.current.table.total;

      // Narrowing the container wraps more chips onto extra rows, so the book grows taller.
      width = 300;
      observer.fire();

      expect(result.current.table.total).toBeGreaterThan(wide);
    } finally {
      observer.restore();
    }
  });
});

describe('useSegmentHeights memoization', () => {
  beforeEach(() => {
    chipMeasurerMock.readChipMetrics.mockReturnValue({ font: '14px mono', floorPx: 0, padPx: 0 });
    chipMeasurerMock.createChipMeasurer.mockReturnValue(() => 100);
    chipMeasurerMock.getTextMetricsSource.mockReturnValue({
      font: '',
      measureText: () => ({ width: 100 }),
    });
  });

  it('keeps the same table when the caller passes a fresh config object of equal value', () => {
    const book = makeBook(5);
    const { result, rerender } = renderHook(() => {
      const containerRef = useRef<HTMLElement | undefined>(undefined);
      if (!containerRef.current) containerRef.current = document.createElement('div');
      // A caller that builds its config inline hands a new object every render.
      return useSegmentHeights({
        book,
        config: {
          displayMode: 'token-chip',
          showMorphology: true,
          showFreeTranslation: false,
          showVerseGutter: false,
        },
        containerRef,
      });
    });
    const first = result.current.table;
    rerender();
    expect(result.current.table).toBe(first);
  });
});

describe('useSegmentHeights before a chip is mounted', () => {
  it('still predicts a height for every segment when no chip can be measured', () => {
    // No [data-segment-id] label exists on first render, so the measurer has nothing to read.
    chipMeasurerMock.readChipMetrics.mockReturnValue(undefined);
    const { result } = renderSegmentHeights(makeBook(6), 300);
    expect(result.current.table.heights).toHaveLength(6);
    expect(result.current.table.total).toBeGreaterThan(0);
  });
});

describe('useSegmentHeights with a mounted chip', () => {
  /** Mounts a chip the hook's DOM query finds, so it measures rather than assuming a width. */
  function mountChip() {
    const segment = document.createElement('div');
    segment.setAttribute('data-segment-id', 'PSA 1:1');
    segment.append(document.createElement('label'));
    container.append(segment);
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('measures chip widths when a chip is mounted to read', () => {
    mountChip();
    chipMeasurerMock.createChipMeasurer.mockReturnValue(() => 100);
    chipMeasurerMock.readChipMetrics.mockReturnValue({ font: '14px mono', floorPx: 0, padPx: 0 });
    chipMeasurerMock.getTextMetricsSource.mockReturnValue({
      font: '',
      measureText: () => ({ width: 100 }),
    });
    renderSegmentHeights(makeBook(4), 300);
    expect(chipMeasurerMock.createChipMeasurer).toHaveBeenCalled();
  });

  it('predicts heights from an assumed chip width when the host measures no text', () => {
    mountChip();
    chipMeasurerMock.readChipMetrics.mockReturnValue({ font: '14px mono', floorPx: 0, padPx: 0 });
    chipMeasurerMock.getTextMetricsSource.mockReturnValue(undefined);
    const { result } = renderSegmentHeights(makeBook(4), 300);
    expect(result.current.table.heights).toHaveLength(4);
    expect(result.current.table.total).toBeGreaterThan(0);
  });
});
