import type { Segment } from 'interlinearizer';
import { isWordToken } from '../types/type-guards';

// The geometry constants below were measured in the running app (WEB, Psalms 1–2, 1872px panel).
// A prediction only ever sizes a segment that has never been mounted — a measured height supersedes
// it — so it needs to be close, not exact: it decides the scrollbar's proportions and where a thumb
// drag lands, and nothing else.

/** Width assumed for every chip, in pixels: the gloss field's minimum, which most chips sit at. */
const CHIP_WIDTH_PX = 65;

/** Horizontal space between two adjacent token chips, in pixels. */
const CHIP_GAP_PX = 32;

/** Height of one wrapped chip row, in pixels, by whether the morpheme box is shown. */
const ROW_PITCH_PX = { withMorphology: 124, withoutMorphology: 82 } as const;

/** Segment chrome above and below the chip rows (padding and the verse label row). */
const SEGMENT_BASE_PX = 8;

/** Extra height the free-translation field adds to a segment, independent of its row count. */
const FREE_TRANSLATION_PX = 34;

/** Width assumed for one character of plain baseline text, in pixels. */
const BASELINE_CHAR_PX = 8.4;

/** Height of one wrapped line of plain baseline text, in pixels. */
const BASELINE_TEXT_LINE_PX = 20;

/** Segment chrome above and below plain baseline text. */
const BASELINE_TEXT_BASE_PX = 18;

/** The view toggles that change a segment's laid-out height. */
export type HeightConfig = Readonly<{
  /** Whether the morpheme box (or its placeholder affordance) occupies a band in each chip. */
  showMorphology: boolean;
  /** Whether the segment carries a free-translation field below its chips. */
  showFreeTranslation: boolean;
  /** Which renderer the segment uses; `baseline-text` has no chips and so no rows. */
  displayMode: 'token-chip' | 'baseline-text';
  /**
   * Whether the verse gutter takes a column beside the segment's content. It adds no height of its
   * own, but narrows the box rows wrap inside, so it can change a segment's row count.
   */
  showVerseGutter: boolean;
  /**
   * Vertical space the list puts between every pair of adjacent segments, in pixels. Defaults to
   * `0`, measuring the segments alone. Space that only some gaps carry belongs in
   * {@link HeightConfig.extraGapPx} instead.
   */
  segmentGapPx?: number;
  /**
   * Extra gap above the segment at `index`, in pixels, for space only some gaps carry — a control
   * the list renders between certain pairs of segments but not others. Defaults to charging nothing
   * beyond {@link HeightConfig.segmentGapPx}.
   */
  extraGapPx?: (index: number) => number;
}>;

/**
 * Converts a count of wrapped rows into the segment's laid-out height in pixels. A row is a line of
 * chips in `token-chip` mode and a line of text in `baseline-text` mode.
 */
export function heightForRows(rows: number, config: HeightConfig): number {
  const freeTranslation = config.showFreeTranslation ? FREE_TRANSLATION_PX : 0;
  if (config.displayMode === 'baseline-text') {
    return rows * BASELINE_TEXT_LINE_PX + BASELINE_TEXT_BASE_PX + freeTranslation;
  }
  const pitch = config.showMorphology
    ? ROW_PITCH_PX.withMorphology
    : ROW_PITCH_PX.withoutMorphology;
  return rows * pitch + SEGMENT_BASE_PX + freeTranslation;
}

/**
 * Predicts how many rows `chipCount` chips wrap into inside a box `wrapWidth` wide (the segment's
 * content column, narrower than the scroll container), taking every chip at {@link CHIP_WIDTH_PX}.
 *
 * @returns The number of rows, at least 1 even for a segment with no chips.
 */
export function predictRowCount(chipCount: number, wrapWidth: number): number {
  // The gap falls between chips, so a row of n chips is n widths and n - 1 gaps wide.
  const chipsPerRow = Math.max(
    1,
    Math.floor((wrapWidth + CHIP_GAP_PX) / (CHIP_WIDTH_PX + CHIP_GAP_PX)),
  );
  return Math.max(1, Math.ceil(chipCount / chipsPerRow));
}

/**
 * Predicts how many lines a run of plain text wraps into, taking every character at
 * {@link BASELINE_CHAR_PX}.
 *
 * @returns The number of lines, at least 1 even for empty text.
 */
export function predictLineCount(text: string, wrapWidth: number): number {
  return Math.max(1, Math.ceil((text.length * BASELINE_CHAR_PX) / wrapWidth));
}

/**
 * Predicts the laid-out height of every segment, excluding the gap above it, for rows wrapping
 * inside a box `wrapWidth` wide. The result is index-aligned with `segments`.
 */
export function predictSegmentHeights(
  segments: readonly Segment[],
  config: HeightConfig,
  wrapWidth: number,
): readonly number[] {
  return segments.map((segment) => {
    const rows =
      config.displayMode === 'baseline-text'
        ? predictLineCount(segment.baselineText, wrapWidth)
        : // Punctuation renders inside a word chip rather than as a chip of its own.
          predictRowCount(segment.tokens.filter(isWordToken).length, wrapWidth);
    return heightForRows(rows, config);
  });
}

/**
 * Per-segment heights for a whole book, with the prefix sums that turn a scroll offset into a
 * segment index and back.
 */
export type HeightTable = Readonly<{
  /** Height of each segment, index-aligned with the book's segment list, including the gap above it. */
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
 * Accumulates a book's segment heights into a {@link HeightTable}, taking each segment at its
 * measured height where it has one and at its predicted height otherwise.
 *
 * @param segments - The book's segments, in document order; the table is index-aligned with them.
 * @param config - Supplies the gaps charged between segments.
 * @param predictedHeights - Predicted height of each segment, index-aligned with `segments`, as
 *   {@link predictSegmentHeights} builds it.
 * @param measuredHeightById - Laid-out height of each segment already mounted, which supersedes the
 *   prediction for that segment. Defaults to predicting every segment.
 */
export function buildHeightTable(
  segments: readonly Segment[],
  config: HeightConfig,
  predictedHeights: readonly number[],
  measuredHeightById?: ReadonlyMap<string, number>,
): HeightTable {
  const heights: number[] = [];
  const offsets: number[] = [0];
  segments.forEach((segment, index) => {
    // The gap above a segment belongs to it, leaving nothing above the first.
    const gap = index === 0 ? 0 : (config.segmentGapPx ?? 0) + (config.extraGapPx?.(index) ?? 0);
    const height = gap + (measuredHeightById?.get(segment.id) ?? predictedHeights[index]);
    heights.push(height);
    offsets.push(offsets[offsets.length - 1] + height);
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
