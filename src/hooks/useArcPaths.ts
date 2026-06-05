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
 * Measures the rendered phrase boxes inside `containerRef` after each layout commit and computes
 * the arcs connecting every discontiguous phrase's runs. Shared by SegmentView and ContinuousView
 * so the two strip layouts can't drift apart. State is only replaced when the serialized arc shape
 * changes, so the layout effect settles after one extra pass; when `enabled` is `false` the result
 * is reset to empty instead of measured.
 *
 * The hook owns its top/left/right padding and re-measures when any changes, because the applied
 * padding shifts the layout the arcs are measured against — otherwise a 0→1 arc transition would
 * leave paths positioned for the old padding until an unrelated render.
 *
 * @param containerRef - Ref to the element wrapping the `[data-phrase-box]` elements to measure.
 * @param enabled - Whether the container is mounted and should be measured; `false` resets to
 *   empty.
 * @param hasRealPhrase - Whether any committed phrase is rendered; feeds the controls headroom.
 * @param deps - Extra dependencies that should trigger a re-measure (token data, phrase mode,
 *   etc.).
 * @returns The current arc paths, max nesting level, and the strip's top/left/right padding.
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
   * Serialized signatures of the hook's two most recent self-induced (observer-driven)
   * measurements, most-recent first. A measurement whose signature matches either entry means the
   * observed resize was just the layout settling around padding the hook already applied — the echo
   * that closes the feedback loop — so the redraw is skipped. Two entries (not one) are kept so a
   * true period-2 oscillation (padding A → re-wrap → padding B → re-wrap → padding A → …) is caught
   * as well as a plain period-1 echo. Without this guard the cross-row gutter padding (which shifts
   * where tokens wrap, which changes the arcs, which changes the padding) never reaches a fixed
   * point and the ResizeObserver spins at frame rate, freezing the WebView. Empty so the first
   * measure always runs; cleared whenever a genuine input change forces a measure.
   */
  const recentArcSignaturesRef = useRef<string[]>([]);

  /**
   * Serializes a measurement's padding-affecting outputs into a stable key. Arc level and the
   * gutter paddings are what feed back into layout, so two measurements with the same signature
   * produce the same applied padding and cannot represent genuine progress.
   *
   * @param paths - The measured arc paths.
   * @param maxLevel - The measured max nesting level.
   * @param leftPadding - The measured left gutter padding.
   * @param rightPadding - The measured right gutter padding.
   * @returns A signature string that is equal iff the layout-affecting outputs match.
   */
  const signatureOf = (
    paths: ArcPath[],
    maxLevel: number,
    leftPadding: number,
    rightPadding: number,
  ): string =>
    `${maxLevel}:${leftPadding}:${rightPadding}:${paths
      .map((p) => `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}`)
      .join('|')}`;

  /**
   * Runs one measurement pass against `container` and flushes the results into state. Called from
   * both the layout effect and the ResizeObserver, so resize redraws skip the extra render cycle a
   * version-counter bump would need. Per-field equality guards keep stable measurements from
   * churning state.
   *
   * @param container - The element to measure phrase boxes inside.
   * @param force - When `true`, measure even if the signature was recently seen, and reset the
   *   recent-signature history afterward. Used for genuine input changes (token data, phrase mode,
   *   enabled); the ResizeObserver passes `false` so a self-induced echo or oscillation that
   *   reproduces a recent signature is ignored.
   */
  const measure = useCallback((container: Element, force: boolean) => {
    const { paths, maxLevel, leftPadding, rightPadding } = computeAllArcPaths(container);
    const signature = signatureOf(paths, maxLevel, leftPadding, rightPadding);
    // Self-induced echo/oscillation: the resize merely re-settled the layout around padding the
    // hook already applied, reproducing a signature from one of the last two passes. Re-measuring
    // would loop, so skip — unless a genuine input change forces the pass.
    if (!force && recentArcSignaturesRef.current.includes(signature)) return;
    // A forced (input-driven) measure starts a fresh convergence, so drop the stale history;
    // observer-driven measures prepend onto a 2-deep window to detect period-1 and period-2 loops.
    recentArcSignaturesRef.current = force
      ? [signature]
      : [signature, ...recentArcSignaturesRef.current].slice(0, 2);
    setArcPaths((prev) => {
      // Include the split-button geometry (midX/midY and run bounds) so that a deconfliction-only
      // shift — which mutates midX without touching `d` — still replaces the paths rather than
      // reusing the stale array and leaving the button in its pre-shift position.
      const key = (p: ArcPath) =>
        `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}:${p.midX}:${p.midY}:${p.runLeft}:${p.runRight}`;
      const prevKey = prev.map(key).join('|');
      const nextKey = paths.map(key).join('|');
      return prevKey === nextKey ? prev : paths;
    });
    setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
    setStripLeftPadding((prev) => (prev === leftPadding ? prev : leftPadding));
    setStripRightPadding((prev) => (prev === rightPadding ? prev : rightPadding));
  }, []);

  // Observe the container so arcs redraw on wrap, calling `measure` directly to skip a render cycle.
  //
  // The callback is deferred to the next frame, not run synchronously: measuring sets the strip's
  // padding, which resizes the wrapping row, which the observer reports as a new resize. Measuring
  // synchronously turns that into a same-tick setState storm React escalates to "Maximum update
  // depth exceeded" (the crash when shrinking enough to wrap many cross-row arcs). One measurement
  // per frame lets layout settle between passes (and silences the "ResizeObserver loop" warning).
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
    };
  }, [containerRef, enabled, measure]);

  // Input-driven measure: runs when the container, the enabled flag, or the caller's `deps`
  // (token data, phrase mode, …) change. These are genuine content changes, so `force: true`
  // always re-measures. Also owns the reset-to-empty path when disabled or unmounted.
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) {
      // Reset the echo guard so re-enabling re-measures from scratch rather than matching a stale
      // signature left over from before the container unmounted.
      recentArcSignaturesRef.current = [];
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      setStripLeftPadding((prev) => (prev === 0 ? prev : 0));
      setStripRightPadding((prev) => (prev === 0 ? prev : 0));
      return;
    }
    measure(container, true);
  }, [containerRef, enabled, depsVersion, measure]);

  // Padding-driven re-measure: applying the hook's own top/row/left/right padding shifts the
  // layout the arcs are measured against (see the hook doc), so a padding change must re-measure
  // once to reposition the paths. `force: false` applies the echo guard: if the re-measure
  // reproduces the last signature — the common case, and the only outcome when the gutter padding
  // would otherwise oscillate (pad → re-wrap → pad → …) — it stops here instead of looping. A
  // padding change that yields genuinely new geometry still flows through and settles next pass.
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
