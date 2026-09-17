import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { IndexRange } from '../utils/hydration-range';
import { hydrationTarget, stepTowardTarget, trimToKept } from '../utils/hydration-range';
import type { HeightTable } from '../utils/segment-heights';

/** Arguments for {@link useHydrationRange}. */
export interface UseHydrationRangeArgs {
  /** Predicted geometry of every segment in the book. */
  table: HeightTable;
  /** Ref to the scrolling element whose position and height decide what is on screen. */
  scrollContainerRef: RefObject<HTMLElement | undefined>;
  /**
   * Whether the window is re-seating itself ahead of a thumb drag. The mounted run is being rebuilt
   * somewhere the reader has not landed yet, so there is nothing worth hydrating until it settles.
   */
  isSkimmingRef: RefObject<boolean>;
  /** Index of the active segment, which stays hydrated wherever it is scrolled to. */
  activeIndex: number | undefined;
}

/** Whether the segment at an index renders as token chips rather than plain baseline text. */
export interface HydrationState {
  /** Whether the segment at `index` renders as token chips. */
  hydrated: (index: number) => boolean;
}

/**
 * Decides which segments render as token chips, filling the viewport over a few frames.
 *
 * Mounting a segment's chips costs hundreds of DOM elements, so committing a viewport's worth at
 * once blocks the main thread long enough that the browser cannot paint — the scroll appears to
 * freeze on content that is already in the DOM. Pacing the same work across frames keeps every
 * commit inside a frame's budget.
 */
export default function useHydrationRange({
  table,
  scrollContainerRef,
  isSkimmingRef,
  activeIndex,
}: UseHydrationRangeArgs): HydrationState {
  const [range, setRange] = useState<IndexRange | undefined>(undefined);

  useEffect(() => {
    let frame: number | undefined;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const container = scrollContainerRef.current;
      /* v8 ignore next -- the hook only runs while the list (and so the container) is mounted */
      if (!container) return;
      // Ordinary scrolling needs no such wait: the hydrate and drop thresholds differ, and that gap
      // is what keeps an edge from oscillating.
      if (isSkimmingRef.current) return;
      const target = hydrationTarget({
        table,
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
      });
      setRange((current) => {
        const next = stepTowardTarget(trimToKept(current, target), target);
        // Returning the identical object when nothing moved keeps the idle loop re-render-free.
        if (current && current.start === next.start && current.end === next.end) return current;
        return next;
      });
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [table, scrollContainerRef, isSkimmingRef]);

  return useMemo(
    () => ({
      hydrated: (index: number) =>
        (range !== undefined && index >= range.start && index < range.end) || index === activeIndex,
    }),
    [range, activeIndex],
  );
}
