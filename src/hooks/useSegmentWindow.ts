import type { Book, Segment } from 'interlinearizer';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RECENTER_FADE_MS } from '../components/recenter-fade';
import type { HeightTable } from '../utils/segment-heights';
import { offsetOfSegment, segmentIndexAtOffset } from '../utils/segment-heights';
import { segmentContainsVerse } from '../utils/verse-ref';
import useLatestRef from './useLatestRef';
import useRecenterSnap from './useRecenterSnap';

/**
 * Number of segments rendered on each side of the anchor when the window is first built or
 * recentered on the active verse. Hard-coded (never user-configurable), and big enough to put both
 * sentinels outside {@link SENTINEL_ROOT_MARGIN_PX}: a smaller window lands inside the arming margin
 * and extends repeatedly before the reader has scrolled at all.
 */
export const INITIAL_WINDOW_HALF = 12;

/**
 * Number of segments appended (or prepended) each time a scroll sentinel enters the viewport.
 * Bounded from both sides: worth more than {@link SENTINEL_ROOT_MARGIN_PX} of token-chip rows, so a
 * sustained scroll is answered by one extend rather than a rapid series of them, and no more than
 * that, because a chunk mounts in one commit and that commit is the longest pause a scroll sees.
 */
export const EXTEND_CHUNK = 8;

/**
 * Hard upper bound on how many segments may be mounted at once. Culling is normally driven by
 * geometry (see {@link CULL_RETENTION_PX}), which sizes the window to the viewport plus retention
 * margins regardless of segment height, so this cap exists only as a runaway guard for degenerate
 * layouts (e.g. a container that reports no height). An extend that cannot fit under the cap even
 * after culling is skipped.
 *
 * Must stay clear of the largest window the geometry legitimately produces, or the cap rather than
 * the geometry would bound it and extends would stall short of the reader.
 */
export const HARD_WINDOW_CAP = 400;

/**
 * Root margin (in pixels) around the scroll container used to arm the sentinels before they are
 * actually visible. Pre-loading just off-screen keeps the list filled ahead of the scroll so the
 * user never reaches an empty edge.
 *
 * Sized in time rather than in segments: a freshly mounted segment reaches its final height only
 * once the arc-measurement pass has settled, several frames later. At a brisk wheel fling this
 * margin is the reader's whole warning, so it has to outlast that settle — a margin worth a segment
 * or two would arm, extend, and still paint blank because the content had not finished laying out
 * by the time the reader arrived.
 */
const SENTINEL_ROOT_MARGIN_PX = 800;

/**
 * Quiet time (in milliseconds) after the last scroll event before a skim ends and the window
 * renders its segments in full again. It ends a scroll with no release to wait for — a wheel, a
 * touchpad fling — so it need only outlast the gaps between one gesture's scroll events; a drag
 * ends its skim on the pointer release.
 */
export const SKIM_SETTLE_MS = 200;

/**
 * Distance a skimming window covers ahead of the scroll position, in pixels, in the direction of
 * travel. Covers the ground a drag crosses between re-seats, whatever height its segments render
 * at.
 */
export const SKIM_AHEAD_PX = 12_000;

/**
 * Distance a skimming window covers behind the scroll position, in pixels, for the ground a drag
 * that reverses lands on before {@link SKIM_REVERSE_PX} turns the window around.
 */
export const SKIM_BEHIND_PX = 3_000;

/**
 * How close (in pixels) the leading edge of a skimming window may come to the viewport before the
 * window is re-seated further ahead. Re-seating this far out is what keeps a drag from ever
 * reaching past the mounted run.
 */
export const SKIM_LEAD_PX = 1500;

/**
 * Distance a skimming window slides at its leading edge each time the drag approaches that edge, in
 * pixels. Sliding rather than rebuilding around the new position keeps the segments between the two
 * mounted, so only the edges change.
 */
export const SKIM_SLIDE_PX = 4_000;

/**
 * How far (in pixels) the scroll must reverse before a skim treats the drag as having changed
 * direction. A drag jitters by a pixel or two between frames, and reversing the window on that
 * would rebuild it reaching backward from a position the drag is still moving away from — mounting
 * a run the reader has already left behind.
 */
export const SKIM_REVERSE_PX = 400;

/**
 * Distance (in pixels) beyond the viewport a mounted segment must lie before an extend may cull it
 * from the opposite end of the window. Strictly greater than {@link SENTINEL_ROOT_MARGIN_PX} so a
 * cull can never pull content back inside a sentinel's arming margin — which would re-fire that
 * sentinel and oscillate the window between its two edges.
 */
export const CULL_RETENTION_PX = SENTINEL_ROOT_MARGIN_PX * 2;

/** A half-open `[start, end)` range of indices into the book's flat segment list. */
type WindowRange = Readonly<{ start: number; end: number }>;

/** Arguments for {@link useSegmentWindow}. */
export interface UseSegmentWindowArgs {
  /** The fully tokenized book whose flat `segments` list the window slices. */
  book: Book;
  /** Current scripture reference; the active verse it names is the recenter anchor. */
  scrRef: SerializedVerseRef;
  /**
   * Monotonic counter the loader bumps on every boundary edit (merge/split/move). Classifies a
   * segments-identity change: a change carrying a version bump is a boundary edit (the window
   * redraws in place with no fade), while a change without one is a re-tokenization of the loaded
   * book (or a book swap) and recenters with the fade. An explicit signal is needed because anchor
   * coordinates misclassify in both directions — a merge absorbing the active verse's segment start
   * changes the anchor verse, and a re-tokenization can keep it.
   */
  segmentationVersion: number;
  /**
   * Token ref of the currently focused word token, or `undefined` when nothing is focused. Gated
   * alongside {@link UseSegmentWindowResult.displayScrRef} so the per-token focus highlight and the
   * link-button active state only move behind the recenter fade on external nav — never on the old,
   * still-visible content before the fade-out starts.
   */
  focusedTokenRef: string | undefined;
  /**
   * Current continuous-scroll mode. Reported back through
   * {@link UseSegmentWindowArgs.onDisplayContinuousScrollChange} at the recenter midpoint so a mode
   * toggle swaps the rendered view (the horizontal strip and the segments' display mode) only
   * behind the fade — never re-laying-out the old, still-visible content the instant the toggle
   * flips.
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
   * at the `navigate` call site.
   */
  consumeInternalNav: (ref: SerializedVerseRef) => boolean;
  /**
   * Called — synchronously, inside the recenter midpoint's state batch — with the gated
   * continuous-scroll value the views should now render. The parent owns the horizontal strip,
   * which must mount/unmount in the _same_ React commit as the window rebuild here, so the
   * post-recenter re-snap loop measures the active verse against the final layout (strip included).
   * Routing this through a callback in the timeout — rather than the parent reacting to a
   * hook-returned value via an effect, which would land a commit later — keeps the two in one
   * commit, so the strip is present when the snap settles.
   */
  onDisplayContinuousScrollChange: (displayContinuousScroll: boolean) => void;
  /**
   * Offsets the list lays the book out at, mounted segments and unmounted alike, so a scroll
   * position that leaves the mounted segments still names the segment it landed on.
   */
  heightTable: HeightTable;
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
  /** Half-open index range into the book's segments that {@link windowSegments} covers. */
  range: WindowRange;
  /** `true` while the window is faded out mid-recenter; drives the list's opacity transition. */
  isFaded: boolean;
  /**
   * Whether the window is mid-skim: the scroll has left the mounted run — as a thumb drag does —
   * and has not settled since. A ref rather than state because a skim changes no rendered output;
   * it slides the window ahead of the drag and suspends the sentinel extends while it runs.
   */
  isSkimmingRef: RefObject<boolean>;
  /**
   * Scripture reference the list should highlight as active. Lags the live `scrRef` through a
   * recenter fade so the active-verse highlight only moves once the window swaps behind the fade —
   * never before it starts. For internal nav and the initial mount it tracks `scrRef` immediately.
   */
  displayScrRef: SerializedVerseRef;
  /**
   * Token ref the list should highlight as focused. Gated on the same clock as {@link displayScrRef}
   * so the per-token focus and link-button active state move only at the recenter midpoint, behind
   * the fade — never on the old content before the fade-out begins. Tracks `focusedTokenRef`
   * immediately for internal nav and the initial mount.
   */
  displayFocusedTokenRef: string | undefined;
  /** Ref callback for the invisible sentinel placed above the first segment. */
  topSentinelRef: (el: HTMLElement | null) => void;
  /** Ref callback for the invisible sentinel placed below the last segment. */
  bottomSentinelRef: (el: HTMLElement | null) => void;
  /**
   * Ref callback for the element wrapping the mounted segments (the fade wrapper). The hook's
   * resize observer watches this element — not just the scroll container, whose own box is fixed by
   * the panel layout — so late segment-height settling (arc padding) is actually reported and the
   * above-viewport compensation and recenter re-snap can react to it.
   */
  contentRef: (el: HTMLElement | null) => void;
  /**
   * Imperatively recenters the window on the active verse with a fade. Intended for the LocateFixed
   * button and the continuous-scroll mode switch: always fades and rebuilds, so the active verse is
   * brought into view even when it sits outside the render window (where a plain `scrollIntoView`
   * of the `aria-current` element would find nothing and silently no-op). Stable identity.
   */
  recenterOnActive: () => void;
}

/**
 * Finds the index in `segments` of the segment that owns the verse named by `scrRef`. Matches by
 * verse-range containment (first segment in document order whose range includes the verse), so a
 * verse absorbed into a multi-verse segment — or the later portions of a split verse — resolves to
 * the segment that actually contains it rather than only to exact segment starts. Falls back to the
 * first segment of the same book+chapter, then to `0`, so there is always a valid anchor.
 */
function findAnchorIndex(segments: readonly Segment[], scrRef: SerializedVerseRef): number {
  const containing = segments.findIndex((seg) => segmentContainsVerse(seg, scrRef));
  if (containing !== -1) return containing;
  const chapter = segments.findIndex(
    (seg) => seg.startRef.book === scrRef.book && seg.startRef.chapter === scrRef.chapterNum,
  );
  return chapter === -1 ? 0 : chapter;
}

/**
 * Builds the half-open range a skimming window mounts around a scroll offset, reaching
 * {@link SKIM_AHEAD_PX} in the direction of travel and {@link SKIM_BEHIND_PX} the other way, clamped
 * to the book.
 */
function buildSkimRange(offset: number, direction: 1 | -1, table: HeightTable): WindowRange {
  const behind = direction > 0 ? SKIM_BEHIND_PX : SKIM_AHEAD_PX;
  const ahead = direction > 0 ? SKIM_AHEAD_PX : SKIM_BEHIND_PX;
  return {
    start: segmentIndexAtOffset(table, offset - behind),
    end: Math.min(table.heights.length, segmentIndexAtOffset(table, offset + ahead) + 1),
  };
}

/**
 * Slides a skimming window {@link SKIM_SLIDE_PX} in the direction of travel, keeping every segment
 * the two ranges share, clamped to the book.
 */
function slideSkimRange(range: WindowRange, direction: 1 | -1, table: HeightTable): WindowRange {
  const shift = direction * SKIM_SLIDE_PX;
  const total = table.heights.length;
  const end = Math.min(
    total,
    segmentIndexAtOffset(table, offsetOfSegment(table, range.end - 1) + shift) + 1,
  );
  const start = segmentIndexAtOffset(table, offsetOfSegment(table, range.start) + shift);
  // Hold the window's span when an edge clamps at the book, rather than letting the clamped edge
  // pull the other in behind it and shrink the window toward nothing as a drag rides the end.
  const span = range.end - range.start;
  const held = Math.max(0, Math.min(start, total - span));
  return { start: held, end: Math.max(Math.min(end, total), Math.min(held + span, total)) };
}

/** Builds the half-open window range centered on an anchor segment, clamped to the book. */
function buildCenteredRange(anchorIndex: number, total: number): WindowRange {
  const start = Math.max(0, anchorIndex - INITIAL_WINDOW_HALF);
  const end = Math.min(total, anchorIndex + INITIAL_WINDOW_HALF + 1);
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
 * fades back in — on the shared {@link RECENTER_FADE_MS} clock and easing. This happens for _every_
 * external navigation, even when the new verse already sits inside the mounted window, so every
 * recenter fade in the panel stays in step. Internal navigation (a segment/token click here, or
 * strip arrow nav echoed back) skips the fade entirely: the target is already on screen.
 */
export default function useSegmentWindow({
  book,
  scrRef,
  segmentationVersion,
  focusedTokenRef,
  continuousScroll,
  scrollContainerRef,
  consumeInternalNav,
  onDisplayContinuousScrollChange,
  heightTable,
  onSettled,
}: UseSegmentWindowArgs): UseSegmentWindowResult {
  const { segments } = book;
  const total = segments.length;

  const anchorIndex = useMemo(() => findAnchorIndex(segments, scrRef), [segments, scrRef]);

  // #region Window range + display state

  const [range, setRange] = useState<WindowRange>(() => buildCenteredRange(anchorIndex, total));
  const [isFaded, setIsFaded] = useState(false);
  /**
   * Whether a skim is in progress: the scroll left the mounted run (as a thumb drag does) and has
   * not settled. Held in a ref rather than state because nothing renders from it — it only suspends
   * the sentinel extends, which a skim re-seats ahead of instead.
   */
  const isSkimmingRef = useRef(false);

  /**
   * `true` on the first commit when the initial window has segments above the anchor — i.e. the
   * anchor sits mid-book, as on a cross-book remount (the loader swaps to `Loading…` then remounts
   * this hook fresh on the new book). Without snapping on mount the active verse would render
   * mid-window, below the fold, at `scrollTop` 0. Seeding {@link pendingRecenterSnapRef} and the
   * post-recenter snap lifecycle — which both normally skip the initial mount — pulls it to the top
   * behind the loader curtain. A normal first mount (anchor at the book start) leaves it `false` so
   * scroll stays at 0.
   */
  const needsInitialSnapRef = useRef(anchorIndex > range.start);

  // Latest callbacks/inputs, mirrored into refs so the recenter effect, `triggerRecenter`, and the
  // snap loop can read the current value while keeping a stable identity.
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

  // #endregion

  // #region Scroll-position bookkeeping (extend correction, above-viewport compensation, snap)

  /**
   * Scroll anchor owed to the next paint after an extend mutates the window. `el` is a mounted
   * segment element that survives the mutation (the old first segment for a top extend, the old
   * last for a bottom extend) and `top` is its viewport-relative top edge measured just before the
   * mutation. The layout effect restores the element to that exact viewport position by adding its
   * rect delta to `scrollTop`, which is correct regardless of what the mutation did around it —
   * prepended height, culled height at either end, chapter headings, flex gaps, and any browser
   * clamping of `scrollTop` are all captured by the element's measured movement.
   */
  const pendingExtendAnchorRef = useRef<{ el: Element; top: number } | undefined>(undefined);

  /**
   * Anchor for idle-time scroll compensation: the topmost mounted segment intersecting the
   * viewport, with its last-known offset below the container's top edge. When a resize reports
   * content settling (arc padding applied above the viewport), the observer restores this element
   * to its recorded offset, holding the visible content still. Anchoring on a _visible segment_ —
   * not the top sentinel — matters: the sentinel sits at the very top of the content, so its offset
   * only ever moves when `scrollTop` moves and is blind to height changes between it and the
   * viewport, which is the exact signal compensation exists to catch. Refreshed on every scroll
   * (user scrolling must never be misread as a height change to "correct"), after every extend
   * correction, on each observer (re)subscription, and after each compensation.
   */
  const compensationAnchorRef = useRef<{ el: Element; offset: number } | undefined>(undefined);

  /**
   * Re-picks and re-measures the compensation anchor: the first mounted segment whose bottom edge
   * sits below the container's top edge (the topmost visible segment), recorded with its current
   * offset below the container top. Offsets are container-relative, so the container itself moving
   * or resizing (the strip mounting above it, a panel resize) never reads as a content shift.
   * Clears the anchor when no mounted segment reaches the viewport (empty or fully-above window).
   */
  const rebaselineCompensationAnchor = useCallback(() => {
    const root = scrollContainerRef.current;
    /* v8 ignore next -- callers only run while the window (and so the container) is mounted */
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const els = root.querySelectorAll('[data-segment-id]');
    for (let i = 0; i < els.length; i += 1) {
      const rect = els[i].getBoundingClientRect();
      if (rect.bottom > rootTop) {
        compensationAnchorRef.current = { el: els[i], offset: rect.top - rootTop };
        return;
      }
    }
    compensationAnchorRef.current = undefined;
  }, [scrollContainerRef]);

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

  // Latest recenter inputs, mirrored into refs so `triggerRecenter` keeps a stable identity rather
  // than churning on every `anchorIndex` / `total` / `scrRef` change.
  const anchorIndexRef = useLatestRef(anchorIndex);
  const totalRef = useLatestRef(total);
  const segmentsRef = useLatestRef(segments);
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
   * Extends the window by up to {@link EXTEND_CHUNK} segments at one edge, culling from the opposite
   * edge every mounted segment that lies wholly beyond {@link CULL_RETENTION_PX} of the viewport.
   * Culling by measured geometry (rather than a fixed count) sizes the window to the viewport plus
   * retention margins in both display modes — compact baseline-text segments keep more mounted,
   * tall token-chip segments fewer — and guarantees a cull can never pull content back inside a
   * sentinel's arming margin. Before mutating, records a surviving segment element and its viewport
   * position so the layout effect can hold the visible content exactly still across the mutation.
   *
   * @param edge - Which end to grow: `'top'` prepends earlier segments, `'bottom'` appends later
   *   ones.
   */
  const extend = useCallback(
    (edge: 'top' | 'bottom') => {
      const { start, end } = rangeRef.current;
      if (edge === 'top' ? start === 0 : end >= total) return;
      const container = scrollContainerRef.current;
      /* v8 ignore next -- extend is only reachable through the sentinel observer, which requires the container */
      if (!container) return;
      /** Mounted segment roots in document order; index-aligned with the current window slice. */
      const els = Array.from(container.querySelectorAll('[data-segment-id]'));
      const containerRect = container.getBoundingClientRect();
      // Count the far-edge segments safely beyond the retention line. The cullable run is
      // contiguous from the far edge inward, so the walk stops at the first retained element.
      let cullable = 0;
      if (els.length > 0) {
        if (edge === 'top') {
          for (let i = els.length - 1; i >= 0; i -= 1) {
            if (els[i].getBoundingClientRect().top <= containerRect.bottom + CULL_RETENTION_PX) {
              break;
            }
            cullable += 1;
          }
        } else {
          for (let i = 0; i < els.length; i += 1) {
            if (els[i].getBoundingClientRect().bottom >= containerRect.top - CULL_RETENTION_PX) {
              break;
            }
            cullable += 1;
          }
        }
      }
      const size = end - start;
      const grow = Math.min(EXTEND_CHUNK, HARD_WINDOW_CAP - (size - cullable));
      if (grow <= 0) return;
      // Anchor on the surviving edge element: the old first segment for a top extend (culls take
      // the bottom), the old last for a bottom extend (culls take the top).
      const anchorEl = edge === 'top' ? els[0] : els[els.length - 1];
      if (anchorEl) {
        pendingExtendAnchorRef.current = {
          el: anchorEl,
          top: anchorEl.getBoundingClientRect().top,
        };
      }
      if (edge === 'top') {
        setRange({ start: Math.max(0, start - grow), end: end - cullable });
      } else {
        setRange({ start: start + cullable, end: Math.min(total, end + grow) });
      }
    },
    [scrollContainerRef, total, rangeRef],
  );

  /**
   * Snaps the recenter target — the active verse (the `aria-current` element) — to the top of the
   * scroll container.
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
    const target = container?.querySelector('[aria-current="true"]');
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
  }, [scrollContainerRef]);

  // Reconcile the container scroll position to the freshly-mounted range before the browser paints,
  // so neither an extend nor a recenter ever shows a jump. An extend mutated the window around a
  // recorded anchor element: add the anchor's measured rect delta to scrollTop so it (and all
  // visible content) holds its exact viewport position, whatever combination of prepended, appended,
  // and culled height the mutation produced. A recenter rebuilds around a new verse: snap that verse
  // (the `aria-current` element) to the top. Both are mutually exclusive — a given range change is
  // at most one of the two — and self-clear so unrelated renders leave the position alone. An extend
  // invalidates the compensation anchor (its element may have been culled, and the window around it
  // changed), so re-baseline rather than let the next resize "correct" a shift this effect already
  // handled (a recenter re-baselines through its epoch-driven re-subscription instead).
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const anchor = pendingExtendAnchorRef.current;
    if (anchor !== undefined) {
      pendingExtendAnchorRef.current = undefined;
      /* v8 ignore next -- container is always mounted while the window renders */
      if (!container) return;
      if (anchor.el.isConnected) {
        const delta = anchor.el.getBoundingClientRect().top - anchor.top;
        if (delta !== 0) container.scrollTop += delta;
      }
      rebaselineCompensationAnchor();
      return;
    }
    if (pendingRecenterSnapRef.current) {
      pendingRecenterSnapRef.current = false;
      snapActiveToTop();
    }
  }, [range, scrollContainerRef, snapActiveToTop, rebaselineCompensationAnchor]);

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
   * Rebuilds the window centered on the active verse and fades it into view. Exposed as the
   * imperative `recenterOnActive`.
   *
   * Reads `anchorIndex` / `total` / `scrRef` from refs so its identity is stable across renders,
   * and owns its timer through `recenterTimeoutRef`: a fresh call supersedes any in-flight fade
   * (clearing the prior timer) rather than letting incidental effect cleanups cancel it, so a
   * running fade is never stranded by an unrelated re-render.
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
      // Flip the parent's strip visibility (and the segments' display mode, which the parent passes
      // back down) in this same state batch so the strip mounts/unmounts in the same commit as the
      // window rebuild above — the re-snap loop then measures the active verse against the final,
      // strip-included layout instead of snapping before the strip exists.
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
  // this list, or strip arrow nav echoed back) makes `consumeInternalNav` return true, so skip the
  // fade — the target is already shown. Any other anchor change is an external navigation (Paratext
  // selector, scroll group) and recenters with the fade.
  //
  // "Internal" here means some view in the tree originated the nav — a wider question than the one
  // the strip asks of a focus move, which is whether it emitted that move itself. The two therefore
  // classify the same event differently by design. See FocusOrigin.
  //
  // A segments-identity change carrying a `segmentationVersion` bump is NOT a navigation: it is a
  // boundary edit (merge/split from the mounted controls). The window slice already re-renders the
  // new segments in the same commit, so fading afterwards would flash content the user is already
  // looking at and snap it away from the point they just clicked — sync the display refs (a merge
  // that absorbs the active verse's segment start re-resolves the anchor verse in the same commit)
  // and let the redraw stand. A segments change withOUT a version bump is a re-tokenization or book
  // swap at the same anchor index: the mounted range no longer matches the content, so it recenters
  // like any external change.
  const prevAnchorRef = useRef<{
    index: number;
    segments: readonly Segment[];
    segmentationVersion: number;
  }>({ index: anchorIndex, segments, segmentationVersion });
  useEffect(() => {
    const prev = prevAnchorRef.current;
    // Refresh the whole snapshot up front so no early return can leave a field stale for a later
    // comparison.
    prevAnchorRef.current = { index: anchorIndex, segments, segmentationVersion };
    const sameAnchor = anchorIndex === prev.index && segments === prev.segments;
    if (sameAnchor) return;
    const currentScrRef = scrRefRef.current;
    const isBoundaryEdit =
      segments !== prev.segments && segmentationVersion !== prev.segmentationVersion;
    if (isBoundaryEdit) {
      // A merge/split shifts every segment after the edit point by ±1, so the mounted `range` (held
      // in absolute indices) would slice the wrong content — dropping a top-visible segment merged
      // into its predecessor, or pulling one in from above on a split. The active verse does not
      // move (a merge that absorbs its start re-resolves to the same verse in the surviving
      // segment), so `anchorIndex - prev.index` is the structural shift at the anchor; apply it to
      // `range` so the same content stays framed, without the fade a full recenter would incur.
      const anchorDelta = anchorIndex - prev.index;
      if (anchorDelta !== 0) {
        setRange((r) => ({
          start: Math.max(0, r.start + anchorDelta),
          end: Math.min(total, r.end + anchorDelta),
        }));
      }
      setDisplayScrRef(currentScrRef);
      setDisplayFocusedTokenRef(focusedTokenRefRef.current);
      return;
    }
    if (consumeInternalNavRef.current(currentScrRef)) {
      setDisplayScrRef(currentScrRef);
      setDisplayFocusedTokenRef(focusedTokenRefRef.current);
      return;
    }
    triggerRecenter();
    // scrRef is read (via ref) only to key the internal-nav check; anchorIndex, segments, and
    // segmentationVersion already capture every change we classify on (and `total === segments.length`
    // tracks with `segments`, so the boundary-edit clamp never reads a stale total). `range` is
    // shifted through the functional `setRange` updater rather than closed over, and triggerRecenter
    // has a stable identity. The timeout is owned by triggerRecenter (recenterTimeoutRef), not torn
    // down here, so an incidental re-render that re-runs this effect can never cancel an in-flight fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIndex, segments, segmentationVersion, triggerRecenter]);

  // Track within-verse focus moves (arrow/click that stays in the active verse) immediately. These
  // change `focusedTokenRef` without changing `anchorIndex`, so the recenter effect above never
  // fires for them; sync the display ref here so the focus highlight follows. Skip while a recenter
  // fade is in flight — that swap owns the display ref and lands the new focus at the midpoint, so
  // updating here too would move the highlight (and re-dim buttons) on the old content before the
  // fade-out completes. `recenterTimeoutRef` is set synchronously by `triggerRecenter`, so it reads
  // true even in the same commit the external nav starts the fade, when `isFaded` state is still
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

  /**
   * The element wrapping the mounted segments (the fade wrapper), held in state so the compensation
   * observer re-subscribes once it attaches. This is the element whose border box actually changes
   * when segment heights settle: the scroll container's own box is fixed by the panel layout, so a
   * `ResizeObserver` on the container alone never fires for content growth — only the inner wrapper
   * reports it.
   */
  const [contentEl, setContentEl] = useState<HTMLElement | undefined>(undefined);

  const contentRef = useCallback((el: HTMLElement | null) => setContentEl(el ?? undefined), []);

  /** Latest `extend`, mirrored so the observer callback always routes through the current closure. */
  const extendRef = useLatestRef(extend);

  // Create one IntersectionObserver over both sentinels and extend the window when either nears the
  // viewport. Runs as an effect (after all refs, including the scroll-container ancestor, are
  // attached) so the root is available. Re-subscribes whenever the sentinel elements change, on each
  // recenter (via `recenterEpoch`), and on every `range` change. The re-subscriptions matter because
  // an IntersectionObserver only fires on intersection *transitions*: after a recenter or an extend
  // the sentinel nodes are unchanged and may still sit inside the arming margin (compact
  // baseline-text segments routinely leave the bottom sentinel within it), so a stale observer stays
  // silent however far the user scrolls. A fresh observer re-delivers the initial intersection state,
  // extending one chunk per delivery until the sentinel leaves the margin. The loop terminates
  // because each delivery either grows the window (pushing the sentinel away), hits the book edge, or
  // hits the hard cap (no range change, so no re-subscription).
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || (!topSentinel && !bottomSentinel)) return undefined;
    const edges = new WeakMap<Element, 'top' | 'bottom'>();
    if (topSentinel) edges.set(topSentinel, 'top');
    if (bottomSentinel) edges.set(bottomSentinel, 'bottom');
    const observer = new IntersectionObserver(
      (entries) => {
        // A skimming window is re-seated ahead of the drag instead; its range change re-subscribes
        // this observer once the skim ends, so the extends resume against the settled geometry.
        if (isSkimmingRef.current) return;
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
  }, [
    scrollContainerRef,
    topSentinel,
    bottomSentinel,
    recenterEpoch,
    range,
    extendRef,
    isSkimmingRef,
  ]);

  const heightTableRef = useLatestRef(heightTable);

  // Re-seat the window when the scroll position leaves the mounted segments entirely, as a thumb
  // drag or a click on the scrollbar track does. Whether it has left is read from the sentinels'
  // geometry, since the table's predicted heights for the mounted run can differ from its laid-out
  // ones; only the landing segment comes from the table. A re-seat starts a skim, during which the
  // window slides ahead of the drag whenever its leading edge nears the viewport. Coalesced to one
  // re-seat per animation frame: a drag delivers a scroll event per frame, and each one the run has
  // not caught up with would otherwise queue a whole further remount.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !topSentinel || !bottomSentinel) return undefined;

    let lastScrollTop = root.scrollTop;
    let direction: 1 | -1 = 1;
    let skimTimer: ReturnType<typeof setTimeout> | undefined;
    /** Whether a pointer is down on the container, which a scrollbar drag holds for its gesture. */
    let dragging = false;

    /** Whether a skim is running: its quiet timer is pending, or a drag is holding it open. */
    let skimming = false;

    // Ends the skim by handing the window back to the sentinels, leaving the mounted range as the
    // drag left it. Collapsing it here instead would unmount most of the window in one commit —
    // hundreds of milliseconds of teardown at the moment the reader is waiting to read — whereas the
    // extends cull by geometry as the reader scrolls on, shrinking it a chunk at a time.
    const endSkim = () => {
      skimTimer = undefined;
      // A held pointer is a drag mid-gesture, however long it has paused. Its release ends the skim.
      if (dragging) return;
      skimming = false;
      isSkimmingRef.current = false;
    };
    const armSkimEnd = () => {
      skimming = true;
      if (skimTimer !== undefined) clearTimeout(skimTimer);
      skimTimer = setTimeout(endSkim, SKIM_SETTLE_MS);
    };

    const reseat = () => {
      if (recenterInFlightRef.current) return;
      const rootRect = root.getBoundingClientRect();
      const topRect = topSentinel.getBoundingClientRect();
      const bottomRect = bottomSentinel.getBoundingClientRect();
      const mountedAbove = bottomRect.bottom < rootRect.top;
      const mountedBelow = topRect.top > rootRect.bottom;
      const runningOut =
        skimming &&
        (direction > 0
          ? bottomRect.bottom - rootRect.bottom < SKIM_LEAD_PX
          : rootRect.top - topRect.top < SKIM_LEAD_PX);
      if (!mountedAbove && !mountedBelow && !runningOut) return;
      const table = heightTableRef.current;
      const index = segmentIndexAtOffset(table, root.scrollTop);
      /* v8 ignore next -- a mounted list always has a segment for the table to resolve to */
      if (index < 0) return;
      const { start, end } = rangeRef.current;
      // A run the geometry reports off-screen while the table resolves the position inside it is
      // the table disagreeing with the layout; a re-seat would mount the same segments again.
      if (!runningOut && index >= start && index < end) return;
      // Slide the window when the drag is still inside it and only running out of runway ahead:
      // extending one edge and culling the other keeps every segment between them mounted, where
      // rebuilding around the new position would remount almost all of them. A drag that has left
      // the window outright has nothing to preserve, so that case still rebuilds.
      const next =
        runningOut && index >= start && index < end
          ? slideSkimRange(rangeRef.current, direction, table)
          : buildSkimRange(root.scrollTop, direction, table);
      if (next.start === start && next.end === end) return;
      // The scroll position is already where the user put it, so the rebuilt range must not snap.
      pendingRecenterSnapRef.current = false;
      isSkimmingRef.current = true;
      armSkimEnd();
      setRange(next);
    };

    let rafId: number | undefined;
    const onScroll = () => {
      const { scrollTop } = root;
      // Direction only turns on a move against it worth more than the jitter inside one gesture;
      // any move along it re-bases the comparison so the next reversal is measured from here.
      const delta = scrollTop - lastScrollTop;
      if (delta * direction > 0) lastScrollTop = scrollTop;
      else if (Math.abs(delta) >= SKIM_REVERSE_PX) {
        // Reaching here means the move ran against `direction`, so the turn is always a negation.
        direction = direction > 0 ? -1 : 1;
        lastScrollTop = scrollTop;
      }
      // A scroll mid-skim keeps the skim alive, whether or not it moves off the mounted run.
      if (skimming) armSkimEnd();
      if (rafId !== undefined) return;
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        reseat();
      });
    };

    const onPointerDown = () => {
      dragging = true;
    };
    // Ends a drag's skim on release rather than on a quiet timer, and re-arms the timer so a release
    // during a paused drag still settles. Listens on the window because a drag that leaves the
    // container (or ends over another element) still releases the scrollbar.
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (skimming) armSkimEnd();
    };

    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (skimTimer !== undefined) clearTimeout(skimTimer);
    };
  }, [
    scrollContainerRef,
    topSentinel,
    bottomSentinel,
    heightTableRef,
    rangeRef,
    totalRef,
    segmentsRef,
    recenterInFlightRef,
  ]);

  // Keep the visible content anchored against above-viewport height changes so already-mounted
  // segments can't shove what the user is reading as their arc padding settles asynchronously (the
  // arc-measurement pass's ResizeObserver → rAF → setState chain, which finishes across several
  // later frames). This single observer plays two roles depending on whether a recenter is in
  // flight:
  //
  // - **While a recenter is in flight** it relays each resize to the re-snap handler, which
  //   re-snaps the verse to the top against the now-settled geometry and restarts the settle's
  //   quiet timer. The recenter owns the scroll position here, so this is how the verse stays
  //   pinned through every settling wave — one re-snap per actual layout change.
  //
  // - **Otherwise** it compensates: on each resize it restores the anchor segment (see
  //   `compensationAnchorRef`) to its recorded offset below the container top, generalizing the
  //   extend correction (`pendingExtendAnchorRef`) from "extend events" to "any above-viewport
  //   growth". Container-relative offsets make the container's own movement (strip mount, panel
  //   resize) invisible to the delta. Stands down — re-baselining only — when the list is at the
  //   very top (`scrollTop === 0`, matching the extend correction's assumption that growth at the
  //   book top is fine) and when the anchor is missing or was unmounted.
  //
  // The container's scroll event re-baselines the anchor so user scrolling between waves is never
  // misread as a height change and "corrected" — the anchor's offset must only ever drift via
  // layout shifts, never via scrolling. Observes BOTH the segment wrapper (`contentEl`), whose box
  // changes when segment heights settle (the container's own box is fixed by the panel layout, so
  // observing it alone would never report content growth), and the container, whose box changes on
  // panel/strip resizes (the waves the in-flight relay role must see). Re-subscribes on each recenter
  // so the anchor is re-seeded for the new geometry.
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !contentEl) return undefined;
    const observer = new ResizeObserver(() => {
      // While the recenter owns the scroll, relay the resize to the re-snap handler instead of
      // compensating — it pins the verse to the top and keeps the settle's quiet window open.
      if (recenterInFlightRef.current) {
        relayResize();
        return;
      }
      const anchor = compensationAnchorRef.current;
      if (!anchor || !anchor.el.isConnected || root.scrollTop === 0) {
        rebaselineCompensationAnchor();
        return;
      }
      const offset = anchor.el.getBoundingClientRect().top - root.getBoundingClientRect().top;
      // When content above the viewport grows, the anchor segment is pushed down (its offset below
      // the container top increases); scrolling down by the same amount holds the visible content
      // fixed. Symmetric for shrink.
      const delta = offset - anchor.offset;
      if (delta !== 0) root.scrollTop += delta;
      rebaselineCompensationAnchor();
    });
    observer.observe(root);
    observer.observe(contentEl);
    const handleScroll = () => rebaselineCompensationAnchor();
    root.addEventListener('scroll', handleScroll, { passive: true });
    rebaselineCompensationAnchor();
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', handleScroll);
    };
  }, [
    scrollContainerRef,
    contentEl,
    recenterEpoch,
    recenterInFlightRef,
    relayResize,
    rebaselineCompensationAnchor,
  ]);

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
    range,
    isFaded,
    isSkimmingRef,
    displayScrRef,
    displayFocusedTokenRef,
    topSentinelRef,
    bottomSentinelRef,
    contentRef,
    recenterOnActive: triggerRecenter,
  };
}
