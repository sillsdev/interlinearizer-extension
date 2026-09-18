import type { Segment } from 'interlinearizer';
import { isWordToken } from '../types/type-guards';

// The geometry constants below were measured in the running app (WEB, Psalms 1–2, 1872px panel).
// A prediction needs to be close, not exact: it decides the scrollbar's proportions and where a
// thumb drag lands, while the mounted segments lay out at whatever height they really have.

/** Width assumed for every chip, in pixels: the gloss field's minimum, which most chips sit at. */
const CHIP_WIDTH_PX = 65;

/** Horizontal space between two adjacent token chips, in pixels. */
const CHIP_GAP_PX = 32;

/**
 * Height of one wrapped chip row, in pixels, by whether the morpheme box is shown. Exact rather
 * than approximate, and in both directions: a row predicted tall makes every segment shrink as it
 * hydrates, a row predicted short makes every one grow, and a screenful either way shifts the text
 * under the reader.
 *
 * Solve each figure from two mounted segments of different row counts rather than estimating it —
 * `height = rows * pitch + base` over the pair gives both, and the error is otherwise invisible
 * until it accumulates across a screenful.
 */
const ROW_PITCH_PX = { withMorphology: 124, withoutMorphology: 82 } as const;

/** Segment chrome above and below the chip rows (padding and the verse label row). */
const SEGMENT_BASE_PX = 8;

/** Extra height one line of free translation adds to a segment, independent of its row count. */
const FREE_TRANSLATION_PX = 34;

/** Height each line after the first adds to a read-only free translation, which wraps. */
const FREE_TRANSLATION_WRAP_LINE_PX = 20;

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
  /**
   * The free translation the segment at `index` renders as wrapping plain text, or `undefined` for
   * a segment that renders none. Defaults to charging every segment the single line the editable
   * input always occupies, whatever it holds.
   */
  freeTranslationText?: (index: number) => string | undefined;
  /** Which renderer the segment uses; `baseline-text` has no chips and so no rows. */
  displayMode: 'token-chip' | 'baseline-text';
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
 * Height the free-translation field adds to the segment at `index`, counting the lines a read-only
 * translation wraps into. Returns `0` for a segment the view renders no field for.
 */
function freeTranslationHeight(config: HeightConfig, index: number, wrapWidth: number): number {
  // Absent accessor means the editable input, which is one line whatever it holds.
  if (!config.freeTranslationText) return FREE_TRANSLATION_PX;
  const text = config.freeTranslationText(index);
  if (text === undefined) return 0;
  return (
    FREE_TRANSLATION_PX + (predictLineCount(text, wrapWidth) - 1) * FREE_TRANSLATION_WRAP_LINE_PX
  );
}

/**
 * Converts a count of wrapped rows into the laid-out height in pixels of the segment at `index`. A
 * row is a line of chips in `token-chip` mode and a line of text in `baseline-text` mode, and
 * `wrapWidth` is the content column a read-only free translation wraps inside.
 */
export function heightForRows(
  rows: number,
  config: HeightConfig,
  index: number,
  wrapWidth: number,
): number {
  const freeTranslation = config.showFreeTranslation
    ? freeTranslationHeight(config, index, wrapWidth)
    : 0;
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
  return segments.map((segment, index) => {
    const rows =
      config.displayMode === 'baseline-text'
        ? predictLineCount(segment.baselineText, wrapWidth)
        : // Punctuation renders inside a word chip rather than as a chip of its own.
          predictRowCount(segment.tokens.filter(isWordToken).length, wrapWidth);
    return heightForRows(rows, config, index, wrapWidth);
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
 * Accumulates predicted segment heights into a {@link HeightTable}.
 *
 * @param config - Supplies the gaps charged between segments.
 * @param predictedHeights - Predicted height of each segment, index-aligned with the book's
 *   segments, as {@link predictSegmentHeights} builds it.
 */
export function buildHeightTable(
  config: HeightConfig,
  predictedHeights: readonly number[],
): HeightTable {
  const heights: number[] = [];
  const offsets: number[] = [0];
  predictedHeights.forEach((predicted, index) => {
    // The gap above a segment belongs to it, leaving nothing above the first.
    const gap = index === 0 ? 0 : (config.segmentGapPx ?? 0) + (config.extraGapPx?.(index) ?? 0);
    const height = gap + predicted;
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
