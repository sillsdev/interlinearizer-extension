import type { HeightTable } from './segment-heights';
import { segmentIndexAtOffset } from './segment-heights';

/** A half-open `[start, end)` range of indices into the book's flat segment list. */
export type IndexRange = Readonly<{ start: number; end: number }>;

/**
 * Distance beyond the viewport, in pixels, that segments are hydrated ahead of the scroll, so
 * reaching the edge is never the moment the next segment starts rendering.
 */
export const HYDRATE_MARGIN_PX = 600;

/**
 * Distance beyond the viewport, in pixels, a hydrated segment must pass before it is dropped.
 * Strictly greater than {@link HYDRATE_MARGIN_PX}: the gap between the two is what stops a scroll
 * hovering near the edge from mounting and unmounting the same segment frame after frame.
 */
export const DROP_MARGIN_PX = HYDRATE_MARGIN_PX * 2;

/**
 * Which segments render as token chips: a contiguous run around the viewport, plus the active
 * segment wherever it has been scrolled to.
 */
export type HydrationTarget = Readonly<{
  /** First segment of the run to hydrate. */
  start: number;
  /** Exclusive end of the run to hydrate. */
  end: number;
  /**
   * The segments actually on screen, which fill before any of the margin does — the margin is
   * bought ahead of the reader and must never be paid for while what they are looking at is still
   * plain text.
   */
  core: IndexRange;
  /** Whether the segment at `index` renders as token chips rather than plain baseline text. */
  hydrated: (index: number) => boolean;
  /**
   * Whether an already-hydrated segment at `index` stays hydrated. Wider than {@link hydrated}, so a
   * segment near the edge is kept rather than dropped and re-added as the scroll jitters.
   */
  keeps: (index: number) => boolean;
}>;

/** Arguments for {@link hydrationTarget}. */
export interface HydrationTargetArgs {
  /** Predicted geometry of every segment in the book. */
  table: HeightTable;
  /** Current scroll offset of the list, in pixels from the top of the book. */
  scrollTop: number;
  /** Visible height of the scroll container, in pixels. */
  viewportHeight: number;
  /**
   * Index of the active segment, which stays hydrated wherever it is scrolled to because it holds
   * the focused gloss input. Omitted when no segment is active.
   */
  activeIndex?: number;
}

/**
 * Segments hydrated per step. Each step is a React commit the browser must finish before it can
 * paint, so a budget too small makes a viewport arrive a verse at a time; sized to fill a typical
 * viewport in a step or two while staying well short of committing the whole mounted run at once.
 */
export const HYDRATION_BUDGET_PER_FRAME = 4;

/**
 * Narrows an already-hydrated run to the segments `target` still keeps, dropping only those past
 * the wider drop threshold. Applying that threshold here rather than the hydrate one is what gives
 * the two bands their hysteresis: a segment leaving the hydrate band is held until it leaves the
 * drop band too, so a scroll wavering around the edge changes nothing.
 *
 * @param current - The range hydrated so far, or `undefined` when none is.
 * @param target - What the current scroll position hydrates and keeps.
 * @returns The surviving range, or `undefined` when nothing was hydrated to begin with.
 */
export function trimToKept(
  current: IndexRange | undefined,
  target: HydrationTarget,
): IndexRange | undefined {
  if (!current) return undefined;
  let { start } = current;
  let { end } = current;
  while (start < end && !target.keeps(start)) start += 1;
  while (end > start && !target.keeps(end - 1)) end -= 1;
  return { start, end };
}

/**
 * Advances `current` one budget's worth toward `target`, so a viewport fills over several frames
 * rather than in one commit.
 *
 * @param current - The range hydrated so far, or `undefined` when none is.
 * @param target - The range the viewport wants hydrated.
 * @returns The range to hydrate on this frame.
 */
export function stepTowardTarget(
  current: IndexRange | undefined,
  target: HydrationTarget,
): IndexRange {
  // A target sharing nothing with the current range is a jump — a fling or a thumb drag. Growing
  // toward it would hydrate the whole span flown over, so hydration restarts where the scroll
  // actually landed: at what is on screen, so the reader's own segments are the first mounted.
  if (!current || current.end <= target.start || current.start >= target.end) {
    const { core } = target;
    return { start: core.start, end: Math.min(core.end, core.start + HYDRATION_BUDGET_PER_FRAME) };
  }
  // Shrinking only unmounts elements, so a range the viewport has left collapses at once; only
  // growth is paced.
  let budget = HYDRATION_BUDGET_PER_FRAME;
  let start = Math.max(current.start, target.start);
  let end = Math.min(current.end, target.end);
  // Grow toward whichever edge is still short, spending the frame's budget a segment at a time.
  while (budget > 0 && (start > target.start || end < target.end)) {
    if (end < target.end) end += 1;
    else start -= 1;
    budget -= 1;
  }
  return { start, end };
}

/**
 * The band of segments covering `scrollTop` through `scrollTop + viewportHeight`, widened by
 * `marginPx` at both ends and clamped to the book.
 */
function bandAround(
  table: HeightTable,
  scrollTop: number,
  viewportHeight: number,
  marginPx: number,
): IndexRange {
  const top = Math.max(0, scrollTop - marginPx);
  // The band's bottom edge is exclusive, so a segment starting exactly on it shows no pixel row and
  // is left out; stepping back a pixel resolves to the last segment actually inside the band.
  const bottom = scrollTop + viewportHeight + marginPx - 1;
  return {
    start: segmentIndexAtOffset(table, top),
    end: segmentIndexAtOffset(table, bottom) + 1,
  };
}

/**
 * The segments that should render as token chips: those the viewport is showing plus a margin
 * either side, and the active one wherever it has been scrolled to. Every other segment renders as
 * plain baseline text, which costs a fraction of the elements.
 *
 * Reported as two bands rather than one. {@link HydrationTarget.hydrated} is the narrower band a
 * segment must enter to be mounted; {@link HydrationTarget.keeps} is the wider one it must leave to
 * be dropped. Answering both from the scroll position alone is what lets hydration track a moving
 * scroll continuously — the gap between the bands, not a wait for the scroll to stop, is what keeps
 * an edge from oscillating.
 */
export function hydrationTarget({
  table,
  scrollTop,
  viewportHeight,
  activeIndex,
}: HydrationTargetArgs): HydrationTarget {
  const { start, end } = bandAround(table, scrollTop, viewportHeight, HYDRATE_MARGIN_PX);
  const drop = bandAround(table, scrollTop, viewportHeight, DROP_MARGIN_PX);
  const core = bandAround(table, scrollTop, viewportHeight, 0);
  const isActive = (index: number) => activeIndex !== undefined && index === activeIndex;
  return {
    start,
    end,
    core,
    hydrated: (index: number) => (index >= start && index < end) || isActive(index),
    keeps: (index: number) => (index >= drop.start && index < drop.end) || isActive(index),
  };
}
