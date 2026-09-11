import type { Segment } from 'interlinearizer';
import { isWordToken } from '../types/type-guards';

// The geometry constants below were measured in the running app (WEB, Psalms 1–2, 1872px panel).
// Every segment sharing a row count measured an identical height, so they are exact rather than
// fitted — but they are empirical, and a font, zoom, or spacing change invalidates them.

/** Horizontal space between two adjacent token chips, in pixels. */
const CHIP_GAP_PX = 32;

/** Height of one wrapped chip row, in pixels, by whether the morpheme box is shown. */
const ROW_PITCH_PX = { withMorphology: 124, withoutMorphology: 82 } as const;

/** Segment chrome above and below the chip rows (padding and the verse label row). */
const SEGMENT_BASE_PX = 8;

/** Extra height the free-translation field adds to a segment, independent of its row count. */
const FREE_TRANSLATION_PX = 34;

/** Height of a segment rendered as plain baseline text, which never wraps into chip rows. */
const BASELINE_TEXT_HEIGHT_PX = 72;

/** The view toggles that change a segment's laid-out height. */
export type HeightConfig = Readonly<{
  /** Whether the morpheme box (or its placeholder affordance) occupies a band in each chip. */
  showMorphology: boolean;
  /** Whether the segment carries a free-translation field below its chips. */
  showFreeTranslation: boolean;
  /** Which renderer the segment uses; `baseline-text` has no chips and so no rows. */
  displayMode: 'token-chip' | 'baseline-text';
}>;

/**
 * Converts a count of wrapped chip rows into the segment's laid-out height in pixels. The row count
 * is ignored in `baseline-text` mode, which has no chips to wrap.
 */
export function heightForRows(rows: number, config: HeightConfig): number {
  if (config.displayMode === 'baseline-text') return BASELINE_TEXT_HEIGHT_PX;
  const pitch = config.showMorphology
    ? ROW_PITCH_PX.withMorphology
    : ROW_PITCH_PX.withoutMorphology;
  const freeTranslation = config.showFreeTranslation ? FREE_TRANSLATION_PX : 0;
  return rows * pitch + SEGMENT_BASE_PX + freeTranslation;
}

/**
 * Predicts how many rows a segment's token chips wrap into.
 *
 * @param chipWidths - Each chip's laid-out width, in document order.
 * @param wrapWidth - Width of the box the chips wrap inside, narrower than the scroll container.
 * @returns The number of rows, at least 1 even for a segment with no chips.
 */
export function predictRowCount(chipWidths: readonly number[], wrapWidth: number): number {
  let rows = 1;
  let rowWidth = 0;
  chipWidths.forEach((chipWidth) => {
    // The gap falls between chips, so the first chip on a row is charged none.
    const needed = rowWidth === 0 ? chipWidth : rowWidth + CHIP_GAP_PX + chipWidth;
    if (needed > wrapWidth) {
      rows += 1;
      rowWidth = chipWidth;
    } else {
      rowWidth = needed;
    }
  });
  return rows;
}

/**
 * Measures the laid-out width of one token chip from its surface text, in pixels. An implementation
 * owns the chip's minimum width, so a chip whose text is narrower than that floor still measures
 * it.
 */
export type MeasureChipWidth = (surfaceText: string) => number;

/**
 * Per-segment heights for a whole book, with the prefix sums that turn a scroll offset into a
 * segment index and back.
 */
export type HeightTable = Readonly<{
  /** Predicted height of each segment, index-aligned with the book's segment list. */
  heights: readonly number[];
  /**
   * Running top edge of each segment, with a trailing entry for the bottom of the last one, so
   * `offsets` is always one longer than {@link HeightTable.heights}.
   */
  offsets: readonly number[];
  /** Total height of every segment — the scrollable height the list stands in for. */
  total: number;
}>;

/**
 * Predicts the height of every segment in a book and accumulates them into a {@link HeightTable}.
 * Each distinct surface form is measured only once.
 *
 * @param segments - The book's segments, in document order; the table is index-aligned with them.
 * @param config - View toggles the predicted heights are valid for.
 * @param wrapWidth - Width of the box a segment's chips wrap inside; a change invalidates the
 *   table.
 * @param measureChipWidth - Supplies each chip's width.
 */
export function buildHeightTable(
  segments: readonly Segment[],
  config: HeightConfig,
  wrapWidth: number,
  measureChipWidth: MeasureChipWidth,
): HeightTable {
  const widthByForm = new Map<string, number>();
  const measureCached = (surfaceText: string): number => {
    const cached = widthByForm.get(surfaceText);
    if (cached !== undefined) return cached;
    const width = measureChipWidth(surfaceText);
    widthByForm.set(surfaceText, width);
    return width;
  };

  const heights: number[] = [];
  const offsets: number[] = [0];
  segments.forEach((segment) => {
    // Punctuation renders inside a word chip rather than as a chip of its own.
    const chipWidths = segment.tokens
      .filter(isWordToken)
      .map((token) => measureCached(token.surfaceText));
    heights.push(heightForRows(predictRowCount(chipWidths, wrapWidth), config));
    offsets.push(offsets[offsets.length - 1] + heights[heights.length - 1]);
  });
  return { heights, offsets, total: offsets[offsets.length - 1] };
}

/**
 * Resolves a scroll offset to the index of the segment occupying it. A segment's own top edge
 * resolves to that segment rather than to its predecessor, and an offset outside the book clamps to
 * its first or last segment.
 *
 * @returns The segment index, or `-1` when the table has no segments.
 */
export function segmentIndexAtOffset(table: HeightTable, offset: number): number {
  const count = table.heights.length;
  /* v8 ignore next -- a rendered book always has segments to resolve an offset against */
  if (count === 0) return -1;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (table.offsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Returns the top edge of a segment, in pixels from the top of the book. */
export function offsetOfSegment(table: HeightTable, index: number): number {
  return table.offsets[index];
}
