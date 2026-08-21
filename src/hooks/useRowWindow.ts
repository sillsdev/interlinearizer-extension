import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * How many rows are mounted before the list has been scrolled at all. Deliberately small: the
 * window grows on demand, so this only needs to fill a tall panel plus a little overscan, and a
 * first paint that mounts the whole draft is the cost it exists to avoid.
 */
const INITIAL_ROW_COUNT = 40;

/** How many rows each extend appends. */
const EXTEND_CHUNK = 40;

/**
 * Distance in pixels beyond the list's own box at which the end-of-list sentinel arms, so the next
 * rows are mounted before the reader can scroll past the last of them.
 */
const SENTINEL_ROOT_MARGIN_PX = 400;

/** What {@link useRowWindow} hands back. */
export interface UseRowWindowResult<T> {
  /** The leading run of `rows` currently mounted, in the order they were given. */
  windowRows: readonly T[];
  /** Ref callback for the scrolling list element, which the sentinel is watched inside. */
  scrollRef: (el: HTMLElement | null) => void;
  /** Ref callback for the sentinel placed after the last mounted row. */
  sentinelRef: (el: HTMLElement | null) => void;
}

/**
 * Mounts a growing leading slice of a list rather than all of it, extending by a chunk each time
 * the end of the mounted rows comes within reach of the scroll.
 *
 * Grow-only and anchored to nothing: the window has no notion of where in the list the reader is,
 * so it never culls from the top and never adjusts the scroll position. A row list has no
 * counterpart to the scripture reference a segment window has to hold still, so it needs none of
 * that geometry bookkeeping.
 *
 * The window starts over whenever `rows` is a different array, which is what a changed query
 * produces: a reader who has scrolled deep into one listing and then narrows it is looking at a new
 * list, not further down the old one.
 */
export default function useRowWindow<T>(rows: readonly T[]): UseRowWindowResult<T> {
  const [count, setCount] = useState(INITIAL_ROW_COUNT);

  /** The listing the current count was reached against, so a new one can be recognized as new. */
  const [countedRows, setCountedRows] = useState(rows);

  // Start the window over on a new listing, keyed on the array's identity rather than its length
  // because a query can narrow a listing to a different set of rows of the same size. Adjusted
  // during the render that first sees the new listing rather than in an effect afterwards: an effect
  // would let one frame paint the new rows at the old, grown count before shrinking back.
  if (rows !== countedRows) {
    setCountedRows(rows);
    setCount(INITIAL_ROW_COUNT);
  }

  /**
   * The mounted scroll container and sentinel, held in state rather than in refs so the observer
   * effect re-runs once each attaches. Wiring the observer inside the ref callbacks instead would
   * run before the container's own ref is set, leaving nothing to observe against.
   */
  const [scrollEl, setScrollEl] = useState<HTMLElement | undefined>(undefined);
  const [sentinelEl, setSentinelEl] = useState<HTMLElement | undefined>(undefined);

  const scrollRef = useCallback((el: HTMLElement | null) => setScrollEl(el ?? undefined), []);
  const sentinelRef = useCallback((el: HTMLElement | null) => setSentinelEl(el ?? undefined), []);

  // Extend the window each time the sentinel is reported within reach. Re-subscribes on every count
  // change as well as on the elements', because an IntersectionObserver reports only intersection
  // *transitions*: after an extend the sentinel node is unchanged and may still sit inside the arming
  // margin, where a stale observer would stay silent however far the reader scrolls. A fresh observer
  // re-delivers the current state, extending once per delivery until the sentinel is pushed clear —
  // or until the window covers every row, at which point the count stops changing and with it the
  // re-subscription.
  useEffect(() => {
    if (!scrollEl || !sentinelEl) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => Math.min(rows.length, current + EXTEND_CHUNK));
        }
      },
      { root: scrollEl, rootMargin: `${SENTINEL_ROOT_MARGIN_PX}px`, threshold: 0 },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [scrollEl, sentinelEl, count, rows.length]);

  const windowRows = useMemo(() => rows.slice(0, count), [rows, count]);

  return { windowRows, scrollRef, sentinelRef };
}
