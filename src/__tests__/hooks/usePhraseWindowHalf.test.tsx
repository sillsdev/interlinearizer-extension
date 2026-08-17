/// <reference types="jest" />

import { act, render, renderHook, screen } from '@testing-library/react';
import { useCallback, useRef } from 'react';
import usePhraseWindowHalf, {
  MAX_PHRASE_WINDOW_HALF,
  MIN_PHRASE_WINDOW_HALF,
} from '../../hooks/usePhraseWindowHalf';

/** Geometry a stubbed strip reports; jsdom lays nothing out, so every dimension is supplied. */
type StripGeometry = {
  /** `clientWidth` the clipping viewport reports. */
  viewportWidth: number;
  /** `scrollWidth` the content row reports. */
  contentWidth: number;
  /** How many group wrappers the content row holds. */
  groupCount: number;
};

/**
 * Builds a viewport/content pair with the given geometry stubbed onto real elements, so the hook
 * reads them through the same DOM properties it uses in a browser.
 *
 * @returns The two refs the hook takes, over elements attached to the document.
 */
function makeStrip({ viewportWidth, contentWidth, groupCount }: StripGeometry) {
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  viewport.appendChild(content);
  document.body.appendChild(viewport);
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: viewportWidth });
  Object.defineProperty(content, 'scrollWidth', { configurable: true, value: contentWidth });
  for (let i = 0; i < groupCount; i += 1) {
    const group = document.createElement('span');
    group.setAttribute('data-phrase-group', 'true');
    content.appendChild(group);
  }
  return { viewportRef: { current: viewport }, contentRef: { current: content } };
}

/** Renders the hook over a strip with the given geometry and returns its settled value. */
function renderWindowHalf(geometry: StripGeometry): number {
  const { viewportRef, contentRef } = makeStrip(geometry);
  const { result } = renderHook(() => usePhraseWindowHalf(viewportRef, contentRef));
  return result.current;
}

/**
 * Stubs the global ResizeObserver for the duration of one test body, handing it a function that
 * fires the most recently constructed observer's callback, and restores the real one afterward.
 */
function withStubbedResizeObserver(run: (notifyResize: () => void) => void): void {
  let notify: (() => void) | undefined;
  const originalResizeObserver = global.ResizeObserver;
  global.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this);
    }

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    observe() {}

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    unobserve() {}

    // eslint-disable-next-line @typescript-eslint/class-methods-use-this
    disconnect() {}
  };

  try {
    run(() => {
      act(() => {
        notify?.();
      });
    });
  } finally {
    global.ResizeObserver = originalResizeObserver;
  }
}

/** Viewport width the self-sizing strip reports, paired with {@link straddlingContentWidth}. */
const STRADDLING_VIEWPORT_WIDTH = 1000;

/** Window half the straddling geometry settles on. */
const STRADDLING_SETTLED_HALF = 20;

/**
 * Content width a strip of `groupCount` groups reports, measured against
 * {@link STRADDLING_VIEWPORT_WIDTH}. Groups measure wider once the strip mounts the window the
 * narrower measurement asks for, so the two sizes each measure into the other — the pair a window
 * free to move both ways never settles between.
 */
function straddlingContentWidth(groupCount: number): number {
  return groupCount * (groupCount >= 41 ? 95 : 88);
}

/**
 * A strip that mounts the groups the hook asks for, as the continuous view does, so each
 * measurement changes the content the next one divides.
 */
function SelfSizingStrip() {
  // eslint-disable-next-line no-null/no-null
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line no-null/no-null
  const contentRef = useRef<HTMLDivElement | null>(null);
  const setViewport = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    if (element) {
      Object.defineProperty(element, 'clientWidth', {
        configurable: true,
        value: STRADDLING_VIEWPORT_WIDTH,
      });
    }
  }, []);
  const setContent = useCallback((element: HTMLDivElement | null) => {
    contentRef.current = element;
    if (element) {
      Object.defineProperty(element, 'scrollWidth', {
        configurable: true,
        get: () =>
          straddlingContentWidth(element.querySelectorAll('[data-phrase-group="true"]').length),
      });
    }
  }, []);
  const windowHalf = usePhraseWindowHalf(viewportRef, contentRef);
  return (
    <div ref={setViewport}>
      <div ref={setContent}>
        {Array.from({ length: 2 * windowHalf + 1 }, (_, index) => (
          <span
            // Interchangeable placeholders, with nothing else to key them by.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            data-phrase-group="true"
            data-testid="phrase-group"
          />
        ))}
      </div>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('usePhraseWindowHalf', () => {
  it('sizes the window from the viewport width and the measured per-group width', () => {
    // The groups measure 100px each, so the viewport holds ten of them; the window is that count
    // scaled by the viewports kept per side, rounded up to the step.
    expect(renderWindowHalf({ viewportWidth: 1000, contentWidth: 2000, groupCount: 20 })).toBe(16);
  });

  it('rounds up to the step, so a small viewport change leaves the window alone', () => {
    const narrower = renderWindowHalf({ viewportWidth: 980, contentWidth: 2000, groupCount: 20 });
    const wider = renderWindowHalf({ viewportWidth: 1000, contentWidth: 2000, groupCount: 20 });
    expect(narrower).toBe(wider);
  });

  it('clamps up to the minimum when the viewport holds only a few groups', () => {
    expect(renderWindowHalf({ viewportWidth: 100, contentWidth: 2000, groupCount: 20 })).toBe(
      MIN_PHRASE_WINDOW_HALF,
    );
  });

  it('clamps down to the maximum when the measurement asks for more', () => {
    expect(renderWindowHalf({ viewportWidth: 100_000, contentWidth: 2000, groupCount: 20 })).toBe(
      MAX_PHRASE_WINDOW_HALF,
    );
  });

  it('keeps the starting window while the strip measures zero wide', () => {
    // Dividing by a zero content width would otherwise clamp straight to the maximum.
    expect(renderWindowHalf({ viewportWidth: 1000, contentWidth: 0, groupCount: 20 })).toBe(
      MIN_PHRASE_WINDOW_HALF,
    );
  });

  it('leaves the window unset while either element is unmounted', () => {
    const { result } = renderHook(() =>
      // eslint-disable-next-line no-null/no-null
      usePhraseWindowHalf({ current: null }, { current: null }),
    );
    expect(result.current).toBe(MIN_PHRASE_WINDOW_HALF);
  });

  it('widens the window when the viewport grows', () => {
    withStubbedResizeObserver((notifyResize) => {
      const { viewportRef, contentRef } = makeStrip({
        viewportWidth: 1000,
        contentWidth: 2000,
        groupCount: 20,
      });
      const { result } = renderHook(() => usePhraseWindowHalf(viewportRef, contentRef));
      expect(result.current).toBe(16);

      Object.defineProperty(viewportRef.current, 'clientWidth', {
        configurable: true,
        value: 2000,
      });
      notifyResize();

      expect(result.current).toBe(32);
    });
  });

  it('narrows the window when the viewport shrinks', () => {
    withStubbedResizeObserver((notifyResize) => {
      const { viewportRef, contentRef } = makeStrip({
        viewportWidth: 2000,
        contentWidth: 2000,
        groupCount: 20,
      });
      const { result } = renderHook(() => usePhraseWindowHalf(viewportRef, contentRef));
      expect(result.current).toBe(32);

      Object.defineProperty(viewportRef.current, 'clientWidth', {
        configurable: true,
        value: 1000,
      });
      notifyResize();

      expect(result.current).toBe(16);
    });
  });

  it('settles on the wider window when two sizes each measure into the other', () => {
    render(<SelfSizingStrip />);

    expect(screen.getAllByTestId('phrase-group')).toHaveLength(2 * STRADDLING_SETTLED_HALF + 1);
  });
});
