/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
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

const CONFIG: HeightConfig = {
  displayMode: 'token-chip',
  showMorphology: true,
  showFreeTranslation: false,
  showVerseGutter: false,
};

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

/** The container the hook scopes its DOM reads to; a test mounts a wrap box inside. */
let container: HTMLElement;

type RenderProps = { book: Book; config: HeightConfig };

/** Renders the hook against a container whose measured wrap width the test controls. */
function renderSegmentHeights(book: Book, wrapWidth: number, config: HeightConfig = CONFIG) {
  stubRect(container, { width: wrapWidth });
  return renderHook(
    (props: RenderProps) => {
      const containerRef = useRef<HTMLElement | undefined>(container);
      return useSegmentHeights({ ...props, containerRef });
    },
    { initialProps: { book, config } },
  );
}

/** Every callback handed to a ResizeObserver the hook constructed. */
let resizeCallbacks: ResizeObserverCallback[] = [];

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
  resizeCallbacks = [];
  class StubResizeObserver implements ResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    observe() {}

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
  it('predicts a height for every segment in the book', () => {
    const { result } = renderSegmentHeights(makeBook(6), 300);
    expect(result.current.heights).toHaveLength(6);
  });

  it('reports a total that spans the whole book', () => {
    const { result } = renderSegmentHeights(makeBook(6), 300);
    expect(result.current.total).toBe(132 * 6);
  });

  it('wraps against the mounted content column rather than the padded scroll container', () => {
    // The container is wide enough for one row; the column inside it is not.
    const wrapBox = document.createElement('div');
    wrapBox.setAttribute('data-wrap-box', '');
    stubRect(wrapBox, { width: 300 });
    container.append(wrapBox);
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);

    expect(result.current.heights[0]).toBe(256);
  });

  it('falls back to the scroll container before any segment has mounted', () => {
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);

    expect(result.current.heights[0]).toBe(132);
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
    expect(result.current.heights[0]).toBe(132);

    stubRect(wrapBox, { width: 300 });
    rerender({ book, config: { ...CONFIG, showVerseGutter: true } });

    expect(result.current.heights[0]).toBe(256);
  });

  it('keeps the same table across a re-render that changes nothing', () => {
    const book = makeBook(5);
    const { result, rerender } = renderSegmentHeights(book, 300);
    const first = result.current;
    rerender({ book, config: CONFIG });
    expect(result.current).toBe(first);
  });

  it('rebuilds the table when the book changes', () => {
    const { result, rerender } = renderSegmentHeights(makeBook(5), 300);
    const first = result.current;
    rerender({ book: makeBook(7), config: CONFIG });
    expect(result.current).not.toBe(first);
    expect(result.current.heights).toHaveLength(7);
  });

  it('rebuilds the table when a view toggle changes the geometry', () => {
    const book = makeBook(3);
    const { result, rerender } = renderSegmentHeights(book, 300);
    rerender({ book, config: { ...CONFIG, showMorphology: false } });
    expect(result.current.heights[0]).toBe(90);
  });

  it('rebuilds the table when the container width changes', () => {
    // Narrowing the container wraps the chips onto a second row, so the segment grows taller.
    const { result } = renderSegmentHeights(wideSegmentBook(), 1000);
    expect(result.current.heights[0]).toBe(132);

    stubRect(container, { width: 300 });
    fireResize([container]);

    expect(result.current.heights[0]).toBe(256);
  });

  it('keeps the same table when a resize leaves the width unchanged', () => {
    const { result } = renderSegmentHeights(makeBook(3), 300);
    const first = result.current;

    fireResize([container]);

    expect(result.current).toBe(first);
  });
});
