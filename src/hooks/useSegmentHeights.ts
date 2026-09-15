import type { Book } from 'interlinearizer';
import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { HeightConfig, HeightTable } from '../utils/segment-heights';
import { buildHeightTable, predictSegmentHeights } from '../utils/segment-heights';

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

/** Arguments for {@link useSegmentHeights}. */
export interface UseSegmentHeightsArgs {
  /** Book whose every segment is predicted, mounted or not. */
  book: Book;
  /** View toggles the predicted heights must be valid for; compared by identity, so memoize it. */
  config: HeightConfig;
  /** Ref to the element segments are laid out in; its width bounds where chip rows wrap. */
  containerRef: RefObject<HTMLElement | undefined>;
}

/** Predicts the laid-out height and offset of every segment in a book, whether or not it is mounted. */
export default function useSegmentHeights({
  book,
  config,
  containerRef,
}: UseSegmentHeightsArgs): HeightTable {
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

  const predicted = useMemo(
    () => predictSegmentHeights(book.segments, config, wrapWidth),
    [book.segments, config, wrapWidth],
  );

  return useMemo(() => buildHeightTable(config, predicted), [config, predicted]);
}
