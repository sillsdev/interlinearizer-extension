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

  const stripTopPadding = computeStripTopPadding(arcPaths.length > 0, maxArcLevel, hasRealPhrase);
  const stripRowGap = computeStripRowGap(arcPaths.length > 0, maxArcLevel, hasRealPhrase);

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
   * Runs one measurement pass against `container` and flushes the results into state. Called from
   * both the layout effect and the ResizeObserver, so resize redraws skip the extra render cycle a
   * version-counter bump would need. Per-field equality guards keep stable measurements from
   * churning state.
   *
   * @param container - The element to measure phrase boxes inside.
   */
  const measure = useCallback((container: Element) => {
    const { paths, maxLevel, leftPadding, rightPadding } = computeAllArcPaths(container);
    setArcPaths((prev) => {
      const key = (p: ArcPath) => `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}`;
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
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) return;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => measure(container));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [containerRef, enabled, measure]);

  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) {
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      setStripLeftPadding((prev) => (prev === 0 ? prev : 0));
      setStripRightPadding((prev) => (prev === 0 ? prev : 0));
      return;
    }
    measure(container);
    // The padding values are intentionally deps: applying them shifts the measured layout (see the
    // hook doc), so a padding change must trigger a re-measure. Stabilizes after one extra pass.
  }, [
    containerRef,
    enabled,
    stripTopPadding,
    stripRowGap,
    stripLeftPadding,
    stripRightPadding,
    depsVersion,
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
