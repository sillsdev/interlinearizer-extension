/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import useHydrationRange from '../../hooks/useHydrationRange';
import type { HeightTable } from '../../utils/segment-heights';

/** Height the test table gives every segment, so a scroll offset reads as a round segment index. */
const SEGMENT_PX = 100;

/** One animation frame under fake timers, which schedules `requestAnimationFrame` on a 16ms clock. */
const FRAME_MS = 16;

/** A height table laying `count` segments out at {@link SEGMENT_PX} each. */
function uniformTable(count: number): HeightTable {
  const heights = Array.from({ length: count }, () => SEGMENT_PX);
  const offsets = heights.map((_h, i) => i * SEGMENT_PX);
  offsets.push(count * SEGMENT_PX);
  return { heights, offsets, total: count * SEGMENT_PX };
}

/**
 * Renders {@link useHydrationRange} against a real, attached scroll container so the hook reads
 * genuine scroll geometry.
 *
 * @param options.scrollTop - Where the container is scrolled to when the hook first runs.
 * @param options.skimming - Whether the window reports a scroll gesture in flight.
 * @param options.activeIndex - Index of the active segment, if any.
 */
function renderHydrationRange({
  scrollTop,
  skimming = false,
  activeIndex,
}: {
  scrollTop: number;
  skimming?: boolean;
  activeIndex?: number;
}) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
  container.scrollTop = scrollTop;
  document.body.appendChild(container);

  const view = renderHook(() => {
    const containerRef = useRef<HTMLElement | undefined>(container);
    const isSkimmingRef = useRef(skimming);
    return useHydrationRange({
      table: uniformTable(50),
      scrollContainerRef: containerRef,
      isSkimmingRef,
      activeIndex,
    });
  });
  return { ...view, container };
}

describe('useHydrationRange', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  it('fills the whole viewport within a frame or two', () => {
    // Viewport covers 1000–1300px, i.e. segments 10 through 12. Each step is a commit the browser
    // must finish before painting, so a viewport has to arrive at once rather than a verse at a
    // time.
    const { result } = renderHydrationRange({ scrollTop: 1000 });

    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 2);
    });

    expect([10, 11, 12].map(result.current.hydrated)).toEqual([true, true, true]);
  });

  it('hydrates nothing while a scroll gesture is still in flight', () => {
    // Mid-fling the segments stream past faster than any budget could hydrate them.
    const { result } = renderHydrationRange({ scrollTop: 1000, skimming: true });

    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 10);
    });

    expect([10, 11, 12].map(result.current.hydrated)).toEqual([false, false, false]);
  });

  it('holds the hydrated set still while the scroll is moving', () => {
    // Each swap between chips and plain text costs tens of milliseconds of frame time.
    const { result, container } = renderHydrationRange({ scrollTop: 1000 });
    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 2);
    });
    const before = Array.from({ length: 50 }, (_unused, i) => result.current.hydrated(i));

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        container.scrollTop += 300;
        jest.advanceTimersByTime(FRAME_MS);
      });
    }

    expect(Array.from({ length: 50 }, (_unused, i) => result.current.hydrated(i))).toEqual(before);
  });

  it('hydrates where the scroll came to rest', () => {
    const { result, container } = renderHydrationRange({ scrollTop: 1000 });

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        container.scrollTop += 300;
        jest.advanceTimersByTime(FRAME_MS);
      });
    }
    // The scroll stops at 2800px, so the viewport is showing segment 28.
    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 4);
    });

    expect(result.current.hydrated(28)).toBe(true);
  });

  it('settles on a stable range instead of reworking it every frame', () => {
    // The loop runs every frame while the list sits still, so a settled viewport that kept
    // producing fresh ranges would re-render the whole list forever.
    const { result } = renderHydrationRange({ scrollTop: 1000 });
    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 20);
    });
    const settled = result.current;

    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 20);
    });

    // An unchanged range keeps the same identity, which is what spares consumers a re-render.
    expect(result.current).toBe(settled);
  });

  it('keeps the active segment hydrated once it has been scrolled off-screen', () => {
    // Segment 3 is far above the viewport, but holds the focused gloss input.
    const { result } = renderHydrationRange({ scrollTop: 1000, activeIndex: 3 });

    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 4);
    });

    expect(result.current.hydrated(3)).toBe(true);
  });

  it('keeps the active segment hydrated after the scroll settles somewhere far away', () => {
    // The active segment holds the focused gloss input, so it must survive a scroll that settles a
    // long way off — where the hydrated run shares nothing with the one it was mounted in.
    const { result, container } = renderHydrationRange({ scrollTop: 1000, activeIndex: 10 });
    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 4);
    });

    for (let i = 0; i < 10; i += 1) {
      act(() => {
        container.scrollTop += 300;
        jest.advanceTimersByTime(FRAME_MS);
      });
    }
    act(() => {
      jest.advanceTimersByTime(FRAME_MS * 8);
    });

    expect(result.current.hydrated(10)).toBe(true);
    // The run itself has moved to where the scroll landed, so the active segment is the lone
    // exception to it rather than a member — its neighbors are stand-ins.
    expect(result.current.hydrated(9)).toBe(false);
  });
});
