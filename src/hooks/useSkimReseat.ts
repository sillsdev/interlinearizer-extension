import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { HeightTable } from '../utils/segment-heights';
import { offsetOfSegment, segmentIndexAtOffset } from '../utils/segment-heights';
import type { WindowRange } from '../utils/scroll-window';
import useLatestRef from './useLatestRef';

/**
 * Quiet time (in milliseconds) after the last scroll event before a skim ends and the window
 * renders its segments in full again. It ends a scroll with no release to wait for — a wheel, a
 * touchpad fling — so it need only outlast the gaps between one gesture's scroll events; a drag
 * ends its skim on the pointer release.
 */
export const SKIM_SETTLE_MS = 200;

/**
 * Distance a skimming window covers ahead of the scroll position, in pixels, in the direction of
 * travel — the ground a drag crosses between re-seats, whatever height its segments render at.
 * Bounded above by what a drag can afford to mount, since every segment reached over costs a commit
 * whether or not the drag stops there.
 */
export const SKIM_AHEAD_PX = 8_000;

/**
 * Distance a skimming window covers behind the scroll position, in pixels, for the ground a drag
 * that reverses lands on before {@link SKIM_REVERSE_PX} turns the window around.
 */
export const SKIM_BEHIND_PX = 2_000;

/**
 * How close (in pixels) the leading edge of a skimming window may come to the viewport before the
 * window is re-seated further ahead. Re-seating this far out is what keeps a drag from ever
 * reaching past the mounted run.
 */
export const SKIM_LEAD_PX = 1500;

/**
 * Distance a skimming window slides at its leading edge each time the drag approaches that edge, in
 * pixels. Kept small against the window's own span, so the slide leaves most segments mounted
 * rather than amounting to a rebuild.
 */
export const SKIM_SLIDE_PX = 3_000;

/**
 * How far (in pixels) the scroll must reverse before a skim treats the drag as having changed
 * direction. Wide enough to ignore the pixel or two a drag jitters between frames, which would
 * otherwise turn the window around behind a drag still moving forward.
 */
export const SKIM_REVERSE_PX = 400;

/**
 * Builds the half-open range a skimming window mounts around a scroll offset, reaching
 * {@link SKIM_AHEAD_PX} in the direction of travel and {@link SKIM_BEHIND_PX} the other way, clamped
 * to the book.
 */
function buildSkimRange(offset: number, direction: 1 | -1, table: HeightTable): WindowRange {
  const behind = direction > 0 ? SKIM_BEHIND_PX : SKIM_AHEAD_PX;
  const ahead = direction > 0 ? SKIM_AHEAD_PX : SKIM_BEHIND_PX;
  return {
    start: segmentIndexAtOffset(table, offset - behind),
    end: Math.min(table.heights.length, segmentIndexAtOffset(table, offset + ahead) + 1),
  };
}

/**
 * Slides a skimming window {@link SKIM_SLIDE_PX} in the direction of travel, keeping every segment
 * the two ranges share, clamped to the book.
 */
function slideSkimRange(range: WindowRange, direction: 1 | -1, table: HeightTable): WindowRange {
  const shift = direction * SKIM_SLIDE_PX;
  const total = table.heights.length;
  const end = Math.min(
    total,
    segmentIndexAtOffset(table, offsetOfSegment(table, range.end - 1) + shift) + 1,
  );
  const start = segmentIndexAtOffset(table, offsetOfSegment(table, range.start) + shift);
  // Hold the window's span when an edge clamps at the book, rather than letting the clamped edge
  // pull the other in behind it and shrink the window toward nothing as a drag rides the end.
  const span = range.end - range.start;
  const held = Math.max(0, Math.min(start, total - span));
  return { start: held, end: Math.max(Math.min(end, total), Math.min(held + span, total)) };
}

/** The geometry and scroll state {@link decideReseat} decides from. */
export interface ReseatInputs {
  /** The scroll container's top and bottom edges. */
  root: Readonly<{ top: number; bottom: number }>;
  /** Top edge of the sentinel above the first mounted segment. */
  topSentinelTop: number;
  /** Bottom edge of the sentinel below the last mounted segment. */
  bottomSentinelBottom: number;
  /** The container's `scrollTop`. */
  scrollTop: number;
  /** Whether a skim is already running. */
  isSkimming: boolean;
  /** Direction of travel: `1` down the book, `-1` up it. */
  direction: 1 | -1;
  /** The mounted range. */
  range: WindowRange;
  /** Offsets the book is laid out at, mounted segments and unmounted alike. */
  table: HeightTable;
}

/**
 * Decides whether a scroll has left the mounted segments, or a running skim is about to, and where
 * the window goes if so.
 *
 * Whether the scroll has left is read from the sentinels' geometry rather than the table, whose
 * predicted heights for the mounted run can differ from the laid-out ones; only the landing segment
 * comes from the table. A skim still inside the window that is only running out of runway ahead
 * slides, keeping every segment between the edges mounted. A scroll that has left the window
 * outright has nothing to preserve, so it rebuilds around the scroll position.
 *
 * @returns The range to mount, or `undefined` to leave the window as it is.
 */
export function decideReseat({
  root,
  topSentinelTop,
  bottomSentinelBottom,
  scrollTop,
  isSkimming,
  direction,
  range,
  table,
}: ReseatInputs): WindowRange | undefined {
  const mountedAbove = bottomSentinelBottom < root.top;
  const mountedBelow = topSentinelTop > root.bottom;
  const runningOut =
    isSkimming &&
    (direction > 0
      ? bottomSentinelBottom - root.bottom < SKIM_LEAD_PX
      : root.top - topSentinelTop < SKIM_LEAD_PX);
  if (!mountedAbove && !mountedBelow && !runningOut) return undefined;
  const index = segmentIndexAtOffset(table, scrollTop);
  /* v8 ignore next -- a mounted list always has a segment for the table to resolve to */
  if (index < 0) return undefined;
  const isInside = index >= range.start && index < range.end;
  // A run the geometry reports off-screen while the table resolves the position inside it is the
  // table disagreeing with the layout; a re-seat would mount the same segments again.
  if (!runningOut && isInside) return undefined;
  const next =
    runningOut && isInside
      ? slideSkimRange(range, direction, table)
      : buildSkimRange(scrollTop, direction, table);
  return next.start === range.start && next.end === range.end ? undefined : next;
}

/** Arguments for {@link useSkimReseat}. */
export interface UseSkimReseatArgs {
  /** Ref to the scrolling list container. */
  scrollContainerRef: RefObject<HTMLElement | undefined>;
  /** The sentinel above the first mounted segment, `undefined` before it mounts. */
  topSentinel: HTMLElement | undefined;
  /** The sentinel below the last mounted segment, `undefined` before it mounts. */
  bottomSentinel: HTMLElement | undefined;
  /** Offsets the book is laid out at, mounted segments and unmounted alike. */
  heightTable: HeightTable;
  /** The latest mounted range. */
  rangeRef: RefObject<WindowRange>;
  /** `true` while a recenter owns the scroll position, when no re-seat runs. */
  recenterInFlightRef: RefObject<boolean>;
  /**
   * Mounts the re-seated range. Must commit before the frame paints: the scroll has already left
   * the mounted run, so a commit deferred past the paint shows the reader blank space until it
   * lands.
   */
  onReseat: (next: WindowRange) => void;
}

/** Return value of {@link useSkimReseat}. */
export interface UseSkimReseatResult {
  /**
   * Whether a skim is running: the scroll left the mounted run (as a thumb drag does) and has not
   * settled. A ref because nothing renders from it; it only suspends the sentinel extends, which a
   * skim re-seats ahead of instead.
   */
  isSkimmingRef: RefObject<boolean>;
  /**
   * Bumped each time a skim ends, to re-subscribe the sentinel observer. A skim can settle with a
   * sentinel already inside the arming margin, whose delivery the skim guard dropped.
   */
  skimEpoch: number;
}

/**
 * Re-seats the segment window when the scroll position leaves the mounted segments entirely, as a
 * thumb drag or a click on the scrollbar track does, and keeps sliding it ahead of the drag while
 * the resulting skim runs. Coalesced to one re-seat per animation frame, since a drag delivers a
 * scroll event per frame and each would queue a further remount.
 *
 * A skim ends on the pointer release for a drag, or after {@link SKIM_SETTLE_MS} without a scroll
 * otherwise. It leaves the mounted range as the drag left it, for the sentinel extends to cull a
 * chunk at a time, where collapsing it would unmount most of the window in one commit just as the
 * reader stops to read.
 */
export default function useSkimReseat({
  scrollContainerRef,
  topSentinel,
  bottomSentinel,
  heightTable,
  rangeRef,
  recenterInFlightRef,
  onReseat,
}: UseSkimReseatArgs): UseSkimReseatResult {
  const isSkimmingRef = useRef(false);
  const [skimEpoch, setSkimEpoch] = useState(0);
  const heightTableRef = useLatestRef(heightTable);
  const onReseatRef = useLatestRef(onReseat);

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !topSentinel || !bottomSentinel) return undefined;

    let lastScrollTop = root.scrollTop;
    let direction: 1 | -1 = 1;
    let skimTimer: ReturnType<typeof setTimeout> | undefined;
    /** Whether a pointer is down on the container, which a scrollbar drag holds for its gesture. */
    let isDragging = false;

    /** Whether a skim is running: its quiet timer is pending, or a drag is holding it open. */
    let isSkimming = false;

    const endSkim = () => {
      skimTimer = undefined;
      // A held pointer is a drag mid-gesture, however long it has paused. Its release ends the skim.
      if (isDragging) return;
      isSkimming = false;
      isSkimmingRef.current = false;
      // Re-arms the sentinels against the geometry the skim settled in.
      setSkimEpoch((epoch) => epoch + 1);
    };
    const armSkimEnd = () => {
      isSkimming = true;
      if (skimTimer !== undefined) clearTimeout(skimTimer);
      skimTimer = setTimeout(endSkim, SKIM_SETTLE_MS);
    };

    const reseat = () => {
      if (recenterInFlightRef.current) return;
      const rootRect = root.getBoundingClientRect();
      const next = decideReseat({
        root: rootRect,
        topSentinelTop: topSentinel.getBoundingClientRect().top,
        bottomSentinelBottom: bottomSentinel.getBoundingClientRect().bottom,
        scrollTop: root.scrollTop,
        isSkimming,
        direction,
        range: rangeRef.current,
        table: heightTableRef.current,
      });
      if (next === undefined) return;
      isSkimmingRef.current = true;
      armSkimEnd();
      onReseatRef.current(next);
    };

    let rafId: number | undefined;
    const onScroll = () => {
      const { scrollTop } = root;
      // Direction only turns on a move against it worth more than the jitter inside one gesture;
      // any move along it re-bases the comparison so the next reversal is measured from here.
      const delta = scrollTop - lastScrollTop;
      if (delta * direction > 0) lastScrollTop = scrollTop;
      else if (Math.abs(delta) >= SKIM_REVERSE_PX) {
        // Reaching here means the move ran against `direction`, so the turn is always a negation.
        direction = direction > 0 ? -1 : 1;
        lastScrollTop = scrollTop;
      }
      // A scroll mid-skim keeps the skim alive, whether or not it moves off the mounted run.
      if (isSkimming) armSkimEnd();
      if (rafId !== undefined) return;
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        reseat();
      });
    };

    const onPointerDown = () => {
      isDragging = true;
    };
    // Ends a drag's skim on release rather than on a quiet timer, and re-arms the timer so a release
    // during a paused drag still settles. Listens on the window because a drag that leaves the
    // container (or ends over another element) still releases the scrollbar.
    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (isSkimming) armSkimEnd();
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (skimTimer !== undefined) clearTimeout(skimTimer);
      // The quiet timer goes with the effect, so nothing else would hand the window back to the
      // sentinels.
      isSkimmingRef.current = false;
    };
  }, [
    scrollContainerRef,
    topSentinel,
    bottomSentinel,
    heightTableRef,
    rangeRef,
    recenterInFlightRef,
    onReseatRef,
  ]);

  return { isSkimmingRef, skimEpoch };
}
