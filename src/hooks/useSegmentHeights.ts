import type { Book, Segment } from 'interlinearizer';
import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HeightConfig, HeightTable } from '../utils/segment-heights';
import { buildHeightTable, predictSegmentHeights } from '../utils/segment-heights';

/** Width used for the wrap box before the container has been laid out. */
const FALLBACK_WRAP_WIDTH_PX = 1000;

/** Stands in for the measurements of a layout nothing has been measured under yet. */
const EMPTY_HEIGHTS: ReadonlyMap<string, number> = new Map();

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

/** Arguments for {@link useSegmentHeights}. */
export interface UseSegmentHeightsArgs {
  /** Book whose every segment is measured, mounted or not. */
  book: Book;
  /** View toggles the predicted heights must be valid for. */
  config: HeightConfig;
  /** Ref to the element segments are laid out in; its width bounds where chip rows wrap. */
  containerRef: RefObject<HTMLElement | undefined>;
  /**
   * The segments currently mounted inside the container; a new array announces that segment
   * elements have come or gone.
   */
  windowSegments: readonly Segment[];
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
  windowSegments,
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

  // What a measured height is valid under. Segment identity counts because a segment id survives
  // the retokenization or boundary edit that replaces the segment wearing it.
  const layout = useMemo(
    () => ({
      segments: book.segments,
      displayMode,
      showMorphology,
      showFreeTranslation,
      showVerseGutter,
      wrapWidth,
    }),
    [book.segments, displayMode, showMorphology, showFreeTranslation, showVerseGutter, wrapWidth],
  );

  // Heights of the segments that have actually been laid out. A segment's height also depends on
  // analysis state, which nothing here can derive it from.
  const [measured, setMeasured] = useState<{
    layout: typeof layout;
    heightById: ReadonlyMap<string, number>;
  }>(() => ({ layout, heightById: new Map() }));

  // Discarded during render, so no committed render ever carries heights from a superseded layout.
  const measuredHeightById = measured.layout === layout ? measured.heightById : EMPTY_HEIGHTS;

  // Re-run whenever the window changes what it mounts, which is the only time segment elements
  // appear.
  useEffect(() => {
    const container = containerRef.current;
    /* v8 ignore next -- the hook only runs while the list (and so the container) is mounted */
    if (!container) return undefined;

    // Segments the observer has flagged as possibly stale. Measuring only these keeps a frame's
    // cost proportional to what moved rather than to the whole mounted list, whose every
    // `getBoundingClientRect` forces a synchronous layout.
    let dirty = new Set<Element>();

    const readHeights = () => {
      const pending = dirty;
      dirty = new Set();
      setMeasured((previous) => {
        const base = previous.layout === layout ? previous.heightById : EMPTY_HEIGHTS;
        let next: Map<string, number> | undefined;
        pending.forEach((el) => {
          // A segment culled between the flag and this read is no longer measurable.
          if (!el.isConnected) return;
          /* v8 ignore next -- the [data-segment-id] selector guarantees a present attribute */
          const id = el.getAttribute('data-segment-id') ?? '';
          const { height } = el.getBoundingClientRect();
          // A culled segment reports zero; keep the last real height rather than collapsing it.
          if (height === 0) return;
          if ((next ?? base).get(id) === height) return;
          next ??= new Map(base);
          next.set(id, height);
        });
        if (!next) return previous.layout === layout ? previous : { layout, heightById: base };
        return { layout, heightById: next };
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

    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => dirty.add(entry.target));
      schedule();
    });
    container.querySelectorAll('[data-segment-id]').forEach((el) => {
      observer.observe(el);
      dirty.add(el);
    });
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [containerRef, layout, windowSegments]);

  const heightConfig = useMemo(
    () => ({
      displayMode,
      showMorphology,
      showFreeTranslation,
      showVerseGutter,
      segmentGapPx,
      extraGapPx,
    }),
    [displayMode, showMorphology, showFreeTranslation, showVerseGutter, segmentGapPx, extraGapPx],
  );

  // Predicted apart from the measurements laid over it, so a measurement costs an accumulation
  // over the book rather than a fresh prediction of it.
  const predicted = useMemo(
    () => predictSegmentHeights(book.segments, heightConfig, wrapWidth),
    [book.segments, heightConfig, wrapWidth],
  );

  const table = useMemo(
    () => buildHeightTable(book.segments, heightConfig, predicted, measuredHeightById),
    [book.segments, heightConfig, predicted, measuredHeightById],
  );

  return { table };
}
