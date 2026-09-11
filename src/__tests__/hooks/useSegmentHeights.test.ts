/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import { useRef } from 'react';
import useSegmentHeights from '../../hooks/useSegmentHeights';
import { makeSegment, makeWordToken } from '../test-helpers';

// The measurer reads live chip styles, which jsdom does not lay out; stub it so the hook's own
// behavior — when it rebuilds, and what it feeds the table — is what these tests exercise.
jest.mock('../../utils/chip-measurer', () => ({
  readChipMetrics: jest.fn(() => ({ font: '14px mono', floorPx: 0, padPx: 0 })),
  createChipMeasurer: jest.fn(() => () => 100),
  getTextMetricsSource: jest.fn(() => ({ font: '', measureText: () => ({ width: 100 }) })),
}));

const chipMeasurerMock: {
  readChipMetrics: jest.Mock;
  createChipMeasurer: jest.Mock;
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
} as const;

/** Renders the hook against a container whose measured wrap width the test controls. */
function renderSegmentHeights(book: Book, wrapWidth: number, config = CONFIG) {
  return renderHook(() => {
    const containerRef = useRef<HTMLElement | undefined>(undefined);
    if (!containerRef.current) {
      const el = document.createElement('div');
      jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: wrapWidth,
        height: 0,
        top: 0,
        left: 0,
        right: wrapWidth,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      containerRef.current = el;
    }
    return useSegmentHeights({ book, config, containerRef });
  });
}

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
  /** Mounts segment elements whose measured heights the test controls. */
  function mountSegments(heights: readonly number[]) {
    heights.forEach((height, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-segment-id', `PSA 1:${i + 1}`);
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
      document.body.append(el);
    });
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('warns when a mounted segment lays out taller than predicted', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    // A measured height far from anything the predictor produces for this fixture.
    mountSegments([500]);
    renderSegmentHeights(makeBook(3), 300);

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
    document.body.append(stale);
    renderSegmentHeights(makeBook(3), 300);

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the mounted segments match their predictions', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mountSegments([132]);
    renderSegmentHeights(makeBook(3), 300);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('useSegmentHeights on container resize', () => {
  /** Installs a ResizeObserver stub, returning a trigger that reports a new container width. */
  function stubResizeObserver() {
    const original = global.ResizeObserver;
    let callback: ResizeObserverCallback | undefined;
    const stub: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };
    class StubResizeObserver implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
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
          callback?.([], stub);
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
        config: { displayMode: 'token-chip', showMorphology: true, showFreeTranslation: false },
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
    document.body.append(segment);
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
