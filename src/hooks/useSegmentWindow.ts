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

/**
 * How long the post-recenter re-snap loop keeps re-snapping the active verse, in milliseconds.
 * After a recenter the freshly-mounted layout does not reach its final geometry in a single frame —
 * and on a continuous-scroll toggle it settles in _waves_: the segments switch display mode, the
 * horizontal strip mounts, and `useArcPaths` measures/clears arc padding, each across its own
 * ResizeObserver → rAF → setState chain that lands on different frames. A loop that stops at the
 * first frame whose `scrollTop` matches the previous one can exit during a transient plateau
 * _between_ those waves and leave the verse anchored to a layout that then shifts under it (the
 * reported "first visible segment isn't the active verse after toggling continuous scroll on").
 *
 * So the loop re-snaps every frame for this whole window — which spans the recenter fade — so the
 * _final_ snap is guaranteed to run against the fully-settled layout, behind the curtain, costing
 * nothing visually. (Reporting "settled" to the cross-book fade clock is decoupled and happens as
 * soon as the layout holds still; see {@link RESNAP_SETTLE_STABLE_FRAMES}.)
 */
const RECENTER_RESNAP_MS = RECENTER_FADE_MS;

/**
 * Number of consecutive frames the snapped `scrollTop` must hold steady before the loop reports
 * "settled" to the cross-book fade clock (which lifts the loader curtain). Decoupled from how long
 * the loop keeps re-snapping ({@link RECENTER_RESNAP_MS}): the curtain should lift as soon as the
 * layout is visibly stable so a book change doesn't sit under the curtain for the whole fade, while
 * the snap itself keeps correcting (harmlessly, behind the fade) until the window ends. Requiring a
 * few stable frames — rather than the single match the old early-exit used — keeps a one-frame
 * plateau between layout waves from reporting settled prematurely.
 */
const RESNAP_SETTLE_STABLE_FRAMES = 3;

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

  const [range, setRange] = useState<WindowRange>(() => buildCenteredRange(anchorIndex, total));
  const [isFaded, setIsFaded] = useState(false);

  /**
   * `true` on the first commit when the initial window has segments above the anchor — i.e. the
   * anchor sits mid-book, as on a cross-book remount (the loader swaps to `Loading…` then remounts
   * this hook fresh on the new book). Without snapping on mount the active verse would render
   * mid-window, below the fold, at `scrollTop` 0. Seeding {@link pendingRecenterSnapRef} and the
   * re-snap loop (which both normally skip the initial mount) pulls it to the top behind the loader
   * curtain. A normal first mount (anchor at the book start) leaves it `false` so scroll stays at
   * 0.
   */
  const needsInitialSnapRef = useRef(anchorIndex > range.start);

  /** Latest `onSettled`, mirrored so the snap loop fires the current callback with a stable dep. */
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  /**
   * Latest `onDisplayContinuousScrollChange`, mirrored so `triggerRecenter` can call the current
   * callback from inside its timeout while keeping a stable identity.
   */
  const onDisplayContinuousScrollChangeRef = useRef(onDisplayContinuousScrollChange);
  onDisplayContinuousScrollChangeRef.current = onDisplayContinuousScrollChange;

  /**
   * Latest `consumeInternalNav`, mirrored so the recenter effect reads it without listing it as a
   * dep — the same identity-churn decoupling as `scrRefRef` (see the recenter effect's note).
   */
  const consumeInternalNavRef = useRef(consumeInternalNav);
  consumeInternalNavRef.current = consumeInternalNav;

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
   * (scroll extends/culls) from re-snapping. Seeded `true` on a fresh mount whose initial window
   * already has segments above the anchor, so a cross-book remount lands the verse at the top (see
   * {@link needsInitialSnapRef}).
   */
  const pendingRecenterSnapRef = useRef(needsInitialSnapRef.current);

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

  // Latest recenter inputs, mirrored into refs so `triggerRecenter` can keep a stable identity. If
  // these were closed over directly, `triggerRecenter` would get a new identity on every `anchorIndex`
  // / `total` / `scrRef` change — and because the PAPI host hands `scrRef` back as a fresh object on
  // many renders, that identity churn would re-run the recenter effect on renders where nothing
  // recenter-worthy actually changed, whose cleanup would clear an in-flight fade timeout (and not
  // reschedule it when `sameAnchor` holds), stranding the fade and leaving the window parked on its
  // initial range. Reading through refs decouples the timer from that churn.
  const anchorIndexRef = useRef(anchorIndex);
  anchorIndexRef.current = anchorIndex;
  const totalRef = useRef(total);
  totalRef.current = total;
  const scrRefRef = useRef(scrRef);
  scrRefRef.current = scrRef;
  const focusedTokenRefRef = useRef(focusedTokenRef);
  focusedTokenRefRef.current = focusedTokenRef;
  const continuousScrollRef = useRef(continuousScroll);
  continuousScrollRef.current = continuousScroll;

  /**
   * Handle of the in-flight recenter fade timeout, or `undefined` when no recenter is mid-flight.
   * Held in a ref (not cleared by effect cleanup) so an incidental re-render can never cancel a
   * running fade — only a superseding recenter or unmount clears it.
   */
  const recenterTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * `true` from the moment a recenter starts (or the initial mount, until its first settle) through
   * the post-paint re-snap loop, cleared when the loop reports settled. While set, the re-snap loop
   * owns the scroll position, so the above-viewport scroll-compensation observer stands down rather
   * than fighting the loop's snaps. Seeded `true` so the very first settle clears it.
   */
  const recenterInFlightRef = useRef(true);

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

  // Re-snap after the browser has painted the recentered window, repeatedly, until the layout
  // settles. The freshly-mounted segments don't reach their final heights synchronously — arc
  // padding is measured and applied by `useArcPaths` across *several* later frames (a ResizeObserver
  // → rAF → setState chain, not a single frame) — so a one-shot re-snap can still compute its target
  // against stale heights and leave the verse off screen, with the scroll position pinned to an edge
  // so the user can't scroll back toward it (the reported "verse lands at the bottom / above the
  // viewport, and scrolling one way does nothing" bugs). Snapping each frame until the resulting
  // `scrollTop` stops changing re-anchors the verse against whatever the *final* settled heights turn
  // out to be, however many frames that takes. The whole loop runs behind the fade, so none of the
  // intermediate corrections are seen; a frame cap backstops a layout that never fully settles.
  // Skips the initial mount (epoch 0); only real recenters re-snap.
  const isInitialEpochRef = useRef(true);
  useEffect(() => {
    // Marks the recenter complete: the loop no longer owns the scroll, so the scroll-compensation
    // observer may resume, and the cross-book fade clock lifts the curtain off the settle signal.
    const reportSettled = () => {
      recenterInFlightRef.current = false;
      onSettledRef.current?.();
    };
    if (isInitialEpochRef.current) {
      isInitialEpochRef.current = false;
      // On the initial mount only re-snap when this is a cross-book remount that needs the verse
      // pulled to the top; a normal first mount (anchor at the book start) leaves scroll at 0. Either
      // way the layout has settled once the next frame paints, so report settled then — the
      // cross-book fade clock lifts the curtain off this signal (and ignores it otherwise).
      const needsSnap = needsInitialSnapRef.current;
      needsInitialSnapRef.current = false;
      if (!needsSnap) {
        const settleRaf = requestAnimationFrame(reportSettled);
        return () => cancelAnimationFrame(settleRaf);
      }
    }
    let rafId = 0;
    const deadline = Date.now() + RECENTER_RESNAP_MS;
    let lastScrollTop = Number.NaN;
    let stableFrames = 0;
    let didReportSettled = false;
    const step = () => {
      snapActiveToTop();
      const scrollTop =
        /* v8 ignore next -- container is always mounted while the recentered window renders */
        scrollContainerRef.current?.scrollTop ?? lastScrollTop;
      // Report settled once the snapped position has held steady for a few frames, so the cross-book
      // curtain lifts as soon as the layout looks stable rather than waiting out the whole window.
      // Fire it at most once; the loop keeps re-snapping afterward to absorb any later layout wave.
      if (scrollTop === lastScrollTop) {
        stableFrames += 1;
        if (stableFrames >= RESNAP_SETTLE_STABLE_FRAMES && !didReportSettled) {
          didReportSettled = true;
          reportSettled();
        }
      } else {
        stableFrames = 0;
      }
      lastScrollTop = scrollTop;
      // Keep re-snapping every frame until the window elapses — spanning the recenter fade — so the
      // final snap runs against the fully-settled layout (mode swap, strip mount, and arc-padding
      // waves all landed). A plateau between waves can't end the loop early; only the deadline does.
      if (Date.now() >= deadline) {
        // The layout never held steady long enough to report settled (it shifted every frame through
        // the whole window); report now so the loader curtain is never stranded.
        if (!didReportSettled) reportSettled();
        return;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [recenterEpoch, snapActiveToTop, scrollContainerRef]);

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
    recenterInFlightRef.current = true;
    setIsFaded(true);
    recenterTimeoutRef.current = setTimeout(() => {
      recenterTimeoutRef.current = undefined;
      pendingRecenterSnapRef.current = true;
      setRange(buildCenteredRange(anchorIndexRef.current, totalRef.current));
      setRecenterEpoch((n) => n + 1);
      setDisplayScrRef(scrRefRef.current);
      setDisplayFocusedTokenRef(focusedTokenRefRef.current);
      setDisplayContinuousScroll(continuousScrollRef.current);
      // Flip the parent's strip visibility in this same state batch so the strip mounts/unmounts in
      // the same commit as the window rebuild above — the re-snap loop then measures the active verse
      // against the final, strip-included layout instead of snapping before the strip exists.
      onDisplayContinuousScrollChangeRef.current(continuousScrollRef.current);
      setIsFaded(false);
    }, RECENTER_FADE_MS);
  }, []);

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

  /**
   * Last measured offset of the top sentinel's top edge below the container's top edge, in pixels
   * (negative once scrolled past it). Comparing the current offset against this on each resize
   * tells us how much height was added or removed _above_ the viewport, which is the amount the
   * visible content would otherwise shift by.
   */
  const lastTopSentinelOffsetRef = useRef<number | undefined>(undefined);

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

  // Compensate scrollTop for above-viewport height changes so already-mounted segments above the
  // anchor can't shove the visible content as their arc padding settles asynchronously (a
  // ResizeObserver → rAF → setState chain in `useArcPaths` that finishes *after* the post-recenter
  // re-snap loop has already exited). The re-snap loop only pins the anchor while it runs; once it
  // stops, growth above the fold has no correction, so scrolling up jumps the anchor past the
  // viewport. This generalizes the prepend correction (`pendingPrependAnchorRef`) from "prepend
  // events" to "any above-viewport growth": anchor on the top sentinel's offset below the container
  // top, and when it changes, add the delta to scrollTop to hold the visible content fixed.
  //
  // Stands down while a recenter is in flight (the loop owns the scroll then) and when the list is at
  // the very top (`scrollTop === 0`), matching the prepend correction's assumption that growth at the
  // book top is fine. Also stands down when the container's own height changed since the last fire —
  // that is the strip mounting/unmounting on a mode toggle (or a window resize), not above-viewport
  // segment growth; the sentinel offset moved for an unrelated reason (and scrollTop may have been
  // clamped to the new scroll range), so re-seed the baseline rather than "correcting" a phantom
  // shift, which was the toggle-on wrong-snap. Re-subscribes on each recenter so the baseline offset
  // is re-seeded for the new geometry rather than carried over from the pre-recenter layout.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !topSentinel) return undefined;
    lastTopSentinelOffsetRef.current = undefined;
    lastContainerHeightRef.current = undefined;
    /** Reads the top sentinel's current top edge relative to the container's top edge. */
    const measureOffset = () =>
      topSentinel.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const observer = new ResizeObserver(() => {
      const offset = measureOffset();
      const last = lastTopSentinelOffsetRef.current;
      lastTopSentinelOffsetRef.current = offset;
      const containerHeight = root.clientHeight;
      const lastContainerHeight = lastContainerHeightRef.current;
      lastContainerHeightRef.current = containerHeight;
      if (
        last === undefined ||
        recenterInFlightRef.current ||
        root.scrollTop === 0 ||
        containerHeight !== lastContainerHeight
      ) {
        return;
      }
      // When content above the viewport grows, the sentinel's offset below the container top moves
      // *more negative*; subtracting that (negative) delta from scrollTop scrolls down by the same
      // amount, holding the visible content fixed. Symmetric for shrink.
      const delta = offset - last;
      if (delta !== 0) root.scrollTop -= delta;
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [scrollContainerRef, topSentinel, recenterEpoch]);

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
