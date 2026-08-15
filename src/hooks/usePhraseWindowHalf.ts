import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Fewest phrase groups the strip keeps mounted on each side of the focused group, and the window it
 * starts with before its first measurement. Small enough that the first paint is cheap on a slow
 * machine, and wide enough to fill a narrow panel while the measurement catches up.
 */
export const MIN_PHRASE_WINDOW_HALF = 8;

/**
 * Most phrase groups the strip keeps mounted on each side of the focused group, whatever the
 * measurement says — a backstop so an implausible reading (a collapsed strip, a zero-width group)
 * cannot mount an entire book's worth of chips.
 */
export const MAX_PHRASE_WINDOW_HALF = 120;

/**
 * Viewport widths of phrase groups kept mounted on each side of the focused group. One width would
 * exactly reach the viewport's edge with the focus centered; the surplus absorbs a navigation step
 * and the reflows that widen the strip after mount (glosses, morpheme rows, arc padding) without
 * exposing an unmounted edge.
 */
const VIEWPORTS_PER_SIDE = 1.5;

/**
 * Granularity, in groups, that the half-window is rounded up to. Small viewport changes then leave
 * the window alone rather than mounting and unmounting a group for every pixel of a drag-resize.
 */
const WINDOW_HALF_STEP = 4;

const GROUP_SELECTOR = '[data-phrase-group="true"]';

/**
 * Tracks how many phrase groups the continuous strip should mount on each side of the focused
 * group, so a strip only ever carries a few viewports of chips rather than a fixed slab of them.
 *
 * The size is taken from what is on screen rather than assumed, so it follows the panel's width,
 * the reader's font size, and how wide the glosses in this particular text run. It keeps following
 * them: a viewport resize re-derives it, and so does each adjustment it makes, until the size
 * settles.
 *
 * @param viewportRef - The clipping element whose width the mounted content must cover.
 * @param contentRef - The element holding the mounted groups, sized to its content.
 * @returns Groups to mount on each side of the focus, within
 *   {@link MIN_PHRASE_WINDOW_HALF}–{@link MAX_PHRASE_WINDOW_HALF}.
 */
export default function usePhraseWindowHalf(
  viewportRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): number {
  const [windowHalf, setWindowHalf] = useState(MIN_PHRASE_WINDOW_HALF);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;

    const remeasure = () => {
      const contentWidth = content.scrollWidth;
      // A strip that has not been laid out yet measures zero wide, which would divide out to an
      // unbounded per-group width and clamp the window straight to its maximum — mounting the whole
      // book. Leave the window as it is until there is something real to divide.
      if (contentWidth <= 0) return;
      const groupCount = content.querySelectorAll(GROUP_SELECTOR).length;
      const groupsPerViewport = viewport.clientWidth / (contentWidth / groupCount);
      const wanted = Math.ceil((groupsPerViewport * VIEWPORTS_PER_SIDE) / WINDOW_HALF_STEP);
      const stepped = wanted * WINDOW_HALF_STEP;
      const clamped = Math.max(MIN_PHRASE_WINDOW_HALF, Math.min(stepped, MAX_PHRASE_WINDOW_HALF));
      setWindowHalf((prev) => (prev === clamped ? prev : clamped));
    };

    remeasure();
    // Only the viewport is observed. The window this hook sets changes the *content* width, so
    // observing the content instead would feed each adjustment straight back in as a new resize.
    const observer = new ResizeObserver(remeasure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef, contentRef, windowHalf]);

  return windowHalf;
}
