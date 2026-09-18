/// <reference types="jest" />

import type { HydrationTarget } from '../../utils/hydration-range';
import {
  HYDRATION_BUDGET_PER_FRAME,
  hydrationTarget,
  stepTowardTarget,
  trimToKept,
} from '../../utils/hydration-range';
import type { HeightTable } from '../../utils/segment-heights';

/** Height the test table gives every segment, so a scroll offset reads as a round segment index. */
const SEGMENT_PX = 100;

/**
 * A {@link HydrationTarget} over the given band, for the stepping tests, which care only about how a
 * range advances toward one. Its whole band is on screen, so filling the core fills the target.
 */
function targetOf(start: number, end: number): HydrationTarget {
  return { start, end, core: { start, end }, keeps: (index) => index >= start && index < end };
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
    const target = hydrationTarget({
      table: uniformTable(50),
      scrollTop: 2000,
      viewportHeight: 300,
    });

    // Beyond the hydrate margin either side — the book's start, and well past the viewport's end.
    expect([0, 5, 40, 49].map((i) => hydrates(target, i))).toEqual([false, false, false, false]);
  });

  it('hydrates a margin beyond the viewport, so a scroll meets ready content', () => {
    // Viewport covers 2000–2300px (segments 20–22). Reaching the edge must not be the first moment
    // the next segment starts rendering.
    const target = hydrationTarget({
      table: uniformTable(50),
      scrollTop: 2000,
      viewportHeight: 300,
    });

    expect(hydrates(target, 23)).toBe(true);
  });

  it('drops a segment only well beyond the band it was added in', () => {
    // Hysteresis: the drop threshold sits further out than the add one, so a segment just past the
    // edge is kept. Without the gap, a scroll jittering across a single line would mount and
    // unmount the same segment every frame.
    const table = uniformTable(200);
    const args = { table, scrollTop: 10_000, viewportHeight: 300 };
    const { start, end } = hydrationTarget(args);

    // The segment just outside the added run still counts as hydrated rather than being dropped.
    expect(hydrationTarget(args).keeps(end)).toBe(true);
    expect(hydrationTarget(args).keeps(start - 1)).toBe(true);
  });
});

describe('stepTowardTarget', () => {
  it('fills what is on screen before spending a step on the margin', () => {
    // The margin is bought ahead of the reader, so it must never be paid for while the segments
    // they are actually looking at are still plain text.
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });

    const first = stepTowardTarget(undefined, target);

    // Segments 100–102 are the ones on screen at 10000–10300px.
    expect([100, 101, 102].every((i) => i >= first.start && i < first.end)).toBe(true);
  });

  it('fills a viewport-sized target within two steps', () => {
    // Each step costs a React commit the browser must finish before painting, so a step has to
    // carry enough segments that a viewport does not visibly arrive a verse at a time.
    const target = targetOf(10, 14);

    const first = stepTowardTarget(undefined, target);
    const second = stepTowardTarget(first, target);

    expect(second).toEqual({ start: target.start, end: target.end });
  });

  it('keeps growing on each step until the target is filled', () => {
    const target = targetOf(10, 10 + HYDRATION_BUDGET_PER_FRAME * 3);
    const first = stepTowardTarget(undefined, target);
    const second = stepTowardTarget(first, target);

    expect(first.end - first.start).toBe(HYDRATION_BUDGET_PER_FRAME);
    expect(second.end - second.start).toBe(HYDRATION_BUDGET_PER_FRAME * 2);
  });

  it('stops growing once the target is reached', () => {
    const target = targetOf(10, 12);
    const filled = { start: 10, end: 12 };

    expect(stepTowardTarget(filled, target)).toEqual({ start: target.start, end: target.end });
  });

  it('restarts at a target that no longer overlaps, rather than crawling across the gap', () => {
    // A thumb drag lands hundreds of segments away; the span flown over must never be hydrated.
    const landed = stepTowardTarget({ start: 10, end: 14 }, targetOf(400, 500));

    expect(landed.start).toBe(400);
    expect(landed.end).toBe(400 + HYDRATION_BUDGET_PER_FRAME);
  });

  it('grows upward when the viewport moves back up the book', () => {
    // Scrolling up extends the target above the hydrated run, so the paced growth runs backward.
    const target = targetOf(10 - HYDRATION_BUDGET_PER_FRAME - 1, 14);
    const stepped = stepTowardTarget({ start: 10, end: 14 }, target);

    expect(stepped).toEqual({ start: 10 - HYDRATION_BUDGET_PER_FRAME, end: 14 });
  });

  it('keeps the segments still inside the drop band when trimming', () => {
    // Trimming applies the wider drop threshold, so a segment that has merely left the hydrate band
    // survives rather than being unmounted and re-mounted as the scroll wavers.
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    const hydratedRun = { start: target.start - 2, end: target.end + 2 };

    expect(trimToKept(hydratedRun, target)).toEqual(hydratedRun);
  });

  it('drops the segments that have passed the drop band', () => {
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    // A run reaching far above the drop band; only the part inside it survives.
    const trimmed = trimToKept({ start: 0, end: target.end }, target);

    expect(trimmed).toEqual({ start: expect.any(Number), end: target.end });
    expect(trimmed?.start).toBeGreaterThan(0);
  });

  it('drops the segments below the drop band when the scroll moves up', () => {
    // The mirror of trimming from the top: scrolling up leaves the run's tail past the band.
    const table = uniformTable(200);
    const target = hydrationTarget({ table, scrollTop: 10_000, viewportHeight: 300 });
    const trimmed = trimToKept({ start: target.start, end: 200 }, target);

    expect(trimmed?.start).toBe(target.start);
    expect(trimmed?.end).toBeLessThan(200);
  });

  it('shrinks immediately to a target the viewport has left, without pacing', () => {
    // De-hydrating is cheap (it unmounts elements), so there is no reason to pace it.
    const shrunk = stepTowardTarget({ start: 10, end: 20 }, targetOf(12, 15));

    expect(shrunk).toEqual({ start: 12, end: 15 });
  });
});
