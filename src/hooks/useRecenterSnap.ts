import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RECENTER_FADE_MS } from '../components/recenter-fade';
import useLatestRef from './useLatestRef';

/**
 * How long, in milliseconds, the post-recenter snap keeps watching for late layout shifts before it
 * gives up and reports settled regardless. After a recenter the freshly-mounted layout does not
 * reach its final geometry in a single frame — and on a continuous-scroll toggle it settles in
 * _waves_: the segments switch display mode, the horizontal strip mounts, and `useArcPaths`
 * measures/clears arc padding, each across its own ResizeObserver → rAF → setState chain that lands
 * on different frames. Rather than poll every frame for this whole window, the snap is driven by
 * the resize observer that already fires on each of those waves (it re-snaps the verse on every
 * fire); this is only the backstop deadline for a layout that never stops shifting, so the loader
 * curtain is never stranded waiting for a settle that won't come.
 */
const RECENTER_RESNAP_DEADLINE_MS = RECENTER_FADE_MS;

/**
 * How long, in milliseconds, the layout must go without a resize-driven re-snap before the recenter
 * is reported "settled" to the cross-book fade clock (which lifts the loader curtain). The waves of
 * late layout settling each fire the resize observer; once they stop — no fire for this quiet
 * window — the layout has reached its final geometry and the curtain can lift. Short enough that
 * the curtain lifts promptly after a book change, long enough to span the gap between two settling
 * waves so a lull mid-settle doesn't report settled early.
 */
const RECENTER_SETTLE_QUIET_MS = 100;

/** Arguments for {@link useRecenterSnap}. */
export interface UseRecenterSnapArgs {
  /**
   * Snaps the recenter target (the active verse) to the top of the scroll container. Called after
   * paint and on each settling wave; must have a stable identity so the settle effect only re-runs
   * per recenter.
   */
  snapActiveToTop: () => void;
  /**
   * `true` when the initial mount is a cross-book remount whose anchor sits mid-book and so needs
   * the verse pulled to the top before paint; `false` for a normal first mount (anchor at the book
   * start) that leaves scroll at 0. Read once on the first settle.
   */
  needsInitialSnap: boolean;
  /**
   * Called once per settle, after the verse is snapped and the layout has gone quiet. The
   * cross-book fade clock uses it to lift the loader curtain. Safe to over-call. Read through a
   * latest-ref so the settle effect keeps a stable dependency.
   */
  onSettled?: () => void;
}

/** Return value of {@link useRecenterSnap}. */
export interface UseRecenterSnapResult {
  /**
   * Bumped once per recenter (see {@link beginRecenterSettle}). Effects in the parent key off it to
   * re-subscribe observers against the new geometry — the re-snap effect here, and the sentinel
   * IntersectionObserver, which must re-observe so the browser re-delivers the initial intersection
   * state (without it a sentinel can sit intersecting yet silent until an up-then-down scroll
   * forces a transition).
   */
  recenterEpoch: number;
  /**
   * `true` from the moment a recenter starts (or the initial mount, until its first settle) through
   * the post-paint settle, cleared once the layout goes quiet. While set, the recenter owns the
   * scroll position: the parent's compensation observer relays each resize to {@link relayResize}
   * instead of compensating for above-viewport growth.
   */
  recenterInFlightRef: RefObject<boolean>;
  /**
   * Marks a recenter as starting (the fade-out begins): the recenter now owns the scroll position.
   * Called synchronously at the start of the fade, before the midpoint window rebuild.
   */
  markRecenterStarted: () => void;
  /**
   * Bumps {@link recenterEpoch}, arming the post-paint re-snap + settle lifecycle for this recenter.
   * Called at the recenter midpoint, in the same state batch as the window rebuild, so the re-snap
   * measures against the final layout.
   */
  beginRecenterSettle: () => void;
  /**
   * Called by the parent's compensation observer on each resize while a recenter is in flight —
   * i.e. each wave of late layout settling (mode swap, strip mount, arc-padding application).
   * Re-snaps the verse against the freshly-settled geometry and pushes back the quiet-debounce
   * settle timer, so "settled" is reported only once the waves stop. A no-op between recenters.
   */
  relayResize: () => void;
}

/**
 * Owns the post-recenter re-snap and settle lifecycle for the segment window.
 *
 * After a recenter rebuilds the window the freshly-mounted segments do not reach their final
 * heights synchronously — arc padding is measured and applied by `useArcPaths` across several later
 * frames (a ResizeObserver → rAF → setState chain) — so a one-shot snap can compute its target
 * against stale heights and leave the verse off screen, pinned to an edge. This hook re-snaps the
 * verse against each settling wave (event-driven, via {@link UseRecenterSnapResult.relayResize}, not
 * a per-frame loop) and reports settled once the layout goes quiet. All of it runs behind the
 * recenter fade, so none of the intermediate corrections are seen.
 *
 * Extracted from {@link useSegmentWindow} so its intricate timing (epoch bump, quiet-debounce, and
 * deadline backstop) lives behind one boundary rather than tangled into the main hook body.
 *
 * @param args - Hook arguments.
 * @param args.snapActiveToTop - Snaps the recenter target to the top of the container.
 * @param args.needsInitialSnap - Whether the initial mount needs a snap (cross-book remount).
 * @param args.onSettled - Reported once per settle; lifts the cross-book loader curtain.
 * @returns The recenter epoch, in-flight ref, and the start/begin/relay handlers.
 */
export default function useRecenterSnap({
  snapActiveToTop,
  needsInitialSnap,
  onSettled,
}: UseRecenterSnapArgs): UseRecenterSnapResult {
  const [recenterEpoch, setRecenterEpoch] = useState(0);

  /** Latest `onSettled`, mirrored so the settle effect fires the current callback with a stable dep. */
  const onSettledRef = useLatestRef(onSettled);

  /**
   * See {@link UseRecenterSnapResult.recenterInFlightRef}. Seeded `true` so the first settle clears
   * it.
   */
  const recenterInFlightRef = useRef(true);

  /**
   * Re-snap handler the parent's compensation observer relays each resize to while a recenter is in
   * flight; `undefined` between recenters, in which case {@link relayResize} is a no-op.
   */
  const onResnapResizeRef = useRef<(() => void) | undefined>(undefined);

  /** Latest `snapActiveToTop`, mirrored so {@link relayResize} keeps a stable identity. */
  const snapActiveToTopRef = useLatestRef(snapActiveToTop);

  /** Read once on the first settle, then cleared, so only a fresh mid-book mount snaps on mount. */
  const needsInitialSnapRef = useRef(needsInitialSnap);

  /** `true` until the first settle effect runs, so the initial mount takes the mount-only path. */
  const isInitialEpochRef = useRef(true);

  // Re-snap the recentered verse after paint and hold it there as the layout settles, then report
  // settled once the layout goes quiet. One rAF re-snap catches the first painted frame (the common
  // case); each later settling wave, relayed through `relayResize`, re-snaps against the now-settled
  // geometry. A quiet-debounce timer reports settled once no wave has fired for
  // `RECENTER_SETTLE_QUIET_MS`; a deadline backstops a layout that never stops shifting so the loader
  // curtain is never stranded. Skips the initial mount (epoch 0); only real recenters re-snap.
  useEffect(() => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let didReportSettled = false;
    // Marks the recenter complete: the recenter no longer owns the scroll, so the compensation
    // observer resumes plain above-viewport compensation, and the cross-book fade clock lifts the
    // curtain off the settle signal. Idempotent — the quiet timer and the deadline race to call it.
    const reportSettled = () => {
      // Idempotency guard against a double-report. Whichever of the quiet/deadline timers fires first
      // clears the other, so in practice this is never reached; it is defensive only.
      /* v8 ignore next */
      if (didReportSettled) return;
      didReportSettled = true;
      clearTimeout(quietTimer);
      clearTimeout(deadlineTimer);
      onResnapResizeRef.current = undefined;
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
    // (Re)arm the quiet-debounce: each settling wave that re-snaps the verse pushes the settle report
    // back, so it fires only once the waves stop.
    const armQuietTimer = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(reportSettled, RECENTER_SETTLE_QUIET_MS);
    };
    // Called by the compensation observer (via `relayResize`) on each resize while this recenter is in
    // flight: re-snap the verse against the now-settled geometry and restart the quiet window.
    onResnapResizeRef.current = () => {
      snapActiveToTopRef.current();
      armQuietTimer();
    };
    // One post-paint re-snap covers the common case where the layout settles in a single frame; the
    // quiet timer then reports settled unless a later wave (relayed through `relayResize`) restarts it.
    const rafId = requestAnimationFrame(() => {
      snapActiveToTopRef.current();
      armQuietTimer();
    });
    // Backstop: a layout that resizes forever would keep restarting the quiet timer, so cap the total
    // wait and report settled regardless, leaving the verse snapped to its latest position.
    deadlineTimer = setTimeout(reportSettled, RECENTER_RESNAP_DEADLINE_MS);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(quietTimer);
      clearTimeout(deadlineTimer);
      onResnapResizeRef.current = undefined;
    };
  }, [recenterEpoch, snapActiveToTopRef, onSettledRef]);

  const markRecenterStarted = useCallback(() => {
    recenterInFlightRef.current = true;
  }, []);
  const beginRecenterSettle = useCallback(() => {
    setRecenterEpoch((n) => n + 1);
  }, []);
  const relayResize = useCallback(() => {
    onResnapResizeRef.current?.();
  }, []);

  return {
    recenterEpoch,
    recenterInFlightRef,
    markRecenterStarted,
    beginRecenterSettle,
    relayResize,
  };
}
