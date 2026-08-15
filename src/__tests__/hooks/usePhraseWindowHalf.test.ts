/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
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

  it('re-measures when the viewport resizes', () => {
    let notifyResize: ResizeObserverCallback | undefined;
    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      observe() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      unobserve() {}

      // eslint-disable-next-line @typescript-eslint/class-methods-use-this
      disconnect() {}
    };

    try {
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
      act(() => {
        notifyResize?.([], new global.ResizeObserver(() => {}));
      });

      expect(result.current).toBe(32);
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });
});
