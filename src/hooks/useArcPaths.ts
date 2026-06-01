import { type RefObject, useLayoutEffect, useState } from 'react';
import { computeAllArcPaths, computeStripTopPadding, type ArcPath } from '../utils/phrase-arc';

/** Resolved arc measurements for the phrase strip, recomputed after each render. */
export type ArcPathsResult = {
  /** SVG arc path strings keyed by phraseId, drawn above the strip for discontiguous phrases. */
  arcPaths: ArcPath[];
  /**
   * Nesting level per phraseId; used to compute the controls pill offset so it aligns with the arc
   * top.
   */
  arcLevelByPhraseId: Map<string, number>;
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxArcLevel: number;
  /** Top padding (px) the strip needs to clear the highest arc and the hover controls pill. */
  stripTopPadding: number;
};

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
 * @returns The current arc paths, per-phrase nesting levels, maximum nesting level, and the strip
 *   top padding derived from them.
 */
export function useArcPaths(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  hasRealPhrase: boolean,
  deps: readonly unknown[],
): ArcPathsResult {
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);
  const [arcLevelByPhraseId, setArcLevelByPhraseId] = useState<Map<string, number>>(new Map());
  const [maxArcLevel, setMaxArcLevel] = useState(0);

  const stripTopPadding = computeStripTopPadding(arcPaths.length > 0, maxArcLevel, hasRealPhrase);

  useLayoutEffect(() => {
    const container = enabled ? containerRef.current : undefined;
    if (!container) {
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setArcLevelByPhraseId((prev) => (prev.size === 0 ? prev : new Map()));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const { paths, levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    setArcPaths((prev) => {
      const prevKey = prev.map((p) => p.d).join('|');
      const nextKey = paths.map((p) => p.d).join('|');
      return prevKey === nextKey ? prev : paths;
    });
    setArcLevelByPhraseId((prev) => {
      const changed =
        prev.size !== levelByPhraseId.size ||
        [...levelByPhraseId.entries()].some(([id, level]) => prev.get(id) !== level);
      return changed ? new Map(levelByPhraseId) : prev;
    });
    setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
    // stripTopPadding is intentionally a dep: see the hook doc comment. The loop stabilizes after
    // one extra pass because arc count doesn't change between passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stripTopPadding, ...deps]);

  return { arcPaths, arcLevelByPhraseId, maxArcLevel, stripTopPadding };
}
