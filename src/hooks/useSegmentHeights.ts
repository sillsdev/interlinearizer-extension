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
    hasFreeTranslation,
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

  // Heights of the segments that have actually been laid out. A segment's height also depends on
  // analysis state, which nothing here can derive it from.
  const [measuredHeightById, setMeasuredHeightById] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  // A measurement is only valid for the toggles and width it was taken under, so a change to any of
  // them discards every one and the segments are measured again as they lay out.
  useEffect(() => {
    setMeasuredHeightById((previous) => (previous.size === 0 ? previous : new Map()));
  }, [displayMode, showMorphology, showFreeTranslation, showVerseGutter, wrapWidth]);

  useEffect(() => {
    const container = containerRef.current;
    /* v8 ignore next -- the hook only runs while the list (and so the container) is mounted */
    if (!container) return undefined;

    const readHeights = () => {
      setMeasuredHeightById((previous) => {
        const next = new Map(previous);
        let changed = false;
        container.querySelectorAll('[data-segment-id]').forEach((el) => {
          /* v8 ignore next -- the [data-segment-id] selector guarantees a present attribute */
          const id = el.getAttribute('data-segment-id') ?? '';
          const { height } = el.getBoundingClientRect();
          // A culled segment reports zero; keep the last real height rather than collapsing it.
          if (height === 0) return;
          if (next.get(id) === height) return;
          next.set(id, height);
          changed = true;
        });
        return changed ? next : previous;
      });
    };

    // Reads on the next frame, never synchronously inside the observer callback: a measurement
    // updates the spacers, which resizes the content, which would re-enter the observer.
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        readHeights();
      });
    };

    // Resize catches a mounted segment changing height; mutation catches the window mounting and
    // culling segments, which is also when the set to observe changes.
    const observer = new ResizeObserver(schedule);
    const observeMounted = () => {
      observer.disconnect();
      container.querySelectorAll('[data-segment-id]').forEach((el) => observer.observe(el));
    };
    const mutations = new MutationObserver(() => {
      observeMounted();
      schedule();
    });
    mutations.observe(container, { childList: true, subtree: true });
    observeMounted();
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [containerRef, book.segments]);

  const { table, predictedTable } = useMemo(() => {
    // Each mode reads its font from the element it renders; baseline mode mounts no chip. Scoped to
    // this list, so nothing another part of the page mounts can be sampled in its place.
    const isBaseline = displayMode === 'baseline-text';
    const source = containerRef.current?.querySelector(
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
    const heightConfig = {
      displayMode,
      showMorphology,
      showFreeTranslation,
      hasFreeTranslation,
      showVerseGutter,
      segmentGapPx,
      extraGapPx,
    };
    return {
      table: buildHeightTable(book.segments, heightConfig, wrapWidth, measure, measuredHeightById),
      predictedTable: buildHeightTable(book.segments, heightConfig, wrapWidth, measure),
    };
  }, [
    book.segments,
    containerRef,
    measuredHeightById,
    displayMode,
    showMorphology,
    showFreeTranslation,
    hasFreeTranslation,
    showVerseGutter,
    segmentGapPx,
    extraGapPx,
    wrapWidth,
  ]);

  // Report mounted segments whose real height disagrees with the prediction, which is how a change
  // that invalidates the geometry constants becomes visible. Only predictedTable can disagree — the
  // table the list uses has adopted these same measurements.
  useEffect(() => {
    const measuredByIndex = new Map<number, number>();
    measuredHeightById.forEach((height, id) => {
      const index = indexBySegmentId.get(id);
      if (index !== undefined) measuredByIndex.set(index, height);
    });
    const drifts = findHeightDrift(predictedTable, measuredByIndex);
    if (drifts.length === 0) return;
    const worst = drifts.reduce((a, b) =>
      Math.abs(a.predicted - a.actual) >= Math.abs(b.predicted - b.actual) ? a : b,
    );
    logger.warn(
      `Interlinearizer: predicted segment height is out of date — ${drifts.length} of ` +
        `${measuredByIndex.size} mounted segments differ, worst at index ${worst.index} ` +
        `(predicted ${worst.predicted}px, measured ${worst.actual}px)`,
    );
  }, [predictedTable, indexBySegmentId, measuredHeightById]);

  return { table };
}
