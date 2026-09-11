import type { Book } from 'interlinearizer';
import type { RefObject } from 'react';
import { useMemo } from 'react';
import { createChipMeasurer, getTextMetricsSource, readChipMetrics } from '../utils/chip-measurer';
import type { HeightConfig, HeightTable } from '../utils/segment-heights';
import { buildHeightTable } from '../utils/segment-heights';

/** Width used for the wrap box before the container has been laid out. */
const FALLBACK_WRAP_WIDTH_PX = 1000;

/**
 * Chip width assumed before any chip is mounted to measure, in pixels. Close to the width most
 * chips take, which is set by the gloss field's minimum rather than by the text.
 */
const FALLBACK_CHIP_WIDTH_PX = 65;

/** Arguments for {@link useSegmentHeights}. */
export interface UseSegmentHeightsArgs {
  /** Book whose every segment is measured, mounted or not. */
  book: Book;
  /** View toggles the predicted heights must be valid for. */
  config: HeightConfig;
  /** Ref to the element segments are laid out in; its width bounds where chip rows wrap. */
  containerRef: RefObject<HTMLElement | undefined>;
}

/** Return value of {@link useSegmentHeights}. */
export interface UseSegmentHeightsResult {
  /** Predicted height and offset of every segment in the book. */
  table: HeightTable;
}

/** Predicts the laid-out height of every segment in a book, whether or not it is mounted. */
export default function useSegmentHeights({
  book,
  config,
  containerRef,
}: UseSegmentHeightsArgs): UseSegmentHeightsResult {
  const wrapWidth = containerRef.current?.getBoundingClientRect().width || FALLBACK_WRAP_WIDTH_PX;

  // Depend on the configuration's values rather than its identity: a caller that assembles it
  // inline hands a fresh object every render, and rebuilding spans the whole book.
  const { displayMode, showMorphology, showFreeTranslation, segmentGapPx } = config;

  const table = useMemo(() => {
    const chip = document.querySelector('[data-segment-id] label');
    const metrics = chip ? readChipMetrics(chip) : undefined;
    const context = metrics ? getTextMetricsSource() : undefined;
    const measure =
      metrics && context ? createChipMeasurer(context, metrics) : () => FALLBACK_CHIP_WIDTH_PX;
    return buildHeightTable(
      book.segments,
      { displayMode, showMorphology, showFreeTranslation, segmentGapPx },
      wrapWidth,
      measure,
    );
  }, [book.segments, displayMode, showMorphology, showFreeTranslation, segmentGapPx, wrapWidth]);

  return { table };
}
