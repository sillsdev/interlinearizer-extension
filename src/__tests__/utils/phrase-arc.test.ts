/** @file Unit tests for utils/phrase-arc.ts */
/// <reference types="jest" />

import {
  ARC_BASE_STEM,
  ARC_LEVEL_STEP,
  BASE_ROW_GAP_PX,
  GUTTER_MARGIN_PX,
  GUTTER_LANE_STEP,
  buildSameRowArcPath,
  buildCrossRowArcPath,
  computeAllArcPaths,
  computeStripRowGap,
  deconflictSplitButtons,
  getArcStrokeProps,
  roundedPolyline,
  splitPhraseAtBoundary,
  SPLIT_BUTTON_WIDTH_PX,
  type ArcPath,
} from '../../utils/phrase-arc';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal `DOMRect`-like plain object. jsdom's `getBoundingClientRect` returns zeroes by
 * default; we override per-element via `jest.spyOn` in each test that needs real geometry.
 *
 * @param left - Left edge in pixels.
 * @param top - Top edge in pixels.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns A plain object shaped like `DOMRect`.
 */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

/**
 * Recovers a phrase arc's nesting level from its computed path. A run line sits at `rowTop -
 * (ARC_BASE_STEM + level * ARC_LEVEL_STEP)`, so inverting `midY` against the row top yields the
 * level the leveling assigned — the public stand-in for the removed `levelByPhraseId`.
 *
 * @param paths - Computed arc paths from {@link computeAllArcPaths}.
 * @param phraseId - The phrase whose level is wanted.
 * @param rowTop - The visual top of the row the phrase's (upper) run rides above.
 * @returns The recovered nesting level, or `undefined` when the phrase has no path.
 */
function levelOf(paths: ArcPath[], phraseId: string, rowTop: number): number | undefined {
  const path = paths.find((p) => p.phraseId === phraseId);
  if (!path) return undefined;
  return (rowTop - ARC_BASE_STEM - path.midY) / ARC_LEVEL_STEP;
}

/**
 * Builds a fake scroll container element with a list of `[data-phrase-box]` children. Each child's
 * `getBoundingClientRect` is stubbed to return the provided rect. The container's own rect is fixed
 * at (0, 0) with no scroll offset.
 *
 * @param boxes - Array of `{ phraseId, rect }` describing each phrase-box child.
 * @returns The container element.
 */
function buildContainer(boxes: { phraseId: string; r: DOMRect }[]): Element {
  const container = document.createElement('div');
  jest.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 800, 600));
  Object.defineProperty(container, 'scrollLeft', { value: 0, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 0, configurable: true });

  boxes.forEach(({ phraseId, r }) => {
    const el = document.createElement('span');
    el.setAttribute('data-phrase-box', 'true');
    el.setAttribute('data-phrase-id', phraseId);
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
    container.appendChild(el);
  });

  return container;
}

// ---------------------------------------------------------------------------
// computeStripRowGap
// ---------------------------------------------------------------------------

describe('computeStripRowGap', () => {
  it('returns the base gap when there are no arcs', () => {
    expect(computeStripRowGap(false, 0, false)).toBe(BASE_ROW_GAP_PX);
    // maxArcLevel / hasRealPhrase are ignored entirely when hasArcs is false.
    expect(computeStripRowGap(false, 5, true)).toBe(BASE_ROW_GAP_PX);
  });

  it('clears the highest arc stem plus controls headroom when a real phrase is present', () => {
    const maxArcLevel = 3;
    const arcClearance = ARC_BASE_STEM + 5 + 4 + maxArcLevel * ARC_LEVEL_STEP;
    expect(computeStripRowGap(true, maxArcLevel, true)).toBe(arcClearance + 12);
  });

  it('omits the controls headroom when no real phrase is present', () => {
    const maxArcLevel = 3;
    const arcClearance = ARC_BASE_STEM + 5 + 4 + maxArcLevel * ARC_LEVEL_STEP;
    expect(computeStripRowGap(true, maxArcLevel, false)).toBe(arcClearance);
  });

  it('never drops below the base gap for shallow arcs', () => {
    // A single level-0 arc with no phrase clears far less than the base gap, so the floor applies.
    expect(computeStripRowGap(true, 0, false)).toBe(BASE_ROW_GAP_PX);
  });
});

// ---------------------------------------------------------------------------
// buildSameRowArcPath
// ---------------------------------------------------------------------------

describe('buildSameRowArcPath', () => {
  it('returns an SVG path string starting with M', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 100 };
    const { d } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('produces a non-empty path when boxes are equidistant left-to-right', () => {
    const a = { left: 0, right: 20, top: 50 };
    const b = { left: 80, right: 100, top: 50 };
    const { d } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(0);
  });

  it('handles right-to-left direction (x2 < x1)', () => {
    const a = { left: 80, right: 100, top: 50 };
    const b = { left: 0, right: 20, top: 50 };
    const { d } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('returns a midpoint within the bounds of the two boxes', () => {
    const a = { left: 0, right: 20, top: 50 };
    const b = { left: 80, right: 100, top: 50 };
    const { midX, midY } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(midX).toBeGreaterThanOrEqual(10);
    expect(midX).toBeLessThanOrEqual(90);
    expect(midY).toBeLessThan(50);
  });

  it('reports the run extent as the span between the two box centers', () => {
    const a = { left: 0, right: 20, top: 50 };
    const b = { left: 80, right: 100, top: 50 };
    const { runLeft, runRight } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(runLeft).toBe(10);
    expect(runRight).toBe(90);
  });

  it('orders the run extent left-to-right even when the later box is to the left', () => {
    const a = { left: 80, right: 100, top: 50 };
    const b = { left: 0, right: 20, top: 50 };
    const { runLeft, runRight } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(runLeft).toBe(10);
    expect(runRight).toBe(90);
  });

  it('places the horizontal run exactly one stem above the box top', () => {
    // The run line sits at `top - stem`, with the corners rounded into the stem (not added on top).
    // This matches buildCrossRowArcPath's run line at the same stem, so intra-row and inter-row arcs
    // at the same level align rather than the same-row run riding a corner-radius higher.
    const a = { left: 0, right: 20, top: 50 };
    const b = { left: 80, right: 100, top: 50 };
    const { midY } = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(midY).toBe(50 - ARC_BASE_STEM);
  });
});

// ---------------------------------------------------------------------------
// buildCrossRowArcPath
// ---------------------------------------------------------------------------

describe('buildCrossRowArcPath', () => {
  it('returns an SVG path string starting at the upper box top', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { d } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    // The path leaves box A's top (cx1=20, top=100).
    expect(d).toMatch(/^M 20 100/);
  });

  it('ends the path at the lower box top', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { d } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    // The final L lands on box B's center/top (cx2=70, top=200).
    expect(d).toMatch(/L 70 200$/);
  });

  it('runs the final horizontal section a stem above the lower box, then drops into its top', () => {
    // The run-in to the lower box must sit `stem` above b.top, so the arc meets the box from above
    // rather than grazing the box-top line. The very last segment drops into b.top.
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { d } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    // Horizontal run-in lands at y = b.top - stem before the final drop.
    expect(d).toContain(` ${200 - ARC_BASE_STEM}`);
    // Final drop lands on the lower box top (cx2=70, top=200).
    expect(d).toMatch(/L 70 200$/);
  });

  it('drops the vertical leg down the gutter x, never through the box columns', () => {
    // Gutter sits left of both boxes at x=-10. The descent from the run line down to the lower row
    // happens entirely at x=-10, so no vertical segment ever sits at the box centers (20 or 70).
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { d } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    expect(d).toContain('-10');
  });

  it('handles a gutter to the right of both boxes', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { d } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, 200);
    expect(d).toMatch(/^M 20 100/);
    expect(d).toMatch(/L 70 200$/);
    expect(d).toContain('200');
  });

  it('puts the run line one stem above the higher endpoint, regardless of which box is higher', () => {
    // Upper box at top=100, lower at top=300. The run (midY) sits stem above the higher top (100).
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 300 };
    const { midY } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    expect(midY).toBe(100 - ARC_BASE_STEM);
  });

  it('raises the run for a deeper nesting level', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 300 };
    const stem = ARC_BASE_STEM + ARC_LEVEL_STEP;
    const { midY } = buildCrossRowArcPath(a, b, stem, stem, -10);
    expect(midY).toBe(100 - stem);
  });

  it('reports the run extent from the upper box center out to the gutter', () => {
    // Upper box center cx1=20, gutter to the left at x=-10: the button rides the upper run between.
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 200 };
    const { runLeft, runRight } = buildCrossRowArcPath(a, b, ARC_BASE_STEM, ARC_BASE_STEM, -10);
    expect(runLeft).toBe(-10);
    expect(runRight).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// roundedPolyline
// ---------------------------------------------------------------------------

describe('roundedPolyline', () => {
  it('starts at the first point and ends at the last', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      5,
    );
    expect(d).toMatch(/^M 0 0/);
    expect(d).toMatch(/L 100 100$/);
  });

  it('emits one arc command per interior corner', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ],
      5,
    );
    // Two interior corners → two `A` arc commands.
    expect([...d.matchAll(/A /g)]).toHaveLength(2);
  });

  it('chooses opposite sweep flags for mirror-image turns', () => {
    // Down-then-right and down-then-left are mirror turns, so they must round with opposite sweeps.
    const right = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      5,
    );
    expect(right).toMatch(/A 5 5 0 0 0 /);
    const left = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: -100, y: 100 },
      ],
      5,
    );
    expect(left).toMatch(/A 5 5 0 0 1 /);
  });

  it('clamps the corner radius to half the shorter adjacent leg', () => {
    // The leg into the corner is only 4px long, so the radius clamps to 2 (4/2), not the 5 asked.
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 100, y: 4 },
      ],
      5,
    );
    expect(d).toMatch(/A 2 2 /);
  });
});

// ---------------------------------------------------------------------------
// computeAllArcPaths
// ---------------------------------------------------------------------------

describe('computeAllArcPaths', () => {
  it('returns empty state when the container has no phrase boxes', () => {
    const container = buildContainer([]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
    expect(maxLevel).toBe(0);
  });

  it('returns empty state when every phrase has only one box', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p2', r: rect(60, 100, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
  });

  it('produces one arc path for a phrase with two boxes in the same row', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(100, 100, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0].phraseId).toBe('p1');
    expect(levelOf(paths, 'p1', 100)).toBe(0);
  });

  it('produces one arc path for a phrase with two boxes in different rows', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 50, 40, 20) },
      { phraseId: 'p1', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0].phraseId).toBe('p1');
  });

  it('produces two arc paths for a phrase with three boxes', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(100, 100, 40, 20) },
      { phraseId: 'p1', r: rect(200, 100, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(2);
    paths.forEach((p) => expect(p.phraseId).toBe('p1'));
  });

  it('assigns level 0 to a single non-overlapping phrase', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(200, 100, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 100)).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('assigns different levels to two overlapping phrases', () => {
    // Both phrases span the same x range → they overlap → different levels.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(200, 100, 40, 20) },
      { phraseId: 'p2', r: rect(50, 100, 40, 20) },
      { phraseId: 'p2', r: rect(160, 100, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 100)).not.toBe(levelOf(paths, 'p2', 100));
    expect(maxLevel).toBe(1);
  });

  it('assigns the same level to two phrases with overlapping x-spans but on different rows', () => {
    // p1 is on row y=0 and p2 is on row y=200 — their arcs cannot cross even if x-spans overlap,
    // so both get level 0.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(200, 0, 40, 20) },
      { phraseId: 'p2', r: rect(50, 200, 40, 20) },
      { phraseId: 'p2', r: rect(160, 200, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 0)).toBe(0);
    expect(levelOf(paths, 'p2', 200)).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('does not bump a same-row arc for a cross-row arc whose runs share no row with it', () => {
    // p1 is a same-row arc on row 0 (cx 30..220). p2 is a cross-row arc from row 300 (cx 30) down to
    // row 600 (cx 30) — its two runs live on rows 300 and 600, neither of which is p1's row 0. So
    // even though their x-spans overlap, no run shares a channel and p1 keeps level 0.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(200, 0, 40, 20) },
      { phraseId: 'p2', r: rect(10, 300, 40, 20) },
      { phraseId: 'p2', r: rect(10, 600, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 0)).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('does not bump an arc nested inside a wider phrase that routes its run out the other side', () => {
    // Regression: p1 is a cross-row arc on the left of the strip (upper box cx=30) that routes down
    // the LEFT gutter, so its upper run only spans cx 30 → left edge. p2 is a cross-row arc whose
    // upper box (cx=330) sits to the RIGHT and routes down the RIGHT gutter (run spans cx 330 →
    // right edge). Their box-center spans overlap, but their actual runs occupy opposite sides of
    // row 0's channel, so they must NOT conflict — neither is bumped to level 1.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(10, 150, 40, 20) },
      { phraseId: 'p2', r: rect(310, 0, 40, 20) },
      { phraseId: 'p2', r: rect(310, 150, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 0)).toBe(0);
    expect(levelOf(paths, 'p2', 0)).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('bumps the level when a cross-row arc shares an upper row with an overlapping same-row arc', () => {
    // p1 is a same-row arc on row 0. p2 is a cross-row arc whose UPPER box is also on row 0 (going
    // down to row 150), with an overlapping x-span. Both runs sit in row 0's top channel, so they
    // conflict and must take distinct levels — this is what keeps a rerouted cross-row arc from
    // drawing on top of a same-row bracket it shares a channel with.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(200, 0, 40, 20) },
      { phraseId: 'p2', r: rect(100, 0, 40, 20) },
      { phraseId: 'p2', r: rect(100, 150, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 0)).not.toBe(levelOf(paths, 'p2', 0));
    expect(maxLevel).toBe(1);
  });

  it('uses a higher stem for higher nesting levels', () => {
    // Two overlapping phrases — the level-1 arc must rise higher (lower y-peak) than level-0.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(300, 100, 40, 20) },
      { phraseId: 'p2', r: rect(50, 100, 40, 20) },
      { phraseId: 'p2', r: rect(250, 100, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    const level0Id = paths.find((p) => levelOf(paths, p.phraseId, 100) === 0)?.phraseId;
    const level1Id = paths.find((p) => levelOf(paths, p.phraseId, 100) === 1)?.phraseId;
    expect(level0Id).toBeDefined();
    expect(level1Id).toBeDefined();

    // Extract the minimum y-coordinate from all L commands (the arc's topmost point).
    const peakY = (d: string) => {
      const ys = [...d.matchAll(/L\s+[\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]));
      return Math.min(...ys);
    };

    const l0Path = paths.find((p) => p.phraseId === level0Id);
    const l1Path = paths.find((p) => p.phraseId === level1Id);
    if (!l0Path || !l1Path) throw new Error('Expected paths for both levels');
    // Level-1 arc peaks higher (smaller y) than level-0.
    expect(peakY(l1Path.d)).toBeLessThan(peakY(l0Path.d));
  });

  it('ignores a phrase box element with no data-phrase-id attribute', () => {
    const container = buildContainer([]);
    // Add a box element with data-phrase-box but no data-phrase-id.
    const el = document.createElement('span');
    el.setAttribute('data-phrase-box', 'true');
    jest.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(10, 100, 40, 20));
    container.appendChild(el);

    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
  });

  it('routes a cross-row arc as an upward bracket: leaves the upper box top, lands on the lower box top', () => {
    // p1 spans row y=0 (top) → row y=150. The arc must start at the upper box top (y=0) and end at
    // the lower box top (y=150), rising into a channel above row 0 in between.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(1);
    // Starts at the upper box top (cx=30, top=0) and ends at the lower box top (cx=230, top=150).
    expect(paths[0].d).toMatch(/^M 30 0/);
    expect(paths[0].d).toMatch(/L 230 150$/);
    // The run sits above row 0 (negative y, one base stem up).
    expect(paths[0].midY).toBe(0 - ARC_BASE_STEM);
  });

  it('routes a cross-row arc down the left gutter when the upper box is nearer the left edge', () => {
    // Content spans x≈[10,250]. p1's upper box sits at the far left, so the vertical leg drops down
    // the LEFT gutter (just left of x=10, i.e. a negative x), never down the right side.
    const container = buildContainer([
      { phraseId: 'edge', r: rect(10, 0, 40, 20) },
      { phraseId: 'edge', r: rect(210, 0, 40, 20) },
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    const p1 = paths.find((p) => p.phraseId === 'p1');
    expect(p1).toBeDefined();
    // The vertical descent rides the left gutter x = content-left (10) minus the margin. Read the x
    // of the corner where the upper run turns down into the gutter (the SECOND rounded corner); a
    // bare substring like '0 ' would also match the box-top of the 'M 30 0 ...' start and so could
    // not distinguish left- from right-gutter routing.
    const descentX = (d: string) =>
      Number([...d.matchAll(/A [-\d.]+ [-\d.]+ 0 0 [01] ([-\d.]+) /g)][1]?.[1]);
    expect(descentX(p1?.d ?? '')).toBe(10 - GUTTER_MARGIN_PX);
    // The run midpoint sits between the upper box center (30) and the left gutter → left of 30.
    expect(p1?.midX).toBeLessThan(30);
  });

  it('routes a cross-row arc down the right gutter when the upper box is nearer the right edge', () => {
    // p1's upper box sits at the far right of the content, so the descent uses the RIGHT gutter.
    const container = buildContainer([
      { phraseId: 'edge', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    const p1 = paths.find((p) => p.phraseId === 'p1');
    expect(p1).toBeDefined();
    // Right gutter is content-right (250) plus the margin.
    expect(p1?.d).toContain(`${250 + GUTTER_MARGIN_PX}`);
    // The run midpoint sits between the upper box center (230) and the right gutter → right of 230.
    expect(p1?.midX).toBeGreaterThan(230);
  });

  it('chooses the gutter side from the average of origin and target, not the origin alone', () => {
    // An anchor box fixes the content to x≈[0,650]. p1's upper box sits left of center (cx=300) and
    // its target is far right (cx=630); the average (465) is nearer the RIGHT edge, so even though
    // the origin alone is past center it routes down the RIGHT gutter from the averaged midpoint.
    const container = buildContainer([
      { phraseId: 'anchor', r: rect(0, 0, 10, 20) },
      { phraseId: 'anchor', r: rect(200, 0, 10, 20) },
      { phraseId: 'p1', r: rect(280, 0, 40, 20) },
      { phraseId: 'p1', r: rect(610, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    const p1 = paths.find((p) => p.phraseId === 'p1');
    // Right gutter is content-right (650) plus the level-0 margin.
    expect(p1?.d).toContain(`${650 + GUTTER_MARGIN_PX}`);
    // The split-button midpoint rides the run between the upper box center (300) and the gutter.
    expect(p1?.midX).toBeGreaterThan(300);
  });

  it('steps stacked same-side gutter lanes outward by level so descents stay spaced', () => {
    // A far-right anchor pushes content-right out to 900 so both arcs' averages sit nearer the LEFT
    // and route down the left gutter. They conflict (share upper row 0, overlapping x) → distinct
    // levels → distinct gutter lanes one GUTTER_LANE_STEP apart, so their descents don't coincide.
    const container = buildContainer([
      { phraseId: 'anchor', r: rect(880, 0, 20, 20) },
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 150, 40, 20) },
      { phraseId: 'p2', r: rect(30, 0, 40, 20) },
      { phraseId: 'p2', r: rect(120, 150, 40, 20) },
    ]);
    const { paths, leftPadding } = computeAllArcPaths(container);
    // The long vertical descent runs at the gutter x down into the lower row (y > 100). Left content
    // edge is 10, so the level-0 lane sits at 10 - margin and level-1 at 10 - (margin + lane step).
    const p1p2 = paths.filter((p) => p.phraseId !== 'anchor');
    const descentX = (d: string) => Number(/L ([-\d.]+) 1\d\d/.exec(d)?.[1]);
    expect(new Set(p1p2.map((p) => descentX(p.d)))).toEqual(
      new Set([10 - GUTTER_MARGIN_PX, 10 - (GUTTER_MARGIN_PX + GUTTER_LANE_STEP)]),
    );
    // Padding reserves the outermost (level-1) lane: margin + one lane step.
    expect(leftPadding).toBe(GUTTER_MARGIN_PX + GUTTER_LANE_STEP);
  });

  it('separates the gutter lanes of two cross-row arcs whose vertical descents nest', () => {
    // Regression: AF spans rows 0 → 3 down the LEFT gutter; CD spans rows 1 → 2, nesting inside
    // AF's vertical extent, also down the LEFT gutter. Their horizontal runs share no row (A on
    // row 0, F on row 3; C on row 1, D on row 2), so the per-row segment levels are all 0 and never
    // separate them. Only the vertical gutter-lane assignment can: the two descents overlap on the
    // left side, so they must take distinct lanes one GUTTER_LANE_STEP apart instead of coinciding.
    // A far-right anchor keeps both arcs' averages nearer the left edge.
    const container = buildContainer([
      { phraseId: 'anchor', r: rect(880, 0, 20, 20) },
      { phraseId: 'af', r: rect(10, 0, 40, 20) },
      { phraseId: 'af', r: rect(60, 300, 40, 20) },
      { phraseId: 'cd', r: rect(30, 100, 40, 20) },
      { phraseId: 'cd', r: rect(50, 200, 40, 20) },
    ]);
    const { paths, leftPadding } = computeAllArcPaths(container);
    // Each descent's vertical x is the first L after the upper run turns toward the gutter.
    // The gutter descent's x is the endpoint x of the SECOND rounded corner (where the upper run
    // turns down into the gutter); the first corner is the box-top → run turn.
    const descentX = (d: string) =>
      Number([...d.matchAll(/A [-\d.]+ [-\d.]+ 0 0 [01] ([-\d.]+) /g)][1]?.[1]);
    const af = descentX(paths.find((p) => p.phraseId === 'af')?.d ?? '');
    const cd = descentX(paths.find((p) => p.phraseId === 'cd')?.d ?? '');
    expect(af).not.toBe(cd);
    expect(new Set([af, cd])).toEqual(
      new Set([10 - GUTTER_MARGIN_PX, 10 - (GUTTER_MARGIN_PX + GUTTER_LANE_STEP)]),
    );
    // Padding reserves the outermost (lane-1) descent.
    expect(leftPadding).toBe(GUTTER_MARGIN_PX + GUTTER_LANE_STEP);
  });

  it('reuses one gutter lane for two cross-row arcs whose descents do not vertically overlap', () => {
    // AB descends rows 0 → 1 (y ≈ 0..100); CD descends rows 2 → 3 (y ≈ 200..300). Both route down
    // the LEFT gutter but their vertical spans are disjoint, so they share lane 0 — the lane
    // assignment only pushes outward when descents actually overlap.
    const container = buildContainer([
      { phraseId: 'anchor', r: rect(880, 0, 20, 20) },
      { phraseId: 'ab', r: rect(10, 0, 40, 20) },
      { phraseId: 'ab', r: rect(60, 100, 40, 20) },
      { phraseId: 'cd', r: rect(30, 200, 40, 20) },
      { phraseId: 'cd', r: rect(50, 300, 40, 20) },
    ]);
    const { paths, leftPadding } = computeAllArcPaths(container);
    // The gutter descent's x is the endpoint x of the SECOND rounded corner (where the upper run
    // turns down into the gutter); the first corner is the box-top → run turn.
    const descentX = (d: string) =>
      Number([...d.matchAll(/A [-\d.]+ [-\d.]+ 0 0 [01] ([-\d.]+) /g)][1]?.[1]);
    const ab = descentX(paths.find((p) => p.phraseId === 'ab')?.d ?? '');
    const cd = descentX(paths.find((p) => p.phraseId === 'cd')?.d ?? '');
    expect(ab).toBe(cd);
    expect(ab).toBe(10 - GUTTER_MARGIN_PX);
    expect(leftPadding).toBe(GUTTER_MARGIN_PX);
  });

  it('does not separate cross-row descents that overlap vertically but route down opposite gutters', () => {
    // AF descends down the LEFT gutter (rows 0 → 3); GH descends down the RIGHT gutter over an
    // overlapping vertical span. Opposite sides never conflict, so each keeps lane 0.
    const container = buildContainer([
      { phraseId: 'af', r: rect(10, 0, 40, 20) },
      { phraseId: 'af', r: rect(30, 300, 40, 20) },
      { phraseId: 'gh', r: rect(560, 100, 40, 20) },
      { phraseId: 'gh', r: rect(580, 200, 40, 20) },
    ]);
    const { paths, leftPadding, rightPadding } = computeAllArcPaths(container);
    // Content edges: left = 10, right = 620 (gh box at 580 + width 40). Each arc sits at the
    // level-0 lane on its own side.
    // The gutter descent's x is the endpoint x of the SECOND rounded corner (where the upper run
    // turns down into the gutter); the first corner is the box-top → run turn.
    const descentX = (d: string) =>
      Number([...d.matchAll(/A [-\d.]+ [-\d.]+ 0 0 [01] ([-\d.]+) /g)][1]?.[1]);
    expect(descentX(paths.find((p) => p.phraseId === 'af')?.d ?? '')).toBe(10 - GUTTER_MARGIN_PX);
    expect(descentX(paths.find((p) => p.phraseId === 'gh')?.d ?? '')).toBe(620 + GUTTER_MARGIN_PX);
    expect(leftPadding).toBe(GUTTER_MARGIN_PX);
    expect(rightPadding).toBe(GUTTER_MARGIN_PX);
  });

  it('reports zero side padding when there are no cross-row arcs', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(200, 100, 40, 20) },
    ]);
    const { leftPadding, rightPadding } = computeAllArcPaths(container);
    expect(leftPadding).toBe(0);
    expect(rightPadding).toBe(0);
  });

  it('anchors a cross-row arc endpoint at the row top line, not its own (taller/shorter) box top', () => {
    // p1's lower box top is y=150, but a sibling on the same row sits slightly higher at y=148. The
    // endpoint must anchor at the row's highest top (148) so every box on the row shares one line,
    // not at the box's own top. Covers rowTopFor picking up a higher same-row box.
    const container = buildContainer([
      { phraseId: 'high', r: rect(400, 148, 40, 22) },
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    const p1 = paths.find((p) => p.phraseId === 'p1');
    expect(p1).toBeDefined();
    // The path lands on the row top line y=148 (higher sibling top), not the box's own y=150.
    expect(p1?.d).toMatch(/L 120 148$/);
  });

  it('gives two cross-row arcs sharing an upper row distinct run heights when their x-spans overlap', () => {
    // p1 (cx 30→230) and p2 (cx 230→30) both have their upper box on row 0, so both runs sit in row
    // 0's top channel and their x-spans overlap → distinct levels → distinct (more negative) midY.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
      { phraseId: 'p2', r: rect(210, 0, 40, 20) },
      { phraseId: 'p2', r: rect(10, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(2);
    const [midY0, midY1] = paths.map((p) => p.midY);
    expect(midY0).not.toBe(midY1);
  });

  it('keeps cross-row arc runs above the strip (negative y) for every nesting level', () => {
    // Three mutually-overlapping cross-row arcs sharing upper row 0 force levels 0–2. Every run must
    // sit above the row top (y < 0), confirming they all route up into the top channel rather than
    // down through the gap. Deeper levels rise further (more negative).
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
      { phraseId: 'p2', r: rect(210, 0, 40, 20) },
      { phraseId: 'p2', r: rect(10, 150, 40, 20) },
      { phraseId: 'p3', r: rect(100, 0, 40, 20) },
      { phraseId: 'p3', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(3);
    paths.forEach((p) => expect(p.midY).toBeLessThan(0));
    expect(new Set(paths.map((p) => p.midY)).size).toBe(3);
  });

  it("levels a cross-row arc's lower run independently of its upper run", () => {
    // Two cross-row arcs both route down the LEFT gutter and share lower row 300, but sit on
    // DIFFERENT upper rows (0 and 150) so their upper runs never conflict — each upper run is alone
    // on its row at level 0. Their lower runs both reach the left gutter on row 300 and overlap, so
    // they take distinct levels (0 and 1). p1's lower run is the wider one, so it is bumped to level
    // 1 while p1's own upper run stays at level 0 — proving the bottom horizontal levels on its own
    // row, not its arc's upper run. A far-right box pulls the content center right so both midpoints
    // count as nearer-left.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(90, 0, 20, 20) },
      { phraseId: 'p1', r: rect(190, 300, 20, 20) },
      { phraseId: 'q', r: rect(90, 150, 20, 20) },
      { phraseId: 'q', r: rect(50, 300, 20, 20) },
      { phraseId: 'far', r: rect(590, 0, 20, 20) },
    ]);
    const p1 = computeAllArcPaths(container).paths.find((p) => p.phraseId === 'p1');
    expect(p1).toBeDefined();
    // Upper run rides one base stem above row 0 (level 0): midY = 0 - ARC_BASE_STEM.
    expect(p1?.midY).toBe(0 - ARC_BASE_STEM);
    // Lower run rides one level deeper above row 300 (level 1): y = 300 - (base + one level step).
    expect(p1?.d).toContain(` ${300 - (ARC_BASE_STEM + ARC_LEVEL_STEP)}`);
  });

  it('anchors a cross-row arc run in the channel of whichever endpoint is higher', () => {
    // The lower box is on row 300, but the arc's run must sit above the HIGHER endpoint (row 0), one
    // base stem up — never down by the lower box. Independent of how far apart the rows are.
    const near = buildContainer([
      { phraseId: 'p1', r: rect(100, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 300, 40, 20) },
    ]);
    const far = buildContainer([
      { phraseId: 'p1', r: rect(100, 0, 40, 20) },
      { phraseId: 'p1', r: rect(100, 600, 40, 20) },
    ]);
    const nearP1 = computeAllArcPaths(near).paths.find((p) => p.phraseId === 'p1');
    const farP1 = computeAllArcPaths(far).paths.find((p) => p.phraseId === 'p1');
    expect(nearP1?.midY).toBe(0 - ARC_BASE_STEM);
    expect(farP1?.midY).toBe(nearP1?.midY);
  });

  it('breaks same-row level ties by right edge when two segments share a left edge', () => {
    // Two same-row phrases whose arcs start at the same left-center x (cx1=30) but end at different
    // right edges. They overlap, so they take different levels; the sort tie-breaker on the right
    // edge orders them deterministically left-to-right.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(100, 100, 40, 20) },
      { phraseId: 'p2', r: rect(10, 100, 40, 20) },
      { phraseId: 'p2', r: rect(300, 100, 40, 20) },
    ]);
    const { paths, maxLevel } = computeAllArcPaths(container);
    expect(levelOf(paths, 'p1', 100)).not.toBe(levelOf(paths, 'p2', 100));
    expect(maxLevel).toBe(1);
  });

  it('raises maxLevel when two cross-row arcs share an upper row and overlap', () => {
    // Single arc → maxLevel 0. Overlapping pair sharing upper row 0 → maxLevel 1, which drives the
    // extra top padding the strip now reserves instead of an inter-row gap.
    const single = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
    ]);
    const overlapping = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
      { phraseId: 'p2', r: rect(210, 0, 40, 20) },
      { phraseId: 'p2', r: rect(10, 150, 40, 20) },
    ]);
    expect(computeAllArcPaths(single).maxLevel).toBe(0);
    expect(computeAllArcPaths(overlapping).maxLevel).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getArcStrokeProps
// ---------------------------------------------------------------------------

describe('getArcStrokeProps', () => {
  const dimmed = { stroke: 'var(--border)', strokeOpacity: 1, strokeWidth: 2 };
  const hovered = { stroke: 'var(--foreground)', strokeOpacity: 0.55, strokeWidth: 2 };
  const highlighted = { stroke: 'var(--foreground)', strokeOpacity: 0.6, strokeWidth: 2 };
  const destructive = {
    stroke: 'var(--destructive)',
    strokeOpacity: 1,
    strokeWidth: 2,
  };

  it('dims arcs that are neither hovered nor focused in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', undefined, undefined)).toEqual(dimmed);
  });

  it('uses mid-level white for the hovered phrase arc in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', 'p1', undefined)).toEqual(hovered);
  });

  it('uses foreground at 60% opacity for the focused phrase arc in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', undefined, 'p1')).toEqual(highlighted);
  });

  it('uses foreground at 60% opacity for the focused phrase even when it is also hovered', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', 'p1', 'p1')).toEqual(highlighted);
  });

  it('uses foreground at 60% opacity for the edited phrase arc in edit mode regardless of hover', () => {
    expect(
      getArcStrokeProps(
        { kind: 'edit', phraseId: 'p1', originalTokens: [] },
        'p1',
        undefined,
        undefined,
      ),
    ).toEqual(highlighted);
  });

  it('dims non-target arcs in edit mode even when hovered', () => {
    expect(
      getArcStrokeProps({ kind: 'edit', phraseId: 'p1', originalTokens: [] }, 'p2', 'p2', 'p2'),
    ).toEqual(dimmed);
  });

  it('uses destructive color for the target arc in confirm-unlink mode', () => {
    expect(
      getArcStrokeProps({ kind: 'confirm-unlink', phraseId: 'p1' }, 'p1', undefined, undefined),
    ).toEqual(destructive);
  });

  it('dims non-target arcs in confirm-unlink mode even when hovered', () => {
    expect(getArcStrokeProps({ kind: 'confirm-unlink', phraseId: 'p1' }, 'p2', 'p2', 'p2')).toEqual(
      dimmed,
    );
  });
});

// ---------------------------------------------------------------------------
// splitPhraseAtBoundary
// ---------------------------------------------------------------------------

describe('splitPhraseAtBoundary', () => {
  it('no-ops when splitAfterTokenRef is not found in the phrase', () => {
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(makePhraseLink('p1', ['tok-a', 'tok-b']), 'nonexistent', dispatch);
    expect(dispatch.deletePhrase).not.toHaveBeenCalled();
    expect(dispatch.updatePhrase).not.toHaveBeenCalled();
    expect(dispatch.createPhrase).not.toHaveBeenCalled();
  });

  it('no-ops when splitAfterTokenRef is the last token in document order', () => {
    // Splitting after the last token would leave the phrase unchanged (before = all tokens, after =
    // empty); the function must not dispatch a redundant update. tok-c is last by document order.
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(
      makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']),
      'tok-c',
      dispatch,
      new Map([
        ['tok-a', 0],
        ['tok-b', 1],
        ['tok-c', 2],
      ]),
    );
    expect(dispatch.deletePhrase).not.toHaveBeenCalled();
    expect(dispatch.updatePhrase).not.toHaveBeenCalled();
    expect(dispatch.createPhrase).not.toHaveBeenCalled();
  });

  it('deletes the phrase when both halves would have exactly 1 token', () => {
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(makePhraseLink('p1', ['tok-a', 'tok-b']), 'tok-a', dispatch);
    expect(dispatch.deletePhrase).toHaveBeenCalledWith('p1');
    expect(dispatch.updatePhrase).not.toHaveBeenCalled();
    expect(dispatch.createPhrase).not.toHaveBeenCalled();
  });

  it('updates and creates when both halves have ≥ 2 tokens', () => {
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(
      makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']),
      'tok-b',
      dispatch,
      new Map([
        ['tok-a', 0],
        ['tok-b', 1],
        ['tok-c', 2],
        ['tok-d', 3],
      ]),
    );
    expect(dispatch.updatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
    expect(dispatch.createPhrase).toHaveBeenCalledWith([
      { tokenRef: 'tok-c', surfaceText: 'tok-c' },
      { tokenRef: 'tok-d', surfaceText: 'tok-d' },
    ]);
    expect(dispatch.deletePhrase).not.toHaveBeenCalled();
  });

  it('updates with the "after" half when before has 1 token and after has ≥ 2', () => {
    // Splitting after tok-a leaves before=[tok-a] (length 1) and after=[tok-b,tok-c] (length 2).
    // The phrase keeps the longer half (after), and tok-a is freed (no separate call).
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(
      makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']),
      'tok-a',
      dispatch,
      new Map([
        ['tok-a', 0],
        ['tok-b', 1],
        ['tok-c', 2],
      ]),
    );
    expect(dispatch.updatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
      { tokenRef: 'tok-c', surfaceText: 'tok-c' },
    ]);
    expect(dispatch.createPhrase).not.toHaveBeenCalled();
    expect(dispatch.deletePhrase).not.toHaveBeenCalled();
  });

  it('updates with the "before" half when after has 1 token and before has ≥ 2', () => {
    // Splitting after tok-b leaves before=[tok-a,tok-b] (length 2) and after=[tok-c] (length 1).
    const dispatch = { createPhrase: jest.fn(), updatePhrase: jest.fn(), deletePhrase: jest.fn() };
    splitPhraseAtBoundary(
      makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']),
      'tok-b',
      dispatch,
      new Map([
        ['tok-a', 0],
        ['tok-b', 1],
        ['tok-c', 2],
      ]),
    );
    expect(dispatch.updatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
    expect(dispatch.createPhrase).not.toHaveBeenCalled();
    expect(dispatch.deletePhrase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deconflictSplitButtons
// ---------------------------------------------------------------------------

describe('deconflictSplitButtons', () => {
  /**
   * Builds an `ArcPath` whose button position and run extent are the only fields that matter to
   * {@link deconflictSplitButtons}; `d`/`phraseId`/`splitAfterTokenRef` are placeholders.
   *
   * @param midX - Button x center.
   * @param midY - Button y (channel line).
   * @param runLeft - Left bound of the arc run.
   * @param runRight - Right bound of the arc run.
   * @param phraseId - Phrase id (defaults unique-ish per call site via the caller).
   * @returns A populated `ArcPath`.
   */
  function path(
    midX: number,
    midY: number,
    runLeft: number,
    runRight: number,
    phraseId = 'p',
  ): ArcPath {
    return { phraseId, d: 'M0 0', midX, midY, runLeft, runRight, splitAfterTokenRef: 'tok' };
  }

  it('leaves buttons untouched when they are far enough apart horizontally', () => {
    const paths = [path(0, 10, -50, 50, 'a'), path(SPLIT_BUTTON_WIDTH_PX + 5, 10, 0, 100, 'b')];
    const before = paths.map((p) => p.midX);
    deconflictSplitButtons(paths);
    expect(paths.map((p) => p.midX)).toEqual(before);
  });

  it('leaves overlapping buttons untouched when their boxes clear each other vertically', () => {
    // Same midX but midY differs by more than the button height → no vertical box overlap, so even
    // identical x cannot make the boxes collide.
    const paths = [path(50, 0, 0, 100, 'a'), path(50, 30, 0, 100, 'b')];
    const before = paths.map((p) => p.midX);
    deconflictSplitButtons(paths);
    expect(paths.map((p) => p.midX)).toEqual(before);
  });

  it('shifts buttons whose y differs slightly but whose boxes still overlap vertically', () => {
    // The reported case: midY only 6px apart (< button height) and near-identical x, so the boxes
    // still overlap and one must move.
    const longRun = path(50, 0, 0, 200, 'a');
    const shortRun = path(52, 6, 45, 55, 'b');
    deconflictSplitButtons([longRun, shortRun]);
    expect(shortRun.midX).toBe(52);
    expect(longRun.midX).toBeLessThan(50);
  });

  it('shifts the button on the longer run, leaving the short-run button in place', () => {
    // Both at midX=50 on the same channel. `a` has the longer run, so it moves; `b` stays put.
    const longRun = path(50, 10, 0, 200, 'a');
    const shortRun = path(50, 10, 45, 55, 'b');
    const paths = [longRun, shortRun];
    deconflictSplitButtons(paths);
    expect(shortRun.midX).toBe(50);
    expect(longRun.midX).not.toBe(50);
    // The mover is pushed fully clear by the overlap (whole button width, since centers coincided).
    expect(Math.abs(longRun.midX - shortRun.midX)).toBeGreaterThanOrEqual(SPLIT_BUTTON_WIDTH_PX);
  });

  it('pushes the mover left when it sits to the left of the other button', () => {
    const mover = path(48, 10, 0, 200, 'a');
    const other = path(52, 10, 45, 55, 'b');
    deconflictSplitButtons([mover, other]);
    expect(mover.midX).toBeLessThan(48);
    expect(other.midX).toBe(52);
  });

  it('clamps the shift to the run bounds rather than pushing the button off its arc', () => {
    // The longer run still has a tight right bound; pushing right is clamped to runRight.
    const mover = path(50, 10, 40, 60, 'a');
    const other = path(52, 10, 45, 55, 'b');
    deconflictSplitButtons([mover, other]);
    // `a` is wider (20) than `b` (10), so `a` moves; it sits left of `b`, so it pushes left to 40.
    expect(mover.midX).toBe(40);
  });

  it('moves the second button when it owns the longer run', () => {
    const shortRun = path(50, 10, 45, 55, 'a');
    const longRun = path(54, 10, 0, 200, 'b');
    deconflictSplitButtons([shortRun, longRun]);
    expect(shortRun.midX).toBe(50);
    expect(longRun.midX).toBeGreaterThan(54);
  });
});
