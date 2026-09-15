/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { Book, Segment } from 'interlinearizer';
import { useRef } from 'react';
import useSegmentHeights from '../../hooks/useSegmentHeights';
import type { HeightConfig } from '../../utils/segment-heights';
import { makeSegment, makeWordToken } from '../test-helpers';

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

/** Stubs an element's measured box, which jsdom otherwise reports as zero. */
function stubRect(el: Element, { width = 0, height = 0 } = {}) {
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
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

/** The container the hook scopes its DOM reads to; a test mounts its segments inside. */
let container: HTMLElement;

/** Mounts a segment element reporting the given laid-out height. */
function mountSegment(id: string, height: number) {
  const el = document.createElement('div');
  el.setAttribute('data-segment-id', id);
  stubRect(el, { height });
  container.append(el);
  return el;
}

type RenderProps = { book: Book; config: HeightConfig; windowSegments: readonly Segment[] };

/**
 * Renders the hook against a container whose measured wrap width the test controls. Every segment
 * counts as mounted unless the test says otherwise, so a rerender with a fresh `windowSegments`
 * array is how a test tells the hook the window changed.
 */
function renderSegmentHeights(
  book: Book,
  wrapWidth: number,
  config: HeightConfig = CONFIG,
  windowSegments: readonly Segment[] = book.segments,
) {
  stubRect(container, { width: wrapWidth });
  return renderHook(
    (props: RenderProps) => {
      const containerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentHeights({ ...props, containerRef });
    },
    { initialProps: { book, config, windowSegments } },
  );
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

/** Every callback handed to a ResizeObserver the hook constructed. */
let resizeCallbacks: ResizeObserverCallback[] = [];

/** Elements each ResizeObserver the hook constructed has been asked to observe. */
let observedElements: Element[] = [];

const resizeObserverStub: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };

/** Fires every ResizeObserver callback with an entry for each of `targets`. */
function fireResize(targets: Element[]) {
  const entries: ResizeObserverEntry[] = targets.map((target) => ({
    target,
    contentRect: target.getBoundingClientRect(),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  }));
  act(() => {
    resizeCallbacks.forEach((cb) => cb(entries, resizeObserverStub));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  pendingFrames = [];
  resizeCallbacks = [];
  observedElements = [];
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((frame) => {
    pendingFrames.push(frame);
    return pendingFrames.length;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  class StubResizeObserver implements ResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    observe(el: Element) {
      observedElements.push(el);
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    unobserve() {}

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    disconnect() {}
  }
  global.ResizeObserver = StubResizeObserver;
});

afterEach(() => {
  container.remove();
});

describe('useSegmentHeights', () => {
  it('predicts a height for every segment in the book, not only the mounted ones', () => {
    const { result } = renderSegmentHeights(makeBook(6), 300, CONFIG, []);
    expect(result.current.table.heights).toHaveLength(6);
  });

  it('reports a total that spans the whole book', () => {
    const { result } = renderSegmentHeights(makeBook(6), 300, CONFIG, []);
    expect(result.current.table.total).toBe(132 * 6);
  });

  it('wraps against the mounted content column rather than the padded scroll container', () => {
    // The container is wide enough for one row; the column inside it is not.
    const wrapBox = document.createElement('div');
    wrapBox.setAttribute('data-wrap-box', '');
    stubRect(wrapBox, { width: 300 });
    container.append(wrapBox);
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);

    expect(result.current.table.heights[0]).toBe(256);
  });

  it('falls back to the scroll container before any segment has mounted', () => {
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);

    expect(result.current.table.heights[0]).toBe(132);
  });

  it('rebuilds the table when the verse gutter is toggled', () => {
    // The gutter narrows the wrap box without resizing the container, so the toggle itself has to
    // trigger the re-read.
    const wrapBox = document.createElement('div');
    wrapBox.setAttribute('data-wrap-box', '');
    stubRect(wrapBox, { width: 1000 });
    container.append(wrapBox);
    const book = wideSegmentBook();
    const { result, rerender } = renderSegmentHeights(book, 1000);
    expect(result.current.table.heights[0]).toBe(132);

    stubRect(wrapBox, { width: 300 });
    rerender({
      book,
      config: { ...CONFIG, showVerseGutter: true },
      windowSegments: book.segments,
    });

    expect(result.current.table.heights[0]).toBe(256);
  });

  it('keeps the same table across a re-render that changes nothing', () => {
    const book = makeBook(5);
    const { result, rerender } = renderSegmentHeights(book, 300);
    const first = result.current.table;
    rerender({ book, config: CONFIG, windowSegments: book.segments });
    expect(result.current.table).toBe(first);
  });

  it('keeps the same table when the caller passes a fresh config object of equal value', () => {
    const book = makeBook(5);
    const { result, rerender } = renderSegmentHeights(book, 300);
    const first = result.current.table;
    // A caller that builds its config inline hands a new object every render.
    rerender({ book, config: { ...CONFIG }, windowSegments: book.segments });
    expect(result.current.table).toBe(first);
  });

  it('rebuilds the table when the book changes', () => {
    const { result, rerender } = renderSegmentHeights(makeBook(5), 300);
    const first = result.current.table;
    const longer = makeBook(7);
    rerender({ book: longer, config: CONFIG, windowSegments: longer.segments });
    expect(result.current.table).not.toBe(first);
    expect(result.current.table.heights).toHaveLength(7);
  });

  it('rebuilds the table when a view toggle changes the geometry', () => {
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300);
    rerender({
      book,
      config: { ...CONFIG, showMorphology: false },
      windowSegments: book.segments,
    });
    expect(result.current.table.heights[0]).toBe(90);
  });

  it('rebuilds the table when the container width changes', () => {
    // Narrowing the container wraps the chips onto a second row, so the segment grows taller.
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);
    expect(result.current.table.heights[0]).toBe(132);

    stubRect(container, { width: 300 });
    fireResize([container]);

    expect(result.current.table.heights[0]).toBe(256);
  });
});

describe('useSegmentHeights measured segments', () => {
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

  it('observes every mounted segment for later height changes', () => {
    const first = mountSegment('PSA 1:1', 500);
    const second = mountSegment('PSA 1:2', 500);
    renderSegmentHeights(makeBook(3), 300);

    expect(observedElements).toEqual(expect.arrayContaining([first, second]));
  });

  it('re-measures a mounted segment the observer reports resized', () => {
    const el = mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();

    stubRect(el, { height: 700 });
    fireResize([el]);
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(700);
  });

  it('keeps a culled segment at its last real height rather than collapsing it', () => {
    // A segment the window has unmounted reports zero, which is not a height it ever laid out to.
    const el = mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    stubRect(el, { height: 0 });
    fireResize([el]);
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('keeps the same table when a re-measure finds every height unchanged', () => {
    const el = mountSegment('PSA 1:1', 500);
    const { result } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    const first = result.current.table;

    fireResize([el]);
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('skips a segment culled between being flagged and being measured', () => {
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300, CONFIG, []);
    flushMeasurement();
    const first = result.current.table;

    // Mounted (so the window change flags it) and then detached before the deferred read runs,
    // which is the window culling a segment in the frame it was added.
    const el = mountSegment('PSA 1:1', 500);
    rerender({ book, config: CONFIG, windowSegments: [...book.segments] });
    el.remove();
    flushMeasurement();

    expect(result.current.table).toBe(first);
  });

  it('re-measures when the window mounts a different set of segments', () => {
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300, CONFIG, []);
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(132);

    mountSegment('PSA 1:1', 500);
    rerender({ book, config: CONFIG, windowSegments: [...book.segments] });
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });

  it('leaves a newly mounted segment unmeasured until the window reports a change', () => {
    const book = makeBook(3);
    const nothingMounted: Segment[] = [];
    const { result, rerender } = renderSegmentHeights(book, 300, CONFIG, nothingMounted);
    flushMeasurement();

    mountSegment('PSA 1:1', 500);
    rerender({ book, config: CONFIG, windowSegments: nothingMounted });
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(132);
  });

  it('discards its measurements when a display toggle changes them', () => {
    // A height measured with morphology shown says nothing about the same segment without it.
    mountSegment('PSA 1:1', 500);
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300);
    flushMeasurement();
    rerender({
      book,
      config: { ...CONFIG, showMorphology: false },
      windowSegments: book.segments,
    });

    expect(result.current.table.heights[0]).toBe(90);
  });

  it('discards its measurements when the book replaces segments that reuse their ids', () => {
    // Two builds of the same fixture stand in for a retokenization: equal ids, fresh segments.
    mountSegment('PSA 1:1', 500);
    const { result, rerender } = renderSegmentHeights(makeBook(3), 300);
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(500);

    const retokenized = makeBook(3);
    rerender({ book: retokenized, config: CONFIG, windowSegments: retokenized.segments });

    expect(result.current.table.heights[0]).toBe(132);
  });

  it('never exposes a table mixing the new toggles with measurements from the old ones', () => {
    // Asserts on every render, not the settled one: a discard deferred to an effect is invisible
    // once effects have flushed.
    mountSegment('PSA 1:1', 500);
    const book = makeBook(3);
    const tables: number[][] = [];
    stubRect(container, { width: 300 });
    const { rerender } = renderHook(
      ({ showMorphology }: { showMorphology: boolean }) => {
        const containerRef = useRef<HTMLElement | undefined>(container);
        const result = useSegmentHeights({
          book,
          config: { ...CONFIG, showMorphology },
          containerRef,
          windowSegments: book.segments,
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

  it('keeps its measurements across a window change under the same layout', () => {
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300);
    mountSegment('PSA 1:1', 500);
    rerender({ book, config: CONFIG, windowSegments: [...book.segments] });
    flushMeasurement();
    expect(result.current.table.heights[0]).toBe(500);

    container.replaceChildren();
    rerender({ book, config: CONFIG, windowSegments: [] });
    flushMeasurement();

    expect(result.current.table.heights[0]).toBe(500);
  });
});
