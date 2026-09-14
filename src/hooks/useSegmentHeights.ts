import { logger } from '@papi/frontend';
import type { Book } from 'interlinearizer';
import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  createChipMeasurer,
  createTextMeasurer,
  getTextMetricsSource,
  readBaselineMetrics,
  readChipMetrics,
} from '../utils/chip-measurer';
import type { HeightConfig, HeightTable } from '../utils/segment-heights';
import { buildHeightTable, findHeightDrift } from '../utils/segment-heights';

/** Width used for the wrap box before the container has been laid out. */
const FALLBACK_WRAP_WIDTH_PX = 1000;

/**
 * Reads the width rows actually wrap inside — a mounted segment's content column, which every
 * horizontal inset between it and `container` has already been taken out of. Falls back to
 * `container` itself, which is wider by all of them, until the first segment mounts.
 *
 * @returns The wrap width in pixels, or `undefined` while nothing is laid out yet.
 */
function readWrapWidth(container: HTMLElement): number | undefined {
  const wrapBox = container.querySelector('[data-wrap-box]');
  const { width } = (wrapBox ?? container).getBoundingClientRect();
  return width || undefined;
}

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
    () => (containerRef.current && readWrapWidth(containerRef.current)) ?? FALLBACK_WRAP_WIDTH_PX,
  );

  // Re-read on a gutter toggle as well as on resizes: it narrows the wrap box while leaving the
  // container the same size, so no resize announces it.
  useEffect(() => {
    const container = containerRef.current;
    /* v8 ignore next -- the hook only runs while the list (and so the container) is mounted */
    if (!container) return undefined;
    const readWidth = () => {
      const width = readWrapWidth(container) ?? FALLBACK_WRAP_WIDTH_PX;
      setWrapWidth((previous) => (previous === width ? previous : width));
    };
    readWidth();
    const observer = new ResizeObserver(readWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, config.showVerseGutter]);

  // Depend on the configuration's values rather than its identity: a caller that assembles it
  // inline hands a fresh object every render, and rebuilding spans the whole book.
  const {
    displayMode,
    showMorphology,
    showFreeTranslation,
    showVerseGutter,
    segmentGapPx,
    extraGapPx,
  } = config;

  /** Segment id to its index in the book, for matching mounted elements to predicted heights. */
  const indexBySegmentId = useMemo(() => {
    const map = new Map<string, number>();
    book.segments.forEach((segment, index) => map.set(segment.id, index));
    return map;
  }, [book.segments]);

  const table = useMemo(() => {
    // Each mode reads its font from the element it renders; baseline mode mounts no chip.
    const isBaseline = displayMode === 'baseline-text';
    const source = document.querySelector(
      isBaseline ? '[data-baseline-run]' : '[data-segment-id] label',
    );
    let metrics;
    if (source) metrics = isBaseline ? readBaselineMetrics(source) : readChipMetrics(source);
    const context = metrics ? getTextMetricsSource() : undefined;
    // Baseline text is measured as a plain run; chips carry their own minimum width and padding.
    const build = isBaseline ? createTextMeasurer : createChipMeasurer;
    // The unmeasured fallback stands in for a whole segment's text in baseline mode, so it is a
    // line's width there rather than a chip's.
    const fallback = isBaseline ? wrapWidth : FALLBACK_CHIP_WIDTH_PX;
    const measure = metrics && context ? build(context, metrics) : () => fallback;
    return buildHeightTable(
      book.segments,
      {
        displayMode,
        showMorphology,
        showFreeTranslation,
        showVerseGutter,
        segmentGapPx,
        extraGapPx,
      },
      wrapWidth,
      measure,
    );
  }, [
    book.segments,
    displayMode,
    showMorphology,
    showFreeTranslation,
    showVerseGutter,
    segmentGapPx,
    extraGapPx,
    wrapWidth,
  ]);

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
