import type { OutlineSegment } from '../types/segment-pages';

/** A half-open `[start, end)` range of outline indexes. */
export type OutlineRange = Readonly<{ start: number; end: number }>;

/**
 * Words that the continuous strip holds past the segments it shows, on each side. Enough that the
 * phrase window can extend once or twice and find its groups already there.
 */
export const STRIP_MARGIN_WORDS = 32;

/**
 * The segments the strip should hold to show outline indexes `first` to `last` inclusive: those,
 * and on each side as many more as hold {@link STRIP_MARGIN_WORDS} words, clamped to the outline.
 */
export function stripTarget(
  outline: readonly OutlineSegment[],
  first: number,
  last: number,
): OutlineRange {
  let start = Math.max(0, first);
  let words = 0;
  while (start > 0 && words < STRIP_MARGIN_WORDS) {
    start -= 1;
    words += outline[start].wordTokenCount;
  }
  let end = Math.min(outline.length, last + 1);
  words = 0;
  while (end < outline.length && words < STRIP_MARGIN_WORDS) {
    words += outline[end].wordTokenCount;
    end += 1;
  }
  return { start, end };
}

/**
 * The run of loaded segments within `target` that holds outline index `anchor`, or an empty range
 * at `anchor` when its own segment has not loaded.
 */
export function loadedRun(
  isLoaded: (index: number) => boolean,
  anchor: number,
  target: OutlineRange,
): OutlineRange {
  if (!isLoaded(anchor)) return { start: anchor, end: anchor };
  let start = anchor;
  while (start > target.start && isLoaded(start - 1)) start -= 1;
  let end = anchor + 1;
  while (end < target.end && isLoaded(end)) end += 1;
  return { start, end };
}
