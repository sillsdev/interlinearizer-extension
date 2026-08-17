import { useLayoutEffect, useState, type RefObject } from 'react';
import useLatestRef from './useLatestRef';

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

/**
 * Groups sampled around the focus to measure the mean pitch. Sized so the whole run is mounted at
 * every window size the hook can return, which is what keeps the measurement independent of the
 * window it feeds.
 */
const SAMPLE_GROUPS = MIN_PHRASE_WINDOW_HALF + 1;

const GROUP_SELECTOR = '[data-phrase-group="true"]';

/**
 * Measures the mean horizontal pitch of the sampled groups: the distance from one group's leading
 * edge to the next's, so the link slot and punctuation between them count toward the space a group
 * occupies.
 *
 * The reading does not depend on how many groups are mounted, which is what lets the window narrow
 * as freely as it widens: an adjustment measures back to the value that caused it, so the sequence
 * stops rather than chasing itself.
 *
 * @param groups - Every mounted group wrapper, in document order.
 * @param focusGroup - The focused group's wrapper, or `undefined` before it has been recorded, in
 *   which case the sample centers on the mounted row instead.
 * @returns Pixels per group, or `undefined` while the strip has nothing measurable laid out.
 */
function measureGroupPitch(groups: Element[], focusGroup: Element | undefined): number | undefined {
  if (groups.length < 2) return undefined;
  const lastIndex = groups.length - 1;
  const focusIndex = focusGroup === undefined ? -1 : groups.indexOf(focusGroup);
  const center = focusIndex < 0 ? Math.floor(groups.length / 2) : focusIndex;
  // Sliding the run back inside the row keeps it window-independent: a run cut short is short
  // because the *book* ended there, not because the window did.
  const reach = Math.floor(SAMPLE_GROUPS / 2);
  let start = center - reach;
  let end = center + reach;
  if (start < 0) {
    end = Math.min(lastIndex, end - start);
    start = 0;
  }
  if (end > lastIndex) {
    start = Math.max(0, start - (end - lastIndex));
    end = lastIndex;
  }
  const first = groups[start].getBoundingClientRect();
  const last = groups[end].getBoundingClientRect();
  // Absolute, so the reading is the same in an RTL strip, where document order runs right to left.
  const pitch = Math.abs(last.left - first.left) / (end - start);
  return pitch > 0 ? pitch : undefined;
}

/**
 * Tracks how many phrase groups the continuous strip should mount on each side of the focused
 * group, so a strip only ever carries a few viewports of chips rather than a fixed slab of them.
 *
 * The size is taken from what is on screen rather than assumed, so it follows the panel's width,
 * the reader's font size, and how wide the glosses in this particular text run. It keeps following
 * them: a panel resize re-derives the window, and so does a change to the strip's own geometry at
 * an unchanged panel width — the gloss placeholder resolving after mount, or morpheme rows widening
 * every group.
 *
 * Termination rests on the measurement being independent of the window it feeds: an adjustment
 * measures back to the value that caused it, so the sequence stops. A window-dependent measurement
 * could not be allowed to narrow at all, since two sizes would each measure into the other and
 * never settle.
 *
 * @param viewportRef - The clipping element whose width the mounted content must cover.
 * @param contentRef - The element holding the mounted groups, sized to its content.
 * @param getFocusGroup - Reads the focused group's wrapper element; the sample centers on it. Need
 *   not keep a stable identity across renders.
 * @returns Groups to mount on each side of the focus, within
 *   {@link MIN_PHRASE_WINDOW_HALF}–{@link MAX_PHRASE_WINDOW_HALF}.
 */
export default function usePhraseWindowHalf(
  viewportRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  getFocusGroup: () => Element | undefined,
): number {
  const [windowHalf, setWindowHalf] = useState(MIN_PHRASE_WINDOW_HALF);
  const getFocusGroupRef = useLatestRef(getFocusGroup);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return undefined;

    const remeasure = () => {
      const groups = Array.from(content.querySelectorAll(GROUP_SELECTOR));
      const pitch = measureGroupPitch(groups, getFocusGroupRef.current());
      // A strip that has not been laid out yet measures every group at the same place, which would
      // divide out to an unbounded group count and clamp the window straight to its maximum —
      // mounting the whole book. Leave the window as it is until there is something real to divide.
      if (pitch === undefined) return;
      const groupsPerViewport = viewport.clientWidth / pitch;
      const wanted = Math.ceil((groupsPerViewport * VIEWPORTS_PER_SIDE) / WINDOW_HALF_STEP);
      const stepped = wanted * WINDOW_HALF_STEP;
      const measured = Math.max(MIN_PHRASE_WINDOW_HALF, Math.min(stepped, MAX_PHRASE_WINDOW_HALF));
      setWindowHalf((prev) => (prev === measured ? prev : measured));
    };

    remeasure();
    const observer = new ResizeObserver(remeasure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [viewportRef, contentRef, getFocusGroupRef]);

  return windowHalf;
}
