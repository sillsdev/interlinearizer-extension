import type { Book, Segment } from 'interlinearizer';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RECENTER_FADE_MS } from '../components/recenter-fade';

/**
 * Number of segments rendered on each side of the anchor when the window is first built or
 * recentered on the active verse. Hard-coded (never user-configurable) and deliberately small: the
 * window grows on demand as the user scrolls, so this only needs to fill a typical viewport plus a
 * little overscan.
 */
const INITIAL_HALF_WINDOW = 8;

/**
 * Number of segments appended (or prepended) each time a scroll sentinel enters the viewport.
 * Larger chunks mean fewer observer firings but a coarser cull granularity.
 */
const EXTEND_CHUNK = 6;

/**
 * Upper bound on how many segments may be mounted at once. When extending one end past this cap,
 * the opposite end is culled back to it. Keeps the DOM small so the list stays responsive and the
 * scrollbar stays effectively redundant (its thumb size reflects only the mounted window, not the
 * whole book).
 */
const MAX_WINDOW_SIZE = 30;

/**
 * Root margin (in pixels) around the scroll container used to arm the sentinels before they are
 * actually visible. Pre-loading just off-screen keeps the list filled ahead of the scroll so the
 * user never reaches an empty edge.
 */
const SENTINEL_ROOT_MARGIN_PX = 400;

/** A half-open `[start, end)` range of indices into the book's flat segment list. */
type WindowRange = Readonly<{ start: number; end: number }>;

/**
 * Builds a stable string key identifying the verse a reference names. The parent stamps
 * `internalNavRef` with this key before an internally-originated navigation, and the hook compares
 * the incoming `scrRef`'s key against it, so internal navigation can be told apart from external.
 * Exported so the parent keys the ref with the exact same format the hook reads.
 *
 * @param ref - The scripture reference to key.
 * @returns A `book:chapter:verse` string uniquely identifying the verse.
 */
export function verseKey(ref: SerializedVerseRef): string {
  return `${ref.book}:${ref.chapterNum}:${ref.verseNum}`;
}

/** Arguments for {@link useSegmentWindow}. */
export interface UseSegmentWindowArgs {
  /** The fully tokenized book whose flat `segments` list the window slices. */
  book: Book;
  /** Current scripture reference; the active verse it names is the recenter anchor. */
  scrRef: SerializedVerseRef;
  /** Ref to the scrollable list container; used to read/adjust scroll position and host sentinels. */
  scrollContainerRef: RefObject<HTMLElement | undefined>;
  /**
   * Mutable ref holding the verse key (see {@link verseKey}) of the most recent scripture-reference
   * change the parent originated _internally_ — a segment/token click in the list, or arrow nav in
   * the continuous strip echoed back through `scrRef`. The hook compares it against the incoming
   * `scrRef`: a match means the change came from within the views (no fade — the target is already
   * shown), while a mismatch means an external navigation (Paratext selector, scroll group) and
   * triggers the recenter fade. The hook clears the ref once consumed so a later external change to
   * the same verse still fades.
   */
  internalNavRef: RefObject<string | undefined>;
}

/** Return value of {@link useSegmentWindow}. */
export interface UseSegmentWindowResult {
  /** The slice of `book.segments` currently mounted, in book order. */
  windowSegments: Segment[];
  /** `true` while the window is faded out mid-recenter; drives the list's opacity transition. */
  isFaded: boolean;
  /**
   * Scripture reference the list should highlight as active. Lags the live `scrRef` through a
   * recenter fade so the active-verse highlight only moves once the window swaps behind the fade —
   * never before it starts. For internal nav and the initial mount it tracks `scrRef` immediately.
   * Mirrors ContinuousView's `displayFocusedTokenRef`, so the two views' highlights move in
   * lockstep.
   */
  displayScrRef: SerializedVerseRef;
  /** Ref callback for the invisible sentinel placed above the first segment. */
  topSentinelRef: (el: HTMLElement | null) => void;
  /** Ref callback for the invisible sentinel placed below the last segment. */
  bottomSentinelRef: (el: HTMLElement | null) => void;
}

/**
 * Finds the index in `segments` of the segment that owns the verse named by `scrRef`. Matches on
 * book, chapter, and verse so a window that spans chapters resolves the anchor unambiguously. Falls
 * back to the first segment of the same book+chapter, then to `0`, so there is always a valid
 * anchor.
 *
 * @param segments - The book's flat segment list.
 * @param scrRef - The scripture reference whose owning segment to locate.
 * @returns The index of the anchor segment, clamped to a valid position (or `0` when empty).
 */
function findAnchorIndex(segments: readonly Segment[], scrRef: SerializedVerseRef): number {
  const exact = segments.findIndex(
    (seg) =>
      seg.startRef.book === scrRef.book &&
      seg.startRef.chapter === scrRef.chapterNum &&
      seg.startRef.verse === scrRef.verseNum,
  );
  if (exact !== -1) return exact;
  const chapter = segments.findIndex(
    (seg) => seg.startRef.book === scrRef.book && seg.startRef.chapter === scrRef.chapterNum,
  );
  return chapter === -1 ? 0 : chapter;
}

/**
 * Builds the initial/recentered window range surrounding `anchorIndex`, clamped to `[0, total)` and
 * never wider than {@link MAX_WINDOW_SIZE}.
 *
 * @param anchorIndex - Index of the segment to center on.
 * @param total - Total number of segments in the book.
 * @returns The half-open window range to mount.
 */
function buildCenteredRange(anchorIndex: number, total: number): WindowRange {
  const start = Math.max(0, anchorIndex - INITIAL_HALF_WINDOW);
  const end = Math.min(total, anchorIndex + INITIAL_HALF_WINDOW + 1);
  return { start, end };
}

/**
 * Manages a scroll-anchored, infinitely-scrolling window into a book's flat segment list.
 *
 * Unlike the continuous strip (which centers its render window on the _focused_ token), this window
 * is anchored to what is _visible_: it grows and culls at whichever end the user scrolls toward, so
 * only a bounded number of segments are ever mounted and the scrollbar reflects just that window.
 * The window spans chapter boundaries but never leaves the loaded book.
 *
 * On external navigation (an `scrRef` change the parent did not originate internally) the window
 * fades out, rebuilds centered on the new verse, snaps that verse into view behind the fade, and
 * fades back in — on the same clock and easing as the continuous strip, so the two views animate as
 * one. This happens for _every_ external navigation, even when the new verse already sits inside
 * the mounted window, so the fade and the strip's fade can never disagree. Internal navigation (a
 * segment/token click here, or strip arrow nav echoed back) skips the fade entirely: the target is
 * already on screen.
 *
 * @param args - Hook arguments.
 * @param args.book - The tokenized book whose `segments` are windowed.
 * @param args.scrRef - Current scripture reference; its verse is the recenter anchor.
 * @param args.scrollContainerRef - Ref to the scrollable list container.
 * @param args.internalNavRef - Ref holding the verse key of the last internally-originated nav;
 *   used to suppress the fade for navigation that came from within the views.
 * @returns The mounted segment slice, fade state, and the two sentinel ref callbacks.
 */
export default function useSegmentWindow({
  book,
  scrRef,
  scrollContainerRef,
  internalNavRef,
}: UseSegmentWindowArgs): UseSegmentWindowResult {
  const { segments } = book;
  const total = segments.length;

  const anchorIndex = useMemo(() => findAnchorIndex(segments, scrRef), [segments, scrRef]);

  const [range, setRange] = useState<WindowRange>(() => buildCenteredRange(anchorIndex, total));
  const [isFaded, setIsFaded] = useState(false);

  /**
   * Scripture reference the active-verse highlight tracks. Held in state (rather than reading
   * `scrRef` directly) so an external nav can defer it to the recenter's midpoint — the highlight
   * then moves with the window swap, behind the fade, instead of jumping the instant `scrRef`
   * changes. Updated immediately for internal nav and the initial value.
   */
  const [displayScrRef, setDisplayScrRef] = useState<SerializedVerseRef>(scrRef);

  /**
   * Scroll-height correction owed to the next paint. When segments are prepended the content above
   * the viewport grows; recording the pre-mutation `scrollHeight` lets the layout effect restore
   * the visual scroll position so the list doesn't jump under the user.
   */
  const pendingPrependAnchorRef = useRef<number | undefined>(undefined);

  /**
   * Set when a recenter rebuilds the window, signaling the layout effect to snap the active verse
   * (the element marked `aria-current="true"`) to the top of the list. The snap happens behind the
   * fade so the jump is never seen; clearing the flag after one snap keeps later range changes
   * (scroll extends/culls) from re-snapping.
   */
  const pendingRecenterSnapRef = useRef(false);

  /**
   * Bumped once per recenter. Two effects key off it: the post-paint re-snap (which corrects the
   * verse position after the freshly-mounted segments settle to their final heights — arc padding
   * is applied asynchronously, so the synchronous layout-effect snap alone can land the verse off
   * screen) and the sentinel observer (which must re-observe so the browser re-delivers the initial
   * intersection state for the new geometry — without it the bottom sentinel can sit intersecting
   * yet silent, so scrolling down does nothing until an up-then-down gesture forces a transition).
   */
  const [recenterEpoch, setRecenterEpoch] = useState(0);

  /** Latest range, mirrored so the observer callbacks read fresh bounds without re-subscribing. */
  const rangeRef = useRef(range);
  rangeRef.current = range;

  /**
   * Extends the window by {@link EXTEND_CHUNK} segments at one edge, culling the opposite edge back
   * to {@link MAX_WINDOW_SIZE}. When prepending, records the container's current `scrollHeight` so
   * the layout effect can compensate for the inserted height and keep the viewport anchored.
   *
   * @param edge - Which end to grow: `'top'` prepends earlier segments, `'bottom'` appends later
   *   ones.
   */
  const extend = useCallback(
    (edge: 'top' | 'bottom') => {
      const { start, end } = rangeRef.current;
      if (edge === 'top') {
        if (start === 0) return;
        const nextStart = Math.max(0, start - EXTEND_CHUNK);
        const nextEnd = Math.min(end, nextStart + MAX_WINDOW_SIZE);
        const container = scrollContainerRef.current;
        if (container) pendingPrependAnchorRef.current = container.scrollHeight;
        setRange({ start: nextStart, end: nextEnd });
      } else {
        if (end >= total) return;
        const nextEnd = Math.min(total, end + EXTEND_CHUNK);
        const nextStart = Math.max(start, nextEnd - MAX_WINDOW_SIZE);
        setRange({ start: nextStart, end: nextEnd });
      }
    },
    [scrollContainerRef, total],
  );

  /** Snaps the active verse (the `aria-current` element) to the top of the scroll container. */
  const snapActiveToTop = useCallback(() => {
    const active = scrollContainerRef.current?.querySelector('[aria-current="true"]');
    /* v8 ignore next -- the recentered verse is always mounted, so its element exists */
    active?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [scrollContainerRef]);

  // Reconcile the container scroll position to the freshly-mounted range before the browser paints,
  // so neither a prepend nor a recenter ever shows a jump. A prepend grows the content above the
  // viewport: add the inserted height to scrollTop to hold the visual position. A recenter rebuilds
  // around a new verse: snap that verse (the `aria-current` element) to the top. Both are mutually
  // exclusive — a given range change is at most one of the two — and self-clear so ordinary scroll
  // extends leave the position alone.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const beforeHeight = pendingPrependAnchorRef.current;
    if (beforeHeight !== undefined) {
      pendingPrependAnchorRef.current = undefined;
      /* v8 ignore next -- container is always mounted while the window renders */
      if (!container) return;
      const delta = container.scrollHeight - beforeHeight;
      if (delta !== 0) container.scrollTop += delta;
      return;
    }
    if (pendingRecenterSnapRef.current) {
      pendingRecenterSnapRef.current = false;
      snapActiveToTop();
    }
  }, [range, scrollContainerRef, snapActiveToTop]);

  // Re-snap after the browser has painted the recentered window. The freshly-mounted segments don't
  // reach their final heights synchronously — arc padding is measured and applied on a later frame —
  // so the layout-effect snap above can compute its target against stale heights and leave the verse
  // off screen (above the viewport: you'd have to scroll up to find it). Deferring a second snap past
  // paint re-anchors the verse against the settled layout. Behind the fade, so the correction is
  // never seen. Skips the initial mount (epoch 0); only real recenters re-snap.
  const isInitialEpochRef = useRef(true);
  useEffect(() => {
    if (isInitialEpochRef.current) {
      isInitialEpochRef.current = false;
      return undefined;
    }
    const rafId = requestAnimationFrame(snapActiveToTop);
    return () => cancelAnimationFrame(rafId);
  }, [recenterEpoch, snapActiveToTop]);

  // Recenter on external navigation. An `scrRef` change the parent originated internally (a click in
  // this list, or strip arrow nav echoed back) keys `internalNavRef` to the new verse: consume it
  // and skip the fade, since the target is already shown. Any other anchor change is an external
  // navigation (Paratext selector, scroll group): fade out, rebuild the window centered on the new
  // verse, snap that verse into view behind the fade, then fade back in — on the same clock as the
  // strip so the two views fade as one. The fade fires for every external nav, even one already
  // inside the window, so the two views can never disagree about whether a fade is happening.
  const prevAnchorRef = useRef(anchorIndex);
  useEffect(() => {
    if (anchorIndex === prevAnchorRef.current) return undefined;
    prevAnchorRef.current = anchorIndex;
    const isInternal = internalNavRef.current === verseKey(scrRef);
    internalNavRef.current = undefined;
    if (isInternal) {
      setDisplayScrRef(scrRef);
      return undefined;
    }
    setIsFaded(true);
    const timeout = setTimeout(() => {
      pendingRecenterSnapRef.current = true;
      setRange(buildCenteredRange(anchorIndex, total));
      setRecenterEpoch((n) => n + 1);
      setDisplayScrRef(scrRef);
      setIsFaded(false);
    }, RECENTER_FADE_MS);
    return () => clearTimeout(timeout);
    // scrRef is read to key the internal-nav check; anchorIndex already captures every verse change
    // we recenter on, so adding scrRef as a dep would only re-run this on no-op identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIndex, total, internalNavRef]);

  // The mounted sentinel elements, held in state so the observer effect re-runs once they attach.
  // Ref callbacks only record the node; the actual observe happens in the effect below, which runs
  // after React has attached every ref — including the scroll container (an ancestor). Wiring the
  // observer inside the ref callbacks instead would run before the container's own ref, so its
  // `current` would still be undefined and no sentinel would ever be observed.
  const [topSentinel, setTopSentinel] = useState<HTMLElement | undefined>(undefined);
  const [bottomSentinel, setBottomSentinel] = useState<HTMLElement | undefined>(undefined);

  const topSentinelRef = useCallback(
    (el: HTMLElement | null) => setTopSentinel(el ?? undefined),
    [],
  );
  const bottomSentinelRef = useCallback(
    (el: HTMLElement | null) => setBottomSentinel(el ?? undefined),
    [],
  );

  /** Latest `extend`, mirrored so the observer callback always routes through the current closure. */
  const extendRef = useRef(extend);
  extendRef.current = extend;

  // Create one IntersectionObserver over both sentinels and extend the window when either nears the
  // viewport. Runs as an effect (after all refs, including the scroll-container ancestor, are
  // attached) so the root is available. Re-subscribes whenever the sentinel elements change, and on
  // each recenter (via `recenterEpoch`): a recenter rebuilds the window and re-snaps the scroll
  // position without changing the sentinel nodes, so the existing observer would keep its stale
  // intersection state and never fire for the new geometry. A fresh observer re-delivers the initial
  // intersection state, so a bottom sentinel left sitting in the viewport extends the window
  // immediately instead of staying silent until an up-then-down scroll forces a transition.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || (!topSentinel && !bottomSentinel)) return undefined;
    const edges = new WeakMap<Element, 'top' | 'bottom'>();
    if (topSentinel) edges.set(topSentinel, 'top');
    if (bottomSentinel) edges.set(bottomSentinel, 'bottom');
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
    if (topSentinel) observer.observe(topSentinel);
    if (bottomSentinel) observer.observe(bottomSentinel);
    return () => observer.disconnect();
  }, [scrollContainerRef, topSentinel, bottomSentinel, recenterEpoch]);

  const windowSegments = useMemo(
    () => segments.slice(range.start, range.end),
    [segments, range.start, range.end],
  );

  return { windowSegments, isFaded, displayScrRef, topSentinelRef, bottomSentinelRef };
}
