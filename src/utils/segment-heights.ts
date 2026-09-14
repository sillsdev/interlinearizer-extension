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
   * Whether the segment at `index` renders a free translation, for a view that omits the field for
   * some segments. Defaults to charging every segment for one.
   */
  hasFreeTranslation?: (index: number) => boolean;
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
 *
 * @param index - Which segment this is, for the config's per-segment allowances. Omit to charge the
 *   allowances every segment carries.
 */
export function heightForRows(rows: number, config: HeightConfig, index?: number): number {
  // Both renderers put the free-translation field below their rows, so its allowance is charged
  // outside the branch rather than within either arm.
  const rendersFreeTranslation =
    config.showFreeTranslation &&
    /* v8 ignore next -- the fallback is the documented default for an absent predicate */
    (index === undefined || (config.hasFreeTranslation?.(index) ?? true));
  const freeTranslation = rendersFreeTranslation ? FREE_TRANSLATION_PX : 0;
  if (config.displayMode === 'baseline-text') {
    return rows * BASELINE_TEXT_LINE_PX + BASELINE_TEXT_BASE_PX + freeTranslation;
  }
  const pitch = config.showMorphology
    ? ROW_PITCH_PX.withMorphology
    : ROW_PITCH_PX.withoutMorphology;
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
    // A chip wider than the box overflows the row it starts, rather than opening another below it.
    if (needed > wrapWidth && rowWidth !== 0) {
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
 * Predicts how many lines a run of plain text wraps into. Breaks only between words, leaving a word
 * wider than the box on its own overflowing line, as the default `overflow-wrap` does.
 *
 * @param text - The run's text; runs of whitespace collapse to a single space, as in normal flow.
 * @param wrapWidth - Width of the box the text wraps inside.
 * @param measureText - Supplies the laid-out width of a string.
 * @returns The number of lines, at least 1 even for empty text.
 */
export function predictLineCount(
  text: string,
  wrapWidth: number,
  measureText: MeasureChipWidth,
): number {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return 1;
  const spaceWidth = measureText(' ');
  let lines = 1;
  let lineWidth = 0;
  words.forEach((word) => {
    const wordWidth = measureText(word);
    const needed = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
    if (needed > wrapWidth && lineWidth !== 0) {
      lines += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = needed;
    }
  });
  return lines;
}

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
 * Each distinct word is measured only once.
 *
 * @param segments - The book's segments, in document order; the table is index-aligned with them.
 * @param config - View toggles the predicted heights are valid for.
 * @param wrapWidth - Width of the box a segment's chips wrap inside; a change invalidates the
 *   table.
 * @param measureChipWidth - Supplies each chip's width.
 * @param measuredHeightById - Laid-out height of each segment already mounted, which supersedes the
 *   prediction for that segment. Defaults to predicting every segment.
 */
export function buildHeightTable(
  segments: readonly Segment[],
  config: HeightConfig,
  wrapWidth: number,
  measureChipWidth: MeasureChipWidth,
  measuredHeightById?: ReadonlyMap<string, number>,
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
  segments.forEach((segment, index) => {
    const rows =
      config.displayMode === 'baseline-text'
        ? // Baseline text wraps as one continuous run, breaking only between words.
          predictLineCount(segment.baselineText, wrapWidth, measureCached)
        : // Punctuation renders inside a word chip rather than as a chip of its own.
          predictRowCount(
            segment.tokens.filter(isWordToken).map((token) => measureCached(token.surfaceText)),
            wrapWidth,
          );
    // The gap above a segment belongs to it, leaving nothing above the first.
    const gap = index === 0 ? 0 : (config.segmentGapPx ?? 0) + (config.extraGapPx?.(index) ?? 0);
    // Analysis state — a gloss widening a chip, an arc's clearance padding — moves a segment in
    // ways the prediction cannot see, so a measurement of it wins.
    const measured = measuredHeightById?.get(segment.id);
    heights.push(gap + (measured ?? heightForRows(rows, config, index)));
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

/**
 * Largest difference between a predicted and a measured height that is not treated as drift, in
 * pixels. Sub-pixel layout rounding alone can produce a difference this size.
 */
const HEIGHT_DRIFT_TOLERANCE_PX = 0.5;

/** One segment whose measured height disagrees with the table's prediction. */
export type HeightDrift = Readonly<{
  /** Index of the segment in the book, as the table keys it. */
  index: number;
  /** Height the table predicted, in pixels. */
  predicted: number;
  /** Height the segment actually laid out to, in pixels. */
  actual: number;
}>;

/**
 * Compares measured segment heights against their predictions, surfacing a change that has
 * invalidated the geometry constants. An index the table does not cover is skipped.
 *
 * @param measuredByIndex - Laid-out height of each segment currently mounted, in pixels.
 * @returns Every segment that drifted, in index order; empty when the predictions hold.
 */
export function findHeightDrift(
  table: HeightTable,
  measuredByIndex: ReadonlyMap<number, number>,
): HeightDrift[] {
  const drifts: HeightDrift[] = [];
  measuredByIndex.forEach((actual, index) => {
    const predicted = table.heights[index];
    if (predicted === undefined) return;
    if (Math.abs(predicted - actual) > HEIGHT_DRIFT_TOLERANCE_PX) {
      drifts.push({ index, predicted, actual });
    }
  });
  return drifts.sort((a, b) => a.index - b.index);
}
