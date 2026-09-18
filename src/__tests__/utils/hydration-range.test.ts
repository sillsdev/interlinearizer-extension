/// <reference types="jest" />

import type { HydrationTarget } from '../../utils/hydration-range';
import { hydrationTarget, rangeToHydrate, trimToKept } from '../../utils/hydration-range';
import type { HeightTable } from '../../utils/segment-heights';

/** Height the test table gives every segment, so a scroll offset reads as a round segment index. */
const SEGMENT_PX = 100;

/** A {@link HydrationTarget} over the given band, keeping exactly the segments inside it. */
function targetOf(start: number, end: number): HydrationTarget {
  return { start, end, keeps: (index) => index >= start && index < end };
}

/** Whether `target` mounts the segment at `index`. */
function hydrates(target: HydrationTarget, index: number): boolean {
  return index >= target.start && index < target.end;
}

/** A height table laying `count` segments out at {@link SEGMENT_PX} each. */
function uniformTable(count: number): HeightTable {
  const heights = Array.from({ length: count }, () => SEGMENT_PX);
  const offsets = heights.map((_h, i) => i * SEGMENT_PX);
  offsets.push(count * SEGMENT_PX);
  return { heights, offsets, total: count * SEGMENT_PX };
}

describe('hydrationTarget', () => {
  it('hydrates the segments the viewport is showing', () => {
    // Viewport covers 250–550px, i.e. segments 2 through 5.
    const target = hydrationTarget({
      table: uniformTable(50),
      scrollTop: 250,
      viewportHeight: 300,
    });

    expect([2, 3, 4, 5].map((i) => hydrates(target, i))).toEqual([true, true, true, true]);
  });

  it('leaves the segments above and below the viewport unhydrated', () => {
    // Viewport covers 2000–2300px, i.e. segments 20 through 22.
    const target = hydrationTarget({
      table: uniformTable(50),
      scrollTop: 2000,
      viewportHeight: 300,
    });

    expect([19, 23].map((i) => hydrates(target, i))).toEqual([false, false]);
  });

  it('drops a segment only well beyond the viewport it was added in', () => {
    // Hysteresis: the drop threshold sits further out than the viewport edge, so a segment just off
    // screen is kept. Without the gap, a scroll settling across a single line would mount and
    // unmount the same segment every frame.
    const table = uniformTable(200);
    const args = { table, scrollTop: 10_000, viewportHeight: 300 };
    const { start, end } = hydrationTarget(args);

    expect(hydrationTarget(args).keeps(end)).toBe(true);
    expect(hydrationTarget(args).keeps(start - 1)).toBe(true);
  });
});

describe('rangeToHydrate', () => {
  it('hydrates the whole viewport at once from nothing', () => {
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });

    const range = rangeToHydrate(undefined, target);

    expect(range).toEqual({ start: target.start, end: target.end });
  });

  it('hydrates the whole of a target the viewport has moved on to', () => {
    const range = rangeToHydrate({ start: 10, end: 12 }, targetOf(10, 20));

    expect(range).toEqual({ start: 10, end: 20 });
  });

  it('restarts at a target that no longer overlaps, rather than spanning the gap', () => {
    // A thumb drag lands hundreds of segments away; the span flown over must never be hydrated.
    const landed = rangeToHydrate({ start: 10, end: 14 }, targetOf(400, 500));

    expect(landed).toEqual({ start: 400, end: 500 });
  });

  it('keeps a segment that has only just left the viewport', () => {
    // A segment inside the drop band stays mounted rather than being unmounted and re-mounted as
    // the scroll wavers.
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    const hydratedRun = { start: target.start - 2, end: target.end + 2 };

    expect(rangeToHydrate(hydratedRun, target)).toEqual(hydratedRun);
  });

  it('drops the segments that have passed the drop band', () => {
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    // A run reaching far above the drop band; only the part inside it survives.
    const range = rangeToHydrate({ start: 0, end: target.end }, target);

    expect(range.end).toBe(target.end);
    expect(range.start).toBeGreaterThan(0);
  });

  it('drops the segments below the drop band when the scroll moves up', () => {
    // The mirror of trimming from the top: scrolling up leaves the run's tail past the band.
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    const range = rangeToHydrate({ start: target.start, end: 200 }, target);

    expect(range.start).toBe(target.start);
    expect(range.end).toBeLessThan(200);
  });
});

describe('trimToKept', () => {
  it('keeps the segments still inside the drop band', () => {
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    const hydratedRun = { start: target.start - 2, end: target.end + 2 };

    expect(trimToKept(hydratedRun, target)).toEqual(hydratedRun);
  });

  it('has nothing to trim when no segment is hydrated yet', () => {
    expect(trimToKept(undefined, targetOf(10, 20))).toBeUndefined();
  });
});
