import { type RefObject, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  computeAllArcPaths,
  computeStripTopPadding,
  computeStripRowGap,
  type ArcPath,
} from '../utils/phrase-arc';

// #region Types

/** Resolved arc measurements for the phrase strip, recomputed after each render. */
export type ArcPathsResult = {
  /** SVG arc paths for discontiguous phrases, drawn above the strip. */
  arcPaths: ArcPath[];
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxArcLevel: number;
  /** Top padding (px) to clear the highest arc and the controls pill. */
  stripTopPadding: number;
  /** Vertical gap (px) between wrapped rows, grown so a lower row's arcs clear the row above. */
  stripRowGap: number;
  /** Left padding (px) reserved for cross-row arcs routed down the left gutter. */
  stripLeftPadding: number;
  /** Right padding (px) reserved for cross-row arcs routed down the right gutter. */
  stripRightPadding: number;
};

// #endregion

// #region useArcPaths

/**
 * Maximum consecutive re-applies of a signature already in the recent-signature history. A single
 * flip back to a recent signature is usually a genuine correction (the layout transiently collapsed
 * — e.g. a discontiguous phrase momentarily measuring as one box — then recovered), so it must be
 * applied. But an unbounded allowance re-opens the cross-row gutter feedback loop (period-2 padding
 * oscillation), so after this many consecutive flip-backs without a fixed point the hook freezes
 * and skips further history matches.
 */
const MAX_CONSECUTIVE_SIGNATURE_FLIPS = 2;

/**
 * Quiet-period delays (ms) at which settle verification re-measures after the last measurement
 * activity. Box geometry can drift with no resize event on the observed container: content settling
 * elsewhere shifts box positions without resizing the container, and a box reaching its final width
 * doesn't change the container's size either. Each verification pass re-measures; one that applies
 * new geometry restarts the schedule from the first delay, one that finds a fixed point (or a
 * frozen oscillation) advances to the next delay, and the chain stops after the last. Doubling
 * delays cover late reflows (fonts, morpheme rows) out to ~1.4s at a cost of at most three idle
 * re-measures per settle burst.
 */
const SETTLE_VERIFY_DELAYS_MS = [200, 400, 800];

/**
 * Serializes a measurement's applied outputs into a stable key. Arc level and the gutter paddings
 * are what feed back into layout, and the arc `d` plus the split-button geometry (`midX`/`midY` and
 * the run bounds) are what the strip renders. Including the split-button fields matters because a
 * deconfliction-only shift mutates `midX` without touching `d`, level, or padding: were it omitted,
 * such a pass would read as a redundant fixed point and be dropped, leaving the button in its
 * pre-shift position. Two measurements with the same signature therefore produce both the same
 * applied padding and the same rendered arcs, so they cannot represent genuine progress.
 */
function signatureOf(
  paths: ArcPath[],
  maxLevel: number,
  leftPadding: number,
  rightPadding: number,
): string {
  return `${maxLevel}:${leftPadding}:${rightPadding}:${paths
    .map(
      (p) =>
        `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}:${p.midX}:${p.midY}:${p.runLeft}:${p.runRight}`,
    )
    .join('|')}`;
}

/**
 * Measures the rendered phrase boxes after each layout commit and computes the arcs connecting
 * every discontiguous phrase's runs — the single arc derivation, so no layout can draw the same
 * phrase differently. State is only replaced when the serialized arc shape changes, so the layout
 * effect settles after one extra pass. A disabled container resets to empty instead of being
 * measured.
 *
 * Measurement is settle-aware: because box geometry can drift without any resize event on the
 * observed container (see {@link SETTLE_VERIFY_DELAYS_MS}), each pass arms a delayed verification
 * re-measure that repeats until the geometry reaches a fixed point, so arcs converge on the strip's
 * final layout even when the last reflow produces no observer event.
 *
 * The hook owns its top/left/right padding and re-measures when any changes, because the applied
 * padding shifts the layout the arcs are measured against — otherwise a 0→1 arc transition would
 * leave paths positioned for the old padding until an unrelated render.
 *
 * @param containerRef - Wraps the phrase-box elements to measure.
 * @param enabled - Whether the container is mounted and should be measured.
 * @param hasRealPhrase - Whether any committed phrase is rendered; feeds the controls headroom.
 * @param deps - Extra dependencies that should trigger a re-measure, such as token data or phrase
 *   mode.
 */
export function useArcPaths(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  hasRealPhrase: boolean,
  deps: readonly unknown[],
): ArcPathsResult {
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);
  const [maxArcLevel, setMaxArcLevel] = useState(0);
  const [stripLeftPadding, setStripLeftPadding] = useState(0);
  const [stripRightPadding, setStripRightPadding] = useState(0);

  const stripTopPadding = computeStripTopPadding(
    enabled && arcPaths.length > 0,
    maxArcLevel,
    hasRealPhrase,
  );
  const stripRowGap = computeStripRowGap(
    enabled && arcPaths.length > 0,
    maxArcLevel,
    hasRealPhrase,
  );

  // Collapse `deps` into a version counter so the layout effect's dep array stays fixed-length. It
  // increments whenever any element of `deps` changes identity, triggering a re-measure.
  const prevDepsRef = useRef<readonly unknown[]>(deps);
  const depsVersionRef = useRef(0);
  if (
    prevDepsRef.current.length !== deps.length ||
    deps.some((d, i) => d !== prevDepsRef.current[i])
  ) {
    prevDepsRef.current = deps;
    depsVersionRef.current += 1;
  }
  const depsVersion = depsVersionRef.current;

  /**
   * Serialized signatures of the two most recent applied measurements, most-recent first (entry 0
   * is always the currently-applied state). A non-forced measurement matching entry 0 is a fixed
   * point and is skipped as pure echo. One matching entry 1 is ambiguous: either a period-2
   * oscillation (padding A → re-wrap → padding B → re-wrap → padding A → …) or a genuine recovery
   * from a transient mis-measure; the flip counter disambiguates by allowing a bounded number of
   * consecutive flip-backs. Without this guard the cross-row gutter padding (which shifts where
   * tokens wrap, which changes the arcs, which changes the padding) never reaches a fixed point and
   * the ResizeObserver spins at frame rate, freezing the WebView. Empty so the first measure always
   * runs; reset whenever a forced measure occurs.
   */
  const recentArcSignaturesRef = useRef<string[]>([]);

  /**
   * Count of consecutive non-forced applies whose signature matched the recent-signature history
   * (flip-backs) without an intervening fixed point, fresh signature, or forced measure. Below
   * {@link MAX_CONSECUTIVE_SIGNATURE_FLIPS} a history match is applied anyway (a transient
   * collapse-then-recover must not be swallowed); at the cap further history matches are skipped,
   * freezing a true period-2 oscillation after a bounded number of passes.
   */
  const flipCountRef = useRef(0);

  /** Pending settle-verification timer; re-armed by every measurement pass, cleared on teardown. */
  const settleVerifyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Index into {@link SETTLE_VERIFY_DELAYS_MS} of the next verification round. */
  const settleVerifyRoundRef = useRef(0);

  const measure = useCallback(
    /**
     * Runs one measurement pass against `container` and flushes the results into state. Per-field
     * equality guards keep stable measurements from churning state.
     *
     * @param container - The element to measure phrase boxes inside.
     * @param force - When `true`, measure even if the signature was recently seen, and reset the
     *   recent-signature history afterward. Used for genuine input changes (token data, phrase
     *   mode, enabled); other callers pass `false` so echoes and oscillations are damped.
     * @param isVerify - `true` when scheduled by the settle-verification timer; such passes advance
     *   the verification round when they find nothing new, so the chain terminates.
     */
    function measurePass(container: Element, force: boolean, isVerify = false) {
      const { paths, maxLevel, leftPadding, rightPadding } = computeAllArcPaths(container);
      const signature = signatureOf(paths, maxLevel, leftPadding, rightPadding);
      const history = recentArcSignaturesRef.current;

      // Decide whether to apply this measurement. `history[0]` is always the currently-applied
      // signature, so matching it is a harmless fixed point. Matching a deeper entry is either a
      // period-2 oscillation echo or a genuine recovery from a transient mis-measure; allow a
      // bounded number of consecutive flip-backs (the recovery case), then freeze (the loop case).
      let apply: boolean;
      if (force) {
        flipCountRef.current = 0;
        apply = true;
      } else if (signature === history[0]) {
        flipCountRef.current = 0;
        apply = false;
      } else if (history.includes(signature)) {
        apply = flipCountRef.current < MAX_CONSECUTIVE_SIGNATURE_FLIPS;
        if (apply) flipCountRef.current += 1;
      } else {
        flipCountRef.current = 0;
        apply = true;
      }

      // Settle verification: geometry can drift with no resize event on the observed container, so
      // every pass arms a delayed re-measure. Ordinary passes restart the schedule; verification
      // passes that found nothing new advance to the next (longer) delay so the chain stops after
      // SETTLE_VERIFY_DELAYS_MS runs out — including in the frozen-oscillation state, where each
      // verification skips and the chain dies instead of re-fueling the loop.
      if (!isVerify || apply) settleVerifyRoundRef.current = 0;
      else settleVerifyRoundRef.current += 1;
      clearTimeout(settleVerifyTimerRef.current);
      const round = settleVerifyRoundRef.current;
      if (round < SETTLE_VERIFY_DELAYS_MS.length) {
        settleVerifyTimerRef.current = setTimeout(() => {
          measurePass(container, false, true);
        }, SETTLE_VERIFY_DELAYS_MS[round]);
      }

      if (!apply) return;
      // A forced (input-driven) measure starts a fresh convergence, so drop the stale history;
      // other applies prepend onto a 2-deep window so entry 0 stays the applied signature.
      recentArcSignaturesRef.current = force ? [signature] : [signature, ...history].slice(0, 2);
      setArcPaths((prev) => {
        // Identity key for the referential-equality guard below. Includes the split-button geometry
        // so a deconfliction-only shift — which moves the button without touching the arc path —
        // still replaces the paths rather than leaving the button in its pre-shift position.
        const key = (p: ArcPath) =>
          `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}:${p.midX}:${p.midY}:${p.runLeft}:${p.runRight}`;
        const prevKey = prev.map(key).join('|');
        const nextKey = paths.map(key).join('|');
        return prevKey === nextKey ? prev : paths;
      });
      setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
      setStripLeftPadding((prev) => (prev === leftPadding ? prev : leftPadding));
      setStripRightPadding((prev) => (prev === rightPadding ? prev : rightPadding));
    },
    [],
  );

  // Observe the container so arcs redraw on wrap, calling `measure` directly to skip a render cycle.
  //
  // The callback is deferred to the next frame, not run synchronously: measuring sets the strip's
  // padding, which resizes the wrapping row, which the observer reports as a new resize. Measuring
  // synchronously turns that into a same-tick setState storm React escalates to "Maximum update
  // depth exceeded". One measurement per frame lets layout settle between passes (and silences the
  // "ResizeObserver loop" warning).
  //
  // `force: false` makes the observer skip a re-measure whose result matches the last one — the
  // self-induced echo from our own padding application — so the cross-row gutter feedback loop
  // (padding → re-wrap → new padding → …) terminates instead of spinning at frame rate.
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) return;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => measure(container, false));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      // Stop any pending settle verification: after unmount (or container change) its captured
      // container is stale; the input-driven measure re-arms the chain if still live.
      clearTimeout(settleVerifyTimerRef.current);
    };
  }, [containerRef, enabled, measure]);

  // Input-driven measure: runs when the container, the enabled flag, or the caller's `deps`
  // (token data, phrase mode, …) change. These are genuine content changes, so `force: true`
  // always re-measures. Also owns the reset-to-empty path when disabled or unmounted.
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) {
      // Reset the echo guard so re-enabling re-measures from scratch rather than matching a stale
      // signature, and stop the settle-verification chain (its captured container no longer reflects
      // a live measurement target).
      recentArcSignaturesRef.current = [];
      flipCountRef.current = 0;
      settleVerifyRoundRef.current = 0;
      clearTimeout(settleVerifyTimerRef.current);
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      setStripLeftPadding((prev) => (prev === 0 ? prev : 0));
      setStripRightPadding((prev) => (prev === 0 ? prev : 0));
      return;
    }
    measure(container, true);
  }, [containerRef, enabled, depsVersion, measure]);

  // Padding-driven re-measure: applying the hook's own top/row/left/right padding shifts the layout
  // the arcs are measured against (see the hook doc), so a padding change must re-measure once to
  // reposition the paths. `force: false` applies the echo guard: if the re-measure reproduces the
  // last signature (the common case, and the only outcome when the gutter padding would otherwise
  // oscillate) it stops here instead of looping. New geometry still flows through and settles next
  // pass.
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) return;
    measure(container, false);
  }, [
    containerRef,
    enabled,
    stripTopPadding,
    stripRowGap,
    stripLeftPadding,
    stripRightPadding,
    measure,
  ]);

  return {
    arcPaths,
    maxArcLevel,
    stripTopPadding,
    stripRowGap,
    stripLeftPadding,
    stripRightPadding,
  };
}

// #endregion
