import { logger } from '@papi/frontend';
import type { Book } from 'interlinearizer';
import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  createChipMeasurer,
  createTextMeasurer,
  getTextMetricsSource,
  readChipMetrics,
} from '../utils/chip-measurer';
import type { HeightConfig, HeightTable } from '../utils/segment-heights';
import { buildHeightTable, findHeightDrift } from '../utils/segment-heights';

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
  // Held in state rather than read from the ref during render, so a resize rebuilds the table.
  const [wrapWidth, setWrapWidth] = useState(
    () => containerRef.current?.getBoundingClientRect().width || FALLBACK_WRAP_WIDTH_PX,
  );

  useEffect(() => {
    const container = containerRef.current;
    /* v8 ignore next -- the hook only runs while the list (and so the container) is mounted */
    if (!container) return undefined;
    const readWidth = () => {
      const width = container.getBoundingClientRect().width || FALLBACK_WRAP_WIDTH_PX;
      setWrapWidth((previous) => (previous === width ? previous : width));
    };
    readWidth();
    const observer = new ResizeObserver(readWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  // Depend on the configuration's values rather than its identity: a caller that assembles it
  // inline hands a fresh object every render, and rebuilding spans the whole book.
  const { displayMode, showMorphology, showFreeTranslation, segmentGapPx } = config;

  /** Segment id to its index in the book, for matching mounted elements to predicted heights. */
  const indexBySegmentId = useMemo(() => {
    const map = new Map<string, number>();
    book.segments.forEach((segment, index) => map.set(segment.id, index));
    return map;
  }, [book.segments]);

  const table = useMemo(() => {
    const chip = document.querySelector('[data-segment-id] label');
    const metrics = chip ? readChipMetrics(chip) : undefined;
    const context = metrics ? getTextMetricsSource() : undefined;
    // Baseline text is measured as a plain run; chips carry their own minimum width and padding.
    const build = displayMode === 'baseline-text' ? createTextMeasurer : createChipMeasurer;
    const measure = metrics && context ? build(context, metrics) : () => FALLBACK_CHIP_WIDTH_PX;
    return buildHeightTable(
      book.segments,
      { displayMode, showMorphology, showFreeTranslation, segmentGapPx },
      wrapWidth,
      measure,
    );
  }, [book.segments, displayMode, showMorphology, showFreeTranslation, segmentGapPx, wrapWidth]);

  // Report mounted segments whose real height disagrees with the prediction, which is how a change
  // that invalidates the geometry constants becomes visible.
  useEffect(() => {
    const measuredByIndex = new Map<number, number>();
    document.querySelectorAll('[data-segment-id]').forEach((el) => {
      /* v8 ignore next -- the [data-segment-id] selector guarantees a present attribute */
      const index = indexBySegmentId.get(el.getAttribute('data-segment-id') ?? '');
      if (index !== undefined) measuredByIndex.set(index, el.getBoundingClientRect().height);
    });
    const drifts = findHeightDrift(table, measuredByIndex);
    if (drifts.length === 0) return;
    const worst = drifts.reduce((a, b) =>
      Math.abs(a.predicted - a.actual) >= Math.abs(b.predicted - b.actual) ? a : b,
    );
    logger.warn(
      `Interlinearizer: predicted segment height is out of date — ${drifts.length} of ` +
        `${measuredByIndex.size} mounted segments differ, worst at index ${worst.index} ` +
        `(predicted ${worst.predicted}px, measured ${worst.actual}px)`,
    );
  }, [table, indexBySegmentId]);

  return { table };
}
