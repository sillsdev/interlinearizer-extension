import type { Book, Segment } from 'interlinearizer';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RECENTER_FADE_MS } from '../components/recenter-fade';
import useLatestRef from './useLatestRef';
import useRecenterSnap from './useRecenterSnap';

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

/** Arguments for {@link useSegmentWindow}. */
export interface UseSegmentWindowArgs {
  /** The fully tokenized book whose flat `segments` list the window slices. */
  book: Book;
  /** Current scripture reference; the active verse it names is the recenter anchor. */
  scrRef: SerializedVerseRef;
  /**
   * Token ref of the currently focused word token, or `undefined` when nothing is focused. Gated
   * alongside {@link UseSegmentWindowResult.displayScrRef} so the per-token focus highlight and the
   * link-button active state only move behind the recenter fade on external nav — never on the old,
   * still-visible content before the fade-out starts.
   */
  focusedTokenRef: string | undefined;
  /**
   * Current continuous-scroll mode. Gated alongside {@link UseSegmentWindowResult.displayScrRef} so
   * a mode toggle swaps the rendered view (the horizontal strip and the segments' display mode)
   * only at the recenter midpoint — behind the fade — rather than re-laying-out the old,
   * still-visible content the instant the toggle flips.
   */
  continuousScroll: boolean;
  /** Ref to the scrollable list container; used to read/adjust scroll position and host sentinels. */
  scrollContainerRef: RefObject<HTMLElement | undefined>;
  /**
   * Consumes the internal-navigation classification for a reference: returns `true` (and clears the
   * marker) when the most recent navigation to that verse was originated internally — a
   * segment/token click in the list, or arrow nav in the strip. The hook calls it when an anchor
   * change arrives: `true` means the change came from within the views (no fade — the target is
   * already shown), `false` means an external navigation (Paratext selector, scroll group) and
   * triggers the recenter fade. Supplied by {@link InterlinearNavProvider}, which records the origin
   * at the `navigate` call site rather than having the hook reverse-engineer it.
   */
  consumeInternalNav: (ref: SerializedVerseRef) => boolean;
  /**
   * Called — synchronously, inside the recenter midpoint's state batch — with the gated
   * continuous-scroll value the views should now render. The parent owns the horizontal strip,
   * which must mount/unmount in the _same_ React commit as the window rebuild here, so the
   * post-recenter re-snap loop measures the active verse against the final layout (strip included).
   * Routing this through a callback in the timeout (rather than the parent reacting to the returned
   * {@link UseSegmentWindowResult.displayContinuousScroll} via an effect, which would land a commit
   * later) keeps the two in one commit — otherwise the strip mounts after the snap has already
   * settled and the verse lands off screen.
   *
   * @param displayContinuousScroll - The continuous-scroll mode to render from now on.
   */
  onDisplayContinuousScrollChange: (displayContinuousScroll: boolean) => void;
  /**
   * Called after the window has snapped the active verse into place and the layout has settled —
   * both on a fresh mount whose anchor sits mid-book (a cross-book remount) and after each
   * recenter. The cross-book fade clock (in {@link InterlinearNavProvider}) uses it to lift the
   * loader curtain once the freshly-loaded book is laid out. Safe to over-call: the clock ignores
   * it unless a cross-book fade is actually awaiting settle.
   */
  onSettled?: () => void;
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
  /**
   * Token ref the list should highlight as focused. Gated on the same clock as {@link displayScrRef}
   * so the per-token focus and link-button active state move only at the recenter midpoint, behind
   * the fade — never on the old content before the fade-out begins. Tracks `focusedTokenRef`
   * immediately for internal nav and the initial mount.
   */
  displayFocusedTokenRef: string | undefined;
  /**
   * Continuous-scroll mode the views should render. Gated on the same clock as {@link displayScrRef}
   * so a mode toggle swaps the view at the recenter midpoint, behind the fade — never on the old
   * content the instant the toggle flips. Tracks `continuousScroll` immediately on the initial
   * mount.
   */
  displayContinuousScroll: boolean;
  /** Ref callback for the invisible sentinel placed above the first segment. */
  topSentinelRef: (el: HTMLElement | null) => void;
  /** Ref callback for the invisible sentinel placed below the last segment. */
  bottomSentinelRef: (el: HTMLElement | null) => void;
  /**
   * Imperatively recenters the window on the active verse with a fade. Intended for the LocateFixed
   * button and the continuous-scroll mode switch: always fades and rebuilds, so the active verse is
   * brought into view even when it sits outside the render window (where a plain `scrollIntoView`
   * of the `aria-current` element would find nothing and silently no-op). Stable identity.
   */
  recenterOnActive: () => void;
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
 * @param args.consumeInternalNav - Returns whether the navigation to a given verse was internal
 *   (and clears the marker); used to suppress the fade for navigation that came from within the
 *   views.
 * @returns The mounted segment slice, fade state, and the two sentinel ref callbacks.
 */
export default function useSegmentWindow({
  book,
  scrRef,
  focusedTokenRef,
  continuousScroll,
  scrollContainerRef,
  consumeInternalNav,
  onDisplayContinuousScrollChange,
  onSettled,
}: UseSegmentWindowArgs): UseSegmentWindowResult {
  const { segments } = book;
  const total = segments.length;

  const anchorIndex = useMemo(() => findAnchorIndex(segments, scrRef), [segments, scrRef]);

  // #region Window range + display state

  const [range, setRange] = useState<WindowRange>(() => buildCenteredRange(anchorIndex, total));
  const [isFaded, setIsFaded] = useState(false);

  /**
   * `true` on the first commit when the initial window has segments above the anchor — i.e. the
   * anchor sits mid-book, as on a cross-book remount (the loader swaps to `Loading…` then remounts
   * this hook fresh on the new book). Without snapping on mount the active verse would render
   * mid-window, below the fold, at `scrollTop` 0. Seeding {@link pendingRecenterSnapRef} and passing
   * it to {@link useRecenterSnap} (which both normally skip the initial mount) pulls it to the top
   * behind the loader curtain. A normal first mount (anchor at the book start) leaves it `false` so
   * scroll stays at 0.
   */
  const needsInitialSnapRef = useRef(anchorIndex > range.start);

  // Latest callbacks/inputs, mirrored into refs (see useLatestRef) so the recenter effect,
  // `triggerRecenter`, and the snap loop can read the current value while keeping a stable identity.
  // This matters because the PAPI host hands `scrRef` back as a fresh object on many renders: closing
  // over these directly would re-run the recenter effect on renders where nothing recenter-worthy
  // changed, whose cleanup could strand an in-flight fade and park the window on its initial range.
  const onDisplayContinuousScrollChangeRef = useLatestRef(onDisplayContinuousScrollChange);
  const consumeInternalNavRef = useLatestRef(consumeInternalNav);

  /**
   * Scripture reference the active-verse highlight tracks. Held in state (rather than reading
   * `scrRef` directly) so an external nav can defer it to the recenter's midpoint — the highlight
   * then moves with the window swap, behind the fade, instead of jumping the instant `scrRef`
   * changes. Updated immediately for internal nav and the initial value.
   */
  const [displayScrRef, setDisplayScrRef] = useState<SerializedVerseRef>(scrRef);

  /**
   * Focused token ref the per-token highlight and link-button active state track. Gated on the same
   * clock as {@link displayScrRef}: deferred to the recenter midpoint on external nav (so buttons
   * never re-evaluate active/disabled — and dim — on the old, still-visible content before the
   * fade-out), updated immediately for internal nav and the initial value.
   */
  const [displayFocusedTokenRef, setDisplayFocusedTokenRef] = useState<string | undefined>(
    focusedTokenRef,
  );

  /**
   * Continuous-scroll mode the views render. Gated on the same clock as {@link displayScrRef}: a
   * mode toggle defers it to the recenter midpoint so the view swaps behind the fade, never on the
   * old content the instant the toggle flips. Set immediately for the initial value.
   */
  const [displayContinuousScroll, setDisplayContinuousScroll] = useState(continuousScroll);

  // #endregion

  // #region Scroll-position bookkeeping (prepend correction, above-viewport compensation, snap)

  /**
   * Scroll-height correction owed to the next paint. When segments are prepended the content above
   * the viewport grows; recording the pre-mutation `scrollHeight` lets the layout effect restore
   * the visual scroll position so the list doesn't jump under the user.
   */
  const pendingPrependAnchorRef = useRef<number | undefined>(undefined);

  /**
   * Last measured offset of the top sentinel's top edge below the container's top edge, in pixels
   * (negative once scrolled past it). Comparing the current offset against this on each resize
   * tells us how much height was added or removed _above_ the viewport, which is the amount the
   * visible content would otherwise shift by. Reset to `undefined` by the prepend layout effect so
   * the observer re-seeds rather than double-correcting a prepend it already compensated for.
   */
  const lastTopSentinelOffsetRef = useRef<number | undefined>(undefined);

  /**
   * Set when a recenter rebuilds the window, signaling the layout effect to snap the active verse
   * (the element marked `aria-current="true"`) to the top of the list. The snap happens behind the
   * fade so the jump is never seen; clearing the flag after one snap keeps later range changes
   * (scroll extends/culls) from re-snapping. Seeded `true` on a fresh mount whose initial window
   * already has segments above the anchor, so a cross-book remount lands the verse at the top (see
   * {@link needsInitialSnapRef}).
   */
  const pendingRecenterSnapRef = useRef(needsInitialSnapRef.current);

  /** Latest range, mirrored so the observer callbacks read fresh bounds without re-subscribing. */
  const rangeRef = useLatestRef(range);

  // Latest recenter inputs, mirrored into refs (see useLatestRef) so `triggerRecenter` keeps a stable
  // identity rather than churning on every `anchorIndex` / `total` / `scrRef` change.
  const anchorIndexRef = useLatestRef(anchorIndex);
  const totalRef = useLatestRef(total);
  const scrRefRef = useLatestRef(scrRef);
  const focusedTokenRefRef = useLatestRef(focusedTokenRef);
  const continuousScrollRef = useLatestRef(continuousScroll);

  /**
   * Handle of the in-flight recenter fade timeout, or `undefined` when no recenter is mid-flight.
   * Held in a ref (not cleared by effect cleanup) so an incidental re-render can never cancel a
   * running fade — only a superseding recenter or unmount clears it.
   */
  const recenterTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // #endregion

  // #region Infinite-scroll window growth, snap-to-top, and the post-recenter settle

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
    [scrollContainerRef, total, rangeRef],
  );

  /**
   * Snaps the recenter target to the top of the scroll container. Normally that is the active verse
   * (the `aria-current` element). When the reference names verse 0 of a chapter — the chapter
   * heading rather than any verse — the target is instead that chapter's inline heading (the
   * `[data-chapter-start]` element), so the heading sits at the top while the active-verse
   * highlight stays on verse 1 below it. Falls back to the active verse when no heading is mounted
   * (e.g. the `chapterLabelInVerse` setting suppresses headings).
   *
   * When the content below the target is too short for `scrollIntoView` to reach the top (common in
   * baseline-text mode where segments are compact, and especially after the continuous-scroll strip
   * mounts above the list and shrinks the container), the function grows a spacer element
   * (`[data-snap-spacer]`) at the bottom of the scroll content to provide enough scroll range, then
   * retries. The spacer resets to zero on each call so it never outlives the shortfall that created
   * it.
   */
  const snapActiveToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const { verseNum, chapterNum } = scrRefRef.current;
    const target =
      verseNum === 0
        ? (container?.querySelector(`[data-chapter-start="${chapterNum}"]`) ??
          container?.querySelector('[aria-current="true"]'))
        : container?.querySelector('[aria-current="true"]');
    /* v8 ignore next -- the recentered target is always mounted, so its element exists */
    if (!target || !container) return;
    const spacer = container.querySelector<HTMLElement>('[data-snap-spacer]');
    if (spacer) spacer.style.height = '0px';
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
    const remainingOffset =
      target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    if (remainingOffset > 1 && spacer) {
      spacer.style.height = `${Math.ceil(remainingOffset)}px`;
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [scrollContainerRef, scrRefRef]);

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
      lastTopSentinelOffsetRef.current = undefined;
      return;
    }
    if (pendingRecenterSnapRef.current) {
      pendingRecenterSnapRef.current = false;
      snapActiveToTop();
    }
  }, [range, scrollContainerRef, snapActiveToTop]);

  // The post-recenter re-snap + settle lifecycle. After each recenter (and a mid-book initial mount)
  // this re-snaps the verse against every late settling wave behind the fade, then reports settled
  // once the layout goes quiet. `recenterInFlightRef` gates the compensation observer below (relay
  // vs. compensate), `recenterEpoch` re-subscribes the observers against the new geometry, and the
  // start/begin handlers are driven by `triggerRecenter`.
  const {
    recenterEpoch,
    recenterInFlightRef,
    markRecenterStarted,
    beginRecenterSettle,
    relayResize,
  } = useRecenterSnap({
    snapActiveToTop,
    needsInitialSnap: needsInitialSnapRef.current,
    onSettled,
  });

  // #endregion

  // #region Recenter trigger + navigation reaction

  /**
   * Rebuilds the window centered on the active verse and fades it into view. Used by the
   * external-navigation effect and returned directly as the imperative `recenterOnActive`.
   *
   * Reads `anchorIndex` / `total` / `scrRef` from refs so its identity is stable across renders,
   * and owns its timer through `recenterTimeoutRef`: a fresh call supersedes any in-flight fade
   * (clearing the prior timer) rather than letting incidental effect cleanups cancel it. This keeps
   * a running fade from being stranded by an unrelated re-render — the failure that left the list
   * parked on its initial range and the strip on the book's first phrase.
   */
  const triggerRecenter = useCallback(() => {
    if (recenterTimeoutRef.current !== undefined) clearTimeout(recenterTimeoutRef.current);
    markRecenterStarted();
    setIsFaded(true);
    recenterTimeoutRef.current = setTimeout(() => {
      recenterTimeoutRef.current = undefined;
      pendingRecenterSnapRef.current = true;
      setRange(buildCenteredRange(anchorIndexRef.current, totalRef.current));
      beginRecenterSettle();
      setDisplayScrRef(scrRefRef.current);
      setDisplayFocusedTokenRef(focusedTokenRefRef.current);
      setDisplayContinuousScroll(continuousScrollRef.current);
      // Flip the parent's strip visibility in this same state batch so the strip mounts/unmounts in
      // the same commit as the window rebuild above — the re-snap loop then measures the active verse
      // against the final, strip-included layout instead of snapping before the strip exists.
      onDisplayContinuousScrollChangeRef.current(continuousScrollRef.current);
      setIsFaded(false);
    }, RECENTER_FADE_MS);
  }, [
    markRecenterStarted,
    beginRecenterSettle,
    anchorIndexRef,
    totalRef,
    scrRefRef,
    focusedTokenRefRef,
    continuousScrollRef,
    onDisplayContinuousScrollChangeRef,
  ]);

  // Recenter on external navigation. An `scrRef` change the parent originated internally (a click in
  // this list, or strip arrow nav echoed back) was recorded as internal at the `navigate` call site;
  // `consumeInternalNav` returns true, so skip the fade — the target is already shown. Any other
  // anchor change is an external
  // navigation (Paratext selector, scroll group): fade out, rebuild the window centered on the new
  // verse, snap that verse into view behind the fade, then fade back in — on the same clock as the
  // strip so the two views fade as one. The fade fires for every external nav, even one already
  // inside the window, so the two views can never disagree about whether a fade is happening.
  //
  // `prevAnchorRef` tracks both the anchor index AND the segments identity so that a book change
  // (which can produce the same anchor index as the previous book) still triggers a recenter.
  const prevAnchorRef = useRef<{ index: number; segments: readonly Segment[] }>({
    index: anchorIndex,
    segments,
  });
  useEffect(() => {
    const sameAnchor =
      anchorIndex === prevAnchorRef.current.index && segments === prevAnchorRef.current.segments;
    if (sameAnchor) return;
    prevAnchorRef.current = { index: anchorIndex, segments };
    const currentScrRef = scrRefRef.current;
    if (consumeInternalNavRef.current(currentScrRef)) {
      setDisplayScrRef(currentScrRef);
      setDisplayFocusedTokenRef(focusedTokenRefRef.current);
      return;
    }
    triggerRecenter();
    // scrRef is read (via ref) only to key the internal-nav check; anchorIndex and segments already
    // capture every verse/book change we recenter on, and triggerRecenter has a stable identity. The
    // timeout is owned by triggerRecenter (recenterTimeoutRef), not torn down here, so an incidental
    // re-render that re-runs this effect can never cancel an in-flight fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIndex, segments, triggerRecenter]);

  // Track within-verse focus moves (arrow/click that stays in the active verse) immediately. These
  // change `focusedTokenRef` without changing `anchorIndex`, so the recenter effect above never
  // fires for them; sync the display ref here so the focus highlight follows. Skip while a recenter
  // fade is in flight — that swap owns the display ref and lands the new focus at the midpoint, so
  // updating here too would move the highlight (and re-dim buttons) on the old content before the
  // fade-out completes. `recenterTimeoutRef` is set synchronously by `triggerRecenter`, so it reads
  // true even in the same commit the external nav starts the fade — when `isFaded` state is still
  // stale.
  useEffect(() => {
    if (recenterTimeoutRef.current !== undefined) return;
    setDisplayFocusedTokenRef(focusedTokenRef);
  }, [focusedTokenRef]);

  // #endregion

  // #region Sentinel intersection (window growth) + above-viewport scroll compensation

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
  const extendRef = useLatestRef(extend);

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
  }, [scrollContainerRef, topSentinel, bottomSentinel, recenterEpoch, extendRef]);

  /**
   * Last observed `clientHeight` of the scroll container. The compensation below only corrects for
   * content growth _above_ the viewport while the container's own size is fixed; when the container
   * itself resizes (the continuous-scroll strip mounting/unmounting above it, or a window resize)
   * the sentinel offset shifts for a reason that is _not_ above-viewport growth — and the browser
   * may also clamp `scrollTop` to the shorter scroll range — so a naive delta would mis-correct.
   * Tracking the container height lets us detect those fires and re-seed the baseline instead of
   * compensating.
   */
  const lastContainerHeightRef = useRef<number | undefined>(undefined);

  // Keep the active verse anchored against above-viewport height changes so already-mounted segments
  // above the anchor can't shove the visible content as their arc padding settles asynchronously (a
  // ResizeObserver → rAF → setState chain in `useArcPaths` that finishes across several later
  // frames). This single observer plays two roles depending on whether a recenter is in flight:
  //
  // - **While a recenter is in flight** it relays each resize to the re-snap handler
  //   (`onResnapResizeRef`, installed by the re-snap effect), which re-snaps the verse to the top
  //   against the now-settled geometry and restarts the settle's quiet timer. The recenter owns the
  //   scroll position here, so this is how the verse stays pinned through every settling wave —
  //   replacing the old per-frame re-snap loop with one re-snap per actual layout change.
  //
  // - **Otherwise** it compensates: this generalizes the prepend correction
  //   (`pendingPrependAnchorRef`) from "prepend events" to "any above-viewport growth" — anchor on
  //   the top sentinel's offset below the container top, and when it changes, add the delta to
  //   scrollTop to hold the visible content fixed. Stands down when the list is at the very top
  //   (`scrollTop === 0`), matching the prepend correction's assumption that growth at the book top
  //   is fine, and when the container's own height changed since the last fire — the strip
  //   mounting/unmounting on a mode toggle (or a window resize), not above-viewport segment growth;
  //   the sentinel offset moved for an unrelated reason (and scrollTop may have been clamped to the
  //   new scroll range), so re-seed the baseline rather than "correcting" a phantom shift.
  //
  // Re-subscribes on each recenter so the baseline offset is re-seeded for the new geometry rather
  // than carried over from the pre-recenter layout.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !topSentinel) return undefined;
    lastTopSentinelOffsetRef.current = undefined;
    lastContainerHeightRef.current = undefined;
    /** Reads the top sentinel's current top edge relative to the container's top edge. */
    const measureOffset = () =>
      topSentinel.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const observer = new ResizeObserver(() => {
      // While the recenter owns the scroll, relay the resize to the re-snap handler instead of
      // compensating — it pins the verse to the top and keeps the settle's quiet window open.
      if (recenterInFlightRef.current) {
        relayResize();
        return;
      }
      const offset = measureOffset();
      const last = lastTopSentinelOffsetRef.current;
      lastTopSentinelOffsetRef.current = offset;
      const containerHeight = root.clientHeight;
      const lastContainerHeight = lastContainerHeightRef.current;
      lastContainerHeightRef.current = containerHeight;
      if (last === undefined || root.scrollTop === 0 || containerHeight !== lastContainerHeight) {
        return;
      }
      // When content above the viewport grows, the sentinel's offset below the container top moves
      // _more negative_; subtracting that (negative) delta from scrollTop scrolls down by the same
      // amount, holding the visible content fixed. Symmetric for shrink.
      const delta = offset - last;
      if (delta !== 0) root.scrollTop -= delta;
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [scrollContainerRef, topSentinel, recenterEpoch, recenterInFlightRef, relayResize]);

  // #endregion

  const windowSegments = useMemo(
    () => segments.slice(range.start, range.end),
    [segments, range.start, range.end],
  );

  // Clear any in-flight recenter fade on unmount so the deferred range/snap/state updates don't run
  // against a torn-down tree.
  useEffect(
    () => () => {
      if (recenterTimeoutRef.current !== undefined) clearTimeout(recenterTimeoutRef.current);
    },
    [],
  );

  return {
    windowSegments,
    isFaded,
    displayScrRef,
    displayFocusedTokenRef,
    displayContinuousScroll,
    topSentinelRef,
    bottomSentinelRef,
    recenterOnActive: triggerRecenter,
  };
}
