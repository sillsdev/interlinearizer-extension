import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import useLatestRef from './useLatestRef';

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

/** A half-open `[start, end)` range of indices into the strip's flat phrase-group list. */
export type WindowRange = Readonly<{ start: number; end: number }>;

/** Arguments for {@link usePhraseWindow}. */
export interface UsePhraseWindowArgs {
  /** How many phrase groups the whole book has; the window never runs past it. */
  total: number;
  /** Index of the focused phrase group, used as the anchor whenever the window recenters. */
  focusIndex: number;
  /** Ref to the clipping element the mounted groups must cover, under either ref convention. */
  viewportRef: RefObject<HTMLElement | undefined> | RefObject<HTMLElement | null>;
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
   * nothing for a plain scroll-into-view to find.
   */
  recenterOnFocus: () => void;
}

/** Builds the half-open window range centered on an anchor group, clamped to the book. */
function buildCenteredRange(anchorIndex: number, total: number): WindowRange {
  const start = Math.max(0, anchorIndex - INITIAL_WINDOW_HALF);
  const end = Math.min(total, anchorIndex + INITIAL_WINDOW_HALF + 1);
  return { start, end };
}

/**
 * Manages a scroll-anchored window into the continuous strip's flat phrase-group list, so a strip
 * only ever carries a bounded number of groups however long the book is.
 *
 * The window is anchored to what is visible rather than to the focus, which is what lets a reader
 * scroll the strip away from the focused phrase: the focus may be culled, and is brought back only
 * by {@link UsePhraseWindowResult.recenterOnFocus}.
 */
export default function usePhraseWindow({
  total,
  focusIndex,
  viewportRef,
}: UsePhraseWindowArgs): UsePhraseWindowResult {
  const [range, setRange] = useState<WindowRange>(() => buildCenteredRange(focusIndex, total));

  /**
   * Scroll anchor owed to the next paint after an extend mutates the window: a group that survives
   * it, and the inline offset it held just before. Restoring that offset holds the visible content
   * still, whatever width the mutation added or culled on either side.
   *
   * That stillness is what keeps the window from feeding itself — content shifted by a mounting
   * group carries a sentinel back inside its arming margin, mounting more groups with no reader
   * input behind any of it.
   */
  const pendingExtendAnchorRef = useRef<{ el: Element; left: number } | undefined>(undefined);

  const rangeRef = useLatestRef(range);
  const totalRef = useLatestRef(total);
  const focusIndexRef = useLatestRef(focusIndex);

  /**
   * Extends the window by up to {@link EXTEND_CHUNK} groups at one edge, culling from the opposite
   * edge every mounted group lying wholly beyond {@link CULL_RETENTION_PX} of the viewport. Culling
   * by measured geometry rather than a fixed count sizes the window to the viewport plus its
   * retention margins whatever the groups' widths, and guarantees a cull can never pull content
   * back inside a sentinel's arming margin.
   *
   * @param edge - Which end to grow: `'leading'` prepends earlier groups, `'trailing'` appends
   *   later ones.
   */
  const extend = useCallback(
    (edge: 'leading' | 'trailing') => {
      const { start, end } = rangeRef.current;
      const currentTotal = totalRef.current;
      if (edge === 'leading' ? start === 0 : end >= currentTotal) return;
      const viewport = viewportRef.current;
      /* v8 ignore next -- extend is only reachable through the sentinel observer, which requires the viewport */
      if (!viewport) return;
      const els = Array.from(viewport.querySelectorAll(GROUP_SELECTOR));
      const viewportRect = viewport.getBoundingClientRect();
      // The cullable run is contiguous from the far edge inward, so the walk stops at the first
      // group still within the retention margin.
      let cullable = 0;
      if (edge === 'leading') {
        for (let i = els.length - 1; i >= 0; i -= 1) {
          if (els[i].getBoundingClientRect().left <= viewportRect.right + CULL_RETENTION_PX) break;
          cullable += 1;
        }
      } else {
        for (let i = 0; i < els.length; i += 1) {
          if (els[i].getBoundingClientRect().right >= viewportRect.left - CULL_RETENTION_PX) break;
          cullable += 1;
        }
      }
      const size = end - start;
      const grow = Math.min(EXTEND_CHUNK, HARD_WINDOW_CAP - (size - cullable));
      if (grow <= 0) return;
      // Anchor on the surviving edge group: the old first for a leading extend (culls take the
      // trailing end), the old last for a trailing extend (culls take the leading end).
      const anchorEl = edge === 'leading' ? els[0] : els[els.length - 1];
      if (anchorEl) {
        pendingExtendAnchorRef.current = {
          el: anchorEl,
          left: anchorEl.getBoundingClientRect().left,
        };
      }
      if (edge === 'leading') {
        setRange({ start: Math.max(0, start - grow), end: end - cullable });
      } else {
        setRange({ start: start + cullable, end: Math.min(currentTotal, end + grow) });
      }
    },
    [viewportRef, rangeRef, totalRef],
  );

  // Reconcile the scroll position to the freshly-mounted range before the browser paints, so an
  // extend never shows as a jump. Adding the anchor's measured displacement to `scrollLeft` restores
  // it — and everything visible with it — to the offset it held before the mutation. Self-clears, so
  // renders that changed no bounds leave the position alone.
  useLayoutEffect(() => {
    const anchor = pendingExtendAnchorRef.current;
    if (anchor === undefined) return;
    pendingExtendAnchorRef.current = undefined;
    const viewport = viewportRef.current;
    /* v8 ignore next -- an extend only runs while the viewport is mounted */
    if (!viewport || !anchor.el.isConnected) return;
    const delta = anchor.el.getBoundingClientRect().left - anchor.left;
    if (delta !== 0) viewport.scrollLeft += delta;
  }, [range, viewportRef]);

  const recenterOnFocus = useCallback(() => {
    setRange(buildCenteredRange(focusIndexRef.current, totalRef.current));
  }, [focusIndexRef, totalRef]);

  // The mounted sentinel elements, held in state so the observer effect re-runs once they attach.
  // Ref callbacks only record the node; the observe happens in the effect below, which runs after
  // React has attached every ref — including the viewport, an ancestor. Wiring the observer inside
  // the ref callbacks would run before the viewport's own ref, leaving no root to observe against.
  const [leadingSentinel, setLeadingSentinel] = useState<HTMLElement | undefined>(undefined);
  const [trailingSentinel, setTrailingSentinel] = useState<HTMLElement | undefined>(undefined);

  const leadingSentinelRef = useCallback(
    (el: HTMLElement | null) => setLeadingSentinel(el ?? undefined),
    [],
  );
  const trailingSentinelRef = useCallback(
    (el: HTMLElement | null) => setTrailingSentinel(el ?? undefined),
    [],
  );

  const extendRef = useLatestRef(extend);

  // Extend the window whenever either sentinel nears the viewport. Re-subscribes on every range
  // change because an IntersectionObserver only fires on intersection transitions: after an extend
  // the sentinel nodes are unchanged and may still sit inside the arming margin, so a stale observer
  // would stay silent however far the strip is scrolled. A fresh observer re-delivers the initial
  // state, extending one chunk per delivery until the sentinel leaves the margin. The loop
  // terminates because a delivery that cannot grow — the book edge or the hard cap — leaves the
  // range untouched, and no range change means no re-subscription to deliver again.
  useEffect(() => {
    const root = viewportRef.current;
    if (!root || (!leadingSentinel && !trailingSentinel)) return undefined;
    const edges = new WeakMap<Element, 'leading' | 'trailing'>();
    if (leadingSentinel) edges.set(leadingSentinel, 'leading');
    if (trailingSentinel) edges.set(trailingSentinel, 'trailing');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const edge = edges.get(entry.target);
          /* v8 ignore next -- every observed sentinel is registered in the edge map */
          if (edge) extendRef.current(edge);
        });
      },
      { root, rootMargin: `${SENTINEL_ROOT_MARGIN_PX}px`, threshold: 0 },
    );
    if (leadingSentinel) observer.observe(leadingSentinel);
    if (trailingSentinel) observer.observe(trailingSentinel);
    return () => observer.disconnect();
  }, [viewportRef, leadingSentinel, trailingSentinel, range, extendRef]);

  return { range, leadingSentinelRef, trailingSentinelRef, recenterOnFocus };
}
