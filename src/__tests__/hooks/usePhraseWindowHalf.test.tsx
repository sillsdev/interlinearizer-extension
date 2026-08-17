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
  /** Horizontal distance between one group's left edge and the next's. */
  groupPitch: number;
  /** How many group wrappers the content row holds. */
  groupCount: number;
};

/**
 * Stubs `getBoundingClientRect` on a group so it reports the left edge its index implies. Only
 * `left` is read, but the whole rect is returned so nothing else reading it sees a partial object.
 */
function placeGroup(group: HTMLElement, left: number): void {
  group.getBoundingClientRect = () => ({
    left,
    right: left,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

/**
 * Builds a viewport/content pair with the given geometry stubbed onto real elements, so the hook
 * reads them through the same DOM properties it uses in a browser.
 *
 * @returns The two refs the hook takes and the group elements, all attached to the document.
 */
function makeStrip({ viewportWidth, groupPitch, groupCount }: StripGeometry) {
  const viewport = document.createElement('div');
  const content = document.createElement('div');
  viewport.appendChild(content);
  document.body.appendChild(viewport);
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: viewportWidth });
  const groups: HTMLElement[] = [];
  for (let i = 0; i < groupCount; i += 1) {
    const group = document.createElement('span');
    group.setAttribute('data-phrase-group', 'true');
    placeGroup(group, i * groupPitch);
    content.appendChild(group);
    groups.push(group);
  }
  return { viewportRef: { current: viewport }, contentRef: { current: content }, groups };
}

/**
 * Renders the hook over a strip with the given geometry and returns its settled value. The focus
 * sits mid-strip, as it does whenever the window is not clipped by an end of the book.
 */
function renderWindowHalf(geometry: StripGeometry): number {
  const { viewportRef, contentRef, groups } = makeStrip(geometry);
  const { result } = renderHook(() =>
    usePhraseWindowHalf(viewportRef, contentRef, () => groups[Math.floor(groups.length / 2)]),
  );
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

/** Viewport width the self-sizing strip reports. */
const SELF_SIZING_VIEWPORT_WIDTH = 1000;

/** Half-window the self-sizing strip settles on for the pitch it reports. */
const SELF_SIZING_SETTLED_HALF = 16;

/**
 * A strip that mounts the groups the hook asks for, as the continuous view does, so a measurement
 * that depended on how many groups are mounted would feed itself. Groups near the focus keep a
 * fixed pitch; the ones further out are deliberately narrower, so a hook that averaged the whole
 * row would read a different width at each size.
 *
 * @param nearFocusPitch - Pitch of the groups within the sample, which is what the hook must read.
 */
function SelfSizingStrip({ nearFocusPitch }: Readonly<{ nearFocusPitch: number }>) {
  // eslint-disable-next-line no-null/no-null
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line no-null/no-null
  const contentRef = useRef<HTMLDivElement | null>(null);
  const setViewport = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    if (element) {
      Object.defineProperty(element, 'clientWidth', {
        configurable: true,
        value: SELF_SIZING_VIEWPORT_WIDTH,
      });
    }
  }, []);
  const windowHalf = usePhraseWindowHalf(
    viewportRef,
    contentRef,
    () => document.querySelector('[data-focus-group="true"]') ?? undefined,
  );
  const groupCount = 2 * windowHalf + 1;
  const focusIndex = windowHalf;
  // Groups outside the sampled run sit at a quarter of the pitch, so averaging the whole row would
  // read a pitch that shrinks with every group the window adds.
  const leftOf = (index: number) => {
    const offset = index - focusIndex;
    const near = Math.min(Math.abs(offset), 4);
    const far = Math.abs(offset) - near;
    return Math.sign(offset) * nearFocusPitch * (near + far * 0.25);
  };
  return (
    <div ref={setViewport}>
      <div ref={contentRef}>
        {Array.from({ length: groupCount }, (_, index) => (
          <span
            // Interchangeable placeholders, with nothing else to key them by.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            data-phrase-group="true"
            data-focus-group={index === focusIndex ? 'true' : undefined}
            data-testid="phrase-group"
            ref={(element) => {
              if (element) placeGroup(element, leftOf(index));
            }}
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
  it('sizes the window from the viewport width and the measured group pitch', () => {
    // The viewport spans ten group pitches; the window is that count scaled by the viewports kept
    // per side, rounded up to the step.
    expect(renderWindowHalf({ viewportWidth: 1000, groupPitch: 100, groupCount: 20 })).toBe(16);
  });

  it('rounds up to the step, so a small viewport change leaves the window alone', () => {
    const narrower = renderWindowHalf({ viewportWidth: 980, groupPitch: 100, groupCount: 20 });
    const wider = renderWindowHalf({ viewportWidth: 1000, groupPitch: 100, groupCount: 20 });
    expect(narrower).toBe(wider);
  });

  it('reads the same pitch in an RTL strip, where document order runs right to left', () => {
    expect(renderWindowHalf({ viewportWidth: 1000, groupPitch: -100, groupCount: 20 })).toBe(16);
  });

  it('clamps up to the minimum when the viewport holds only a few groups', () => {
    expect(renderWindowHalf({ viewportWidth: 100, groupPitch: 100, groupCount: 20 })).toBe(
      MIN_PHRASE_WINDOW_HALF,
    );
  });

  it('clamps down to the maximum when the measurement asks for more', () => {
    expect(renderWindowHalf({ viewportWidth: 100_000, groupPitch: 100, groupCount: 20 })).toBe(
      MAX_PHRASE_WINDOW_HALF,
    );
  });

  it('keeps the starting window while every group measures at the same place', () => {
    // An unlaid-out strip reports a zero pitch, which would otherwise divide out to an unbounded
    // group count and clamp straight to the maximum.
    expect(renderWindowHalf({ viewportWidth: 1000, groupPitch: 0, groupCount: 20 })).toBe(
      MIN_PHRASE_WINDOW_HALF,
    );
  });

  it('keeps the starting window while the strip holds fewer than two groups', () => {
    expect(renderWindowHalf({ viewportWidth: 1000, groupPitch: 100, groupCount: 1 })).toBe(
      MIN_PHRASE_WINDOW_HALF,
    );
  });

  it('leaves the window unset while either element is unmounted', () => {
    const { result } = renderHook(() =>
      // eslint-disable-next-line no-null/no-null
      usePhraseWindowHalf({ current: null }, { current: null }, () => undefined),
    );
    expect(result.current).toBe(MIN_PHRASE_WINDOW_HALF);
  });

  it('slides the sample forward when the focus sits at the start of the book', () => {
    const { viewportRef, contentRef, groups } = makeStrip({
      viewportWidth: 1000,
      groupPitch: 100,
      groupCount: 20,
    });
    const { result } = renderHook(() =>
      usePhraseWindowHalf(viewportRef, contentRef, () => groups[0]),
    );
    // The run has nowhere to reach behind the focus, so it takes the groups ahead of it instead and
    // reads the same pitch a mid-book focus would.
    expect(result.current).toBe(16);
  });

  it('slides the sample back when the focus sits at the end of the book', () => {
    const { viewportRef, contentRef, groups } = makeStrip({
      viewportWidth: 1000,
      groupPitch: 100,
      groupCount: 20,
    });
    const { result } = renderHook(() =>
      usePhraseWindowHalf(viewportRef, contentRef, () => groups[groups.length - 1]),
    );
    expect(result.current).toBe(16);
  });

  it('samples around the mounted row when the focused group has not been recorded', () => {
    const { viewportRef, contentRef } = makeStrip({
      viewportWidth: 1000,
      groupPitch: 100,
      groupCount: 20,
    });
    const { result } = renderHook(() =>
      usePhraseWindowHalf(viewportRef, contentRef, () => undefined),
    );
    expect(result.current).toBe(16);
  });

  it('widens the window when the viewport grows', () => {
    withStubbedResizeObserver((notifyResize) => {
      const { viewportRef, contentRef, groups } = makeStrip({
        viewportWidth: 1000,
        groupPitch: 100,
        groupCount: 20,
      });
      const { result } = renderHook(() =>
        usePhraseWindowHalf(viewportRef, contentRef, () => groups[10]),
      );
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
      const { viewportRef, contentRef, groups } = makeStrip({
        viewportWidth: 2000,
        groupPitch: 100,
        groupCount: 20,
      });
      const { result } = renderHook(() =>
        usePhraseWindowHalf(viewportRef, contentRef, () => groups[10]),
      );
      expect(result.current).toBe(32);

      Object.defineProperty(viewportRef.current, 'clientWidth', {
        configurable: true,
        value: 1000,
      });
      notifyResize();

      expect(result.current).toBe(16);
    });
  });

  it('narrows the window when the content widens at an unchanged viewport width', () => {
    withStubbedResizeObserver((notifyResize) => {
      const { viewportRef, contentRef, groups } = makeStrip({
        viewportWidth: 1000,
        groupPitch: 100,
        groupCount: 20,
      });
      const { result } = renderHook(() =>
        usePhraseWindowHalf(viewportRef, contentRef, () => groups[10]),
      );
      expect(result.current).toBe(16);

      // Turning morpheme rows on widens every group without moving the panel.
      groups.forEach((group, index) => placeGroup(group, index * 200));
      notifyResize();

      expect(result.current).toBe(8);
    });
  });

  it('settles on the size its own sample measures, whatever the window mounts around it', () => {
    withStubbedResizeObserver((notifyResize) => {
      render(<SelfSizingStrip nearFocusPitch={100} />);
      expect(screen.getAllByTestId('phrase-group')).toHaveLength(2 * SELF_SIZING_SETTLED_HALF + 1);

      // Every group the window just mounted is narrower than the sampled ones, so a measurement
      // that averaged the whole row would read a smaller pitch and widen again on each pass.
      notifyResize();
      notifyResize();

      expect(screen.getAllByTestId('phrase-group')).toHaveLength(2 * SELF_SIZING_SETTLED_HALF + 1);
    });
  });
});
