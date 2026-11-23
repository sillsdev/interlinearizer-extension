import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import type { WindowRange } from '../utils/scroll-window';
import { countCullableRun } from '../utils/scroll-window';
import useElementState from './useElementState';
import useExtendAnchor from './useExtendAnchor';
import useLatestRef from './useLatestRef';
import useSentinelExtend from './useSentinelExtend';

/**
 * Phrase groups mounted on each side of the anchor when the window is first built or recentered on
 * the focus. Deliberately small: the window grows on demand as the strip is scrolled, so this only
 * needs to fill a typical viewport plus a little overscan.
 */
export const INITIAL_WINDOW_HALF = 8;

/**
 * Phrase groups appended (or prepended) each time a scroll sentinel enters the viewport. Larger
 * chunks mean fewer observer firings but a coarser cull granularity.
 */
export const EXTEND_CHUNK = 8;

/**
 * Hard upper bound on how many phrase groups may be mounted at once. Culling is normally driven by
 * geometry, which sizes the window to the viewport plus retention margins regardless of how wide
 * the groups run, so this exists only as a runaway guard for degenerate layouts (a collapsed strip,
 * a zero-width group).
 */
export const HARD_WINDOW_CAP = 400;

/**
 * Distance (in pixels) beyond the viewport's inline edges at which a sentinel arms, so the strip is
 * filled ahead of the scroll and a reader never reaches an unmounted edge.
 */
const SENTINEL_ROOT_MARGIN_PX = 600;

/**
 * Distance (in pixels) beyond the viewport a mounted group must lie before an extend may cull it
 * from the opposite end. Strictly greater than {@link SENTINEL_ROOT_MARGIN_PX} so a cull can never
 * pull content back inside a sentinel's arming margin, which would re-fire that sentinel and
 * oscillate the window between its two edges.
 */
const CULL_RETENTION_PX = SENTINEL_ROOT_MARGIN_PX * 2;

/** Selects the mounted phrase-group wrappers the cull walk measures. */
const GROUP_SELECTOR = '[data-phrase-group="true"]';

/** Arguments for {@link usePhraseWindow}. */
export interface UsePhraseWindowArgs {
  /** Index of the first phrase group there is to mount; `0` when omitted. */
  first?: number;
  /** How many phrase groups there are to mount, from {@link first}; the window never runs past them. */
  total: number;
  /** Index of the focused phrase group, used as the anchor whenever the window recenters. */
  focusIndex: number;
  /**
   * Stable identity of the focused token, telling a focus that _moved_ from one an edit merely
   * renumbered: collapsing two groups into one shifts the index of every later group under a reader
   * who has focused none of them. Absent, the two are indistinguishable.
   */
  focusKey?: string;
  /** Ref to the clipping element the mounted groups must cover, under either ref convention. */
  viewportRef: RefObject<HTMLElement | undefined> | RefObject<HTMLElement | null>;
  /**
   * Absolute index of the first group the caller mounts, when it renders a wider span than
   * {@link UsePhraseWindowResult.range}. Culling is measured against the mounted groups and needs
   * this to place them; omit it when they are exactly the range. A ref because the caller derives
   * it from the range this hook returns.
   */
  renderedStartRef?: RefObject<number | undefined>;
}

/** Return value of {@link usePhraseWindow}. */
export interface UsePhraseWindowResult {
  /** The half-open slice of phrase groups currently mounted. */
  range: WindowRange;
  /** Ref callback for the invisible sentinel placed before the first mounted group. */
  leadingSentinelRef: (el: HTMLElement | null) => void;
  /** Ref callback for the invisible sentinel placed after the last mounted group. */
  trailingSentinelRef: (el: HTMLElement | null) => void;
  /**
   * Rebuilds the window centered on the focused group, which a scroll may have culled — leaving
   * nothing for a plain scroll-into-view to find. Centers on the focus and groups of the next
   * render, so groups changing in the same update are centered against.
   */
  recenterOnFocus: () => void;
}

/** Builds the half-open window range centered on an anchor group, clamped to `[first, end)`. */
function buildCenteredRange(anchorIndex: number, first: number, end: number): WindowRange {
  return {
    start: Math.max(first, anchorIndex - INITIAL_WINDOW_HALF),
    end: Math.min(end, anchorIndex + INITIAL_WINDOW_HALF + 1),
  };
}

/**
 * Manages a scroll-anchored window into the continuous strip's flat phrase-group list, so a strip
 * only ever carries a bounded number of groups however long the book is.
 *
 * The window is anchored to what is visible rather than to the focus, which is what lets a reader
 * scroll the strip away from the focused phrase: a focus the scrolling leaves behind is culled like
 * any other group, and comes back only through {@link UsePhraseWindowResult.recenterOnFocus}.
 *
 * A focus that _moves_ clear of the window is the one exception, and rebuilds it: that is a
 * navigation, which has somewhere to be shown — moving as judged by
 * {@link UsePhraseWindowArgs.focusKey}, not by index.
 */
export default function usePhraseWindow({
  first = 0,
  total,
  focusIndex,
  focusKey,
  viewportRef,
  renderedStartRef,
}: UsePhraseWindowArgs): UsePhraseWindowResult {
  const last = first + total;
  const [range, setRange] = useState<WindowRange>(() =>
    buildCenteredRange(focusIndex, first, last),
  );

  /**
   * Holds the visible content still across an extend, whatever width it added or culled on either
   * side. That stillness is what keeps the window from feeding itself: content shifted by a
   * mounting group carries a sentinel back inside its arming margin, mounting more groups with no
   * reader input behind any of it.
   */
  const extendAnchor = useExtendAnchor('horizontal', viewportRef);

  const rangeRef = useLatestRef(range);
  const boundsRef = useLatestRef({ first, last });

  /**
   * The focus the window last reconciled against. Held in state because it is written beside the
   * range below, and a render React discards has to drop both together: a reconciliation recorded
   * against a range that never committed would report the window rebuilt when it was not.
   */
  const [reconciledFocus, setReconciledFocus] = useState<string | number>(focusKey ?? focusIndex);
  const [isRecenterRequested, setIsRecenterRequested] = useState(false);

  // Rebuilt during the render that carries the new focus, so the destination mounts in the same
  // commit and the centering effects that run after it find it. An effect would paint one frame of
  // the old window and fire those effects against it.
  //
  // Keyed on identity, not index: rebuilding on a renumbered focus would drag a freely-scrolled
  // strip back to a phrase the reader had deliberately left.
  const currentFocus = focusKey ?? focusIndex;
  let nextRange = range;
  if (reconciledFocus !== currentFocus) {
    setReconciledFocus(currentFocus);
    if (focusIndex < range.start || focusIndex >= range.end) {
      nextRange = buildCenteredRange(focusIndex, first, last);
    }
  }
  if (isRecenterRequested) {
    setIsRecenterRequested(false);
    nextRange = buildCenteredRange(focusIndex, first, last);
  }

  // Groups that shrink under a window scrolled clear of the focus can strand it past the last of
  // them, which the reconciliation above does not cover: the focus index is clamped to the groups,
  // so a shrink behind it moves nothing for that guard to notice. The slice is then empty, and an
  // empty window cannot refill itself, having no mounted group left to measure an extend against.
  if (total > 0 && (nextRange.start >= last || nextRange.end <= first)) {
    nextRange = buildCenteredRange(focusIndex, first, last);
  } else if (total > 0 && (nextRange.start < first || nextRange.end > last)) {
    nextRange = { start: Math.max(first, nextRange.start), end: Math.min(last, nextRange.end) };
  }
  if (nextRange !== range) setRange(nextRange);

  /**
   * Extends the window by up to {@link EXTEND_CHUNK} groups at one edge, culling from the opposite
   * edge every mounted group lying wholly beyond {@link CULL_RETENTION_PX} of the viewport. Culling
   * by measured geometry rather than a fixed count sizes the window to the viewport plus its
   * retention margins whatever the groups' widths, and guarantees a cull can never pull content
   * back inside a sentinel's arming margin.
   *
   * Safe to call twice before a re-render, as one observer delivery carrying both sentinels does:
   * the second call extends the bounds the first produced rather than replacing them, and the two
   * mutations share the scroll anchor measured before either, which is the one whose displacement
   * accounts for both.
   *
   * @param edge - Which end to grow: `'leading'` prepends earlier groups, `'trailing'` appends
   *   later ones.
   */
  const extend = useCallback(
    (edge: 'leading' | 'trailing') => {
      const { start, end } = rangeRef.current;
      const bounds = boundsRef.current;
      if (edge === 'leading' ? start <= bounds.first : end >= bounds.last) return;
      const viewport = viewportRef.current;
      /* v8 ignore next -- extend is only reachable through the sentinel observer, which requires the viewport */
      if (!viewport) return;
      const els = Array.from(viewport.querySelectorAll(GROUP_SELECTOR));
      const viewportRect = viewport.getBoundingClientRect();
      const isRtl = document.documentElement.dir === 'rtl';
      /**
       * Whether a group lies wholly beyond the retention margin at the end opposite the one being
       * extended — the only groups an extend may cull.
       */
      const isBeyondRetention = (el: Element) => {
        const rect = el.getBoundingClientRect();
        // Later groups lie right of earlier ones in an LTR strip and left of them in an RTL one, so
        // the end a given extend culls from sits on the opposite side of the viewport in each.
        const cullPastRight = edge === 'leading' ? !isRtl : isRtl;
        return cullPastRight
          ? rect.left > viewportRect.right + CULL_RETENTION_PX
          : rect.right < viewportRect.left - CULL_RETENTION_PX;
      };
      const counted = countCullableRun(
        els,
        edge === 'leading' ? 'end' : 'start',
        isBeyondRetention,
      );
      const size = end - start;
      // A wider rendered span puts some counted groups outside the range on the culled side.
      // Charging the range for those would move its bounds past groups the walk retained, so that
      // overhang comes off the count first.
      const mountedStart = renderedStartRef?.current ?? start;
      const leadingOverhang = Math.max(0, start - mountedStart);
      const trailingOverhang = Math.max(0, mountedStart + els.length - end);
      // Held to what leaves a group behind: an empty range could never refill, having nothing
      // mounted to measure the next extend against.
      const cullable = Math.min(
        Math.max(0, counted - (edge === 'leading' ? trailingOverhang : leadingOverhang)),
        size - 1,
      );
      const grow = Math.min(EXTEND_CHUNK, HARD_WINDOW_CAP - (size - cullable));
      if (grow <= 0) return;
      // Anchor on the surviving edge group: the old first for a leading extend (culls take the
      // trailing end), the old last for a trailing extend (culls take the leading end).
      extendAnchor.record(edge === 'leading' ? els[0] : els.at(-1));
      const next =
        edge === 'leading'
          ? { start: Math.max(bounds.first, start - grow), end: end - cullable }
          : { start: start + cullable, end: Math.min(bounds.last, end + grow) };
      // Published to the ref as well as to state, which only a render would refresh, so a second
      // call before that render reads these bounds rather than the ones they replaced.
      rangeRef.current = next;
      setRange(next);
    },
    [viewportRef, rangeRef, boundsRef, renderedStartRef, extendAnchor],
  );

  // Before the browser paints, so an extend never shows as a jump.
  useLayoutEffect(() => {
    extendAnchor.restore();
  }, [range, extendAnchor]);

  const recenterOnFocus = useCallback(() => setIsRecenterRequested(true), []);

  const [leadingSentinel, leadingSentinelRef] = useElementState();
  const [trailingSentinel, trailingSentinelRef] = useElementState();

  // Groups arriving past an edge the window stopped at re-subscribe it too, since nothing else would.
  useSentinelExtend({
    root: viewportRef,
    sentinels: [
      ['leading', leadingSentinel],
      ['trailing', trailingSentinel],
    ],
    margin: SENTINEL_ROOT_MARGIN_PX,
    onReach: extend,
    resubscribeKeys: [range, first, last],
  });

  return { range, leadingSentinelRef, trailingSentinelRef, recenterOnFocus };
}
