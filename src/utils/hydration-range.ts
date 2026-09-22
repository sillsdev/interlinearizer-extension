import type { HeightTable } from './segment-heights';
import { segmentIndexAtOffset } from './segment-heights';

/** A half-open `[start, end)` range of indices into the book's flat segment list. */
export type IndexRange = Readonly<{ start: number; end: number }>;

/** Distance beyond the viewport, in pixels, a hydrated segment must pass before it is dropped. */
export const DROP_MARGIN_PX = 600;

/** Which segments render as token chips: a contiguous run covering the viewport. */
export type HydrationTarget = Readonly<{
  /** First segment of the run to hydrate. */
  start: number;
  /** Exclusive end of the run to hydrate. */
  end: number;
  /**
   * Whether an already-hydrated segment at `index` stays hydrated. Wider than the
   * {@link HydrationTarget.start}–{@link HydrationTarget.end} run, so a segment just off screen is
   * kept rather than dropped and re-added.
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
}

/**
 * The whole of `target`, widened to cover whatever of the already-hydrated `current` — `undefined`
 * when nothing is hydrated yet — is still inside the drop band. The viewport lands in one commit,
 * so what the reader is looking at is either all chips or all stand-ins, never half-way between.
 */
export function rangeToHydrate(
  current: IndexRange | undefined,
  target: HydrationTarget,
): IndexRange {
  if (!current) return { start: target.start, end: target.end };
  let { start, end } = current;
  while (start < end && !target.keeps(start)) start += 1;
  while (end > start && !target.keeps(end - 1)) end -= 1;
  // An empty survivor carries no indices worth unioning — a jump lands with nothing kept at all.
  if (start >= end) return { start: target.start, end: target.end };
  return { start: Math.min(target.start, start), end: Math.max(target.end, end) };
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
 * The segments that should render as token chips: those the viewport is showing. Every other
 * segment renders as plain baseline text, which costs a fraction of the elements.
 */
export function hydrationTarget({
  table,
  scrollTop,
  viewportHeight,
}: HydrationTargetArgs): HydrationTarget {
  const { start, end } = bandAround(table, scrollTop, viewportHeight, 0);
  const drop = bandAround(table, scrollTop, viewportHeight, DROP_MARGIN_PX);
  return {
    start,
    end,
    keeps: (index: number) => index >= drop.start && index < drop.end,
  };
}
