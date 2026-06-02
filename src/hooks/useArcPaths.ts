import { type RefObject, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { computeAllArcPaths, computeStripTopPadding, type ArcPath } from '../utils/phrase-arc';

// #region Types

/** Resolved arc measurements for the phrase strip, recomputed after each render. */
export type ArcPathsResult = {
  /** SVG arc path strings keyed by phraseId, drawn above the strip for discontiguous phrases. */
  arcPaths: ArcPath[];
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxArcLevel: number;
  /** Top padding (px) the strip needs to clear the highest arc and the hover controls pill. */
  stripTopPadding: number;
  /**
   * Minimum row gap (px) needed to accommodate all cross-row arcs without overlapping. Zero when
   * there are no cross-row arcs. The caller should apply this as `row-gap` / `gap-y` on the token
   * row so the inter-row space expands dynamically.
   */
  requiredRowGapPx: number;
};

// #endregion

// #region useArcPaths

/**
 * Measures the rendered phrase boxes inside `containerRef` after each layout commit and computes
 * the cubic Bézier arcs that connect the runs of every discontiguous phrase. Shared by SegmentView
 * and ContinuousView so the two strip layouts can never drift apart in how arcs are derived.
 *
 * State is only replaced when the serialized arc shape actually changes, so the layout effect
 * settles after at most one extra pass rather than looping. When `enabled` is `false` (e.g.
 * SegmentView's baseline-text mode, where the container is unmounted) the result is reset to empty
 * instead of measuring.
 *
 * The hook owns `stripTopPadding` and re-measures whenever it changes: the applied padding shifts
 * the layout that arcs are measured against, so without it a 0→1 arc transition would leave the
 * paths positioned for the old padding until an unrelated render. Owning it here keeps that
 * self-referential dependency inside the hook rather than forcing callers to thread it back in.
 *
 * @param containerRef - Ref to the element wrapping the `[data-phrase-box]` elements to measure.
 * @param enabled - Whether the container is mounted and should be measured; `false` resets to
 *   empty.
 * @param hasRealPhrase - Whether any committed phrase is rendered; feeds the controls headroom in
 *   the top-padding calculation.
 * @param deps - Extra dependencies that should trigger a re-measure (token data, phrase mode,
 *   etc.). The effect always re-runs when `enabled` or the computed padding changes.
 * @returns An {@link ArcPathsResult} containing the current arc paths, maximum nesting level, strip
 *   top padding, and the required row gap in pixels needed to accommodate cross-row arcs.
 */
export function useArcPaths(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  hasRealPhrase: boolean,
  deps: readonly unknown[],
): ArcPathsResult {
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);
  const [maxArcLevel, setMaxArcLevel] = useState(0);
  const [requiredRowGapPx, setRequiredRowGapPx] = useState(0);

  const stripTopPadding = computeStripTopPadding(arcPaths.length > 0, maxArcLevel, hasRealPhrase);

  // Collapse `deps` into a monotonically increasing version counter so the layout effect dep array
  // is always fixed-length. The counter increments whenever any element of `deps` changes identity,
  // triggering a re-measure without violating the rules of hooks.
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
   * both the layout effect (for normal re-renders) and the ResizeObserver callback (for size
   * changes), so resize redraws bypass the extra render cycle that bumping a version counter would
   * require.
   *
   * @param container - The element to measure phrase boxes inside.
   */
  const measure = useCallback((container: Element) => {
    const { paths, maxLevel, requiredRowGapPx: rowGap } = computeAllArcPaths(container);
    setArcPaths((prev) => {
      const key = (p: ArcPath) => `${p.phraseId}:${p.splitAfterTokenRef}:${p.d}`;
      const prevKey = prev.map(key).join('|');
      const nextKey = paths.map(key).join('|');
      return prevKey === nextKey ? prev : paths;
    });
    setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
    setRequiredRowGapPx((prev) => (prev === rowGap ? prev : rowGap));
  }, []);

  // Observe the container for size changes so arcs are redrawn when wrapping occurs. The observer
  // calls `measure` directly instead of bumping a version counter, eliminating the extra render
  // cycle that would otherwise delay the redraw.
  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      measure(container);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [containerRef, enabled, measure]);

  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) {
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      setRequiredRowGapPx((prev) => (prev === 0 ? prev : 0));
      return;
    }
    measure(container);
    // stripTopPadding is intentionally a dep: see the hook doc comment. The loop stabilizes after
    // one extra pass because arc count doesn't change between passes.
  }, [containerRef, enabled, stripTopPadding, depsVersion, measure]);

  return { arcPaths, maxArcLevel, stripTopPadding, requiredRowGapPx };
}

// #endregion
