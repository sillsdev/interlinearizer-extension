/** @file Unit tests for utils/phrase-arc.ts */
/// <reference types="jest" />

import {
  ARC_BASE_STEM,
  CROSS_ROW_ARC_CLEARANCE,
  buildSameRowArcPath,
  buildCrossRowArcPath,
  computeAllArcPaths,
  getArcStrokeProps,
  splitPhraseAtBoundary,
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
});

// ---------------------------------------------------------------------------
// buildCrossRowArcPath
// ---------------------------------------------------------------------------

describe('buildCrossRowArcPath', () => {
  it('returns an SVG path string starting with M', () => {
    const a = { left: 10, right: 30, bottom: 50 };
    const b = { left: 60, right: 80, top: 100 };
    const { d } = buildCrossRowArcPath(a, b);
    expect(d).toMatch(/^M /);
  });

  it('handles right-to-left direction', () => {
    const a = { left: 80, right: 100, bottom: 50 };
    const b = { left: 0, right: 20, top: 100 };
    const { d } = buildCrossRowArcPath(a, b);
    expect(d).toMatch(/^M /);
  });

  it('handles nearly-aligned boxes that trigger the nudge calculation', () => {
    // boxes so close horizontally that 2*r > |cx2 - cx1|, forcing nudge > 0
    const a = { left: 40, right: 60, bottom: 50 };
    const b = { left: 41, right: 61, top: 100 };
    const { d } = buildCrossRowArcPath(a, b);
    expect(d).toMatch(/^M /);
  });

  it('places the horizontal mid-section at the vertical centre of the gap between boxes', () => {
    const a = { left: 10, right: 30, bottom: 60 };
    const b = { left: 60, right: 80, top: 100 };
    const { midY } = buildCrossRowArcPath(a, b);
    expect(midY).toBe((60 + 100) / 2);
  });
});

// ---------------------------------------------------------------------------
// computeAllArcPaths
// ---------------------------------------------------------------------------

describe('computeAllArcPaths', () => {
  it('returns empty state when the container has no phrase boxes', () => {
    const container = buildContainer([]);
    const { paths, levelByPhraseId, maxLevel, requiredRowGapPx } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
    expect(levelByPhraseId.size).toBe(0);
    expect(maxLevel).toBe(0);
    expect(requiredRowGapPx).toBe(0);
  });

  it('returns empty state when every phrase has only one box', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p2', r: rect(60, 100, 40, 20) },
    ]);
    const { paths, levelByPhraseId } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
    expect(levelByPhraseId.size).toBe(0);
  });

  it('produces one arc path for a phrase with two boxes in the same row', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(100, 100, 40, 20) },
    ]);
    const { paths, levelByPhraseId } = computeAllArcPaths(container);
    expect(paths).toHaveLength(1);
    expect(paths[0].phraseId).toBe('p1');
    expect(levelByPhraseId.get('p1')).toBe(0);
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
    const { levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    expect(levelByPhraseId.get('p1')).toBe(0);
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
    const { levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    const l1 = levelByPhraseId.get('p1') ?? -1;
    const l2 = levelByPhraseId.get('p2') ?? -1;
    expect(l1).not.toBe(l2);
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
    const { levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    expect(levelByPhraseId.get('p1')).toBe(0);
    expect(levelByPhraseId.get('p2')).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('does not bump a same-row arc level for a cross-row arc whose bounding box overlaps it', () => {
    // p1 is a same-row arc on the lower row (y=150). p2 is a cross-row arc spanning y=0→y=150
    // whose x-span overlaps p1's. The cross-row arc is routed through the gap and never draws an
    // upward bracket on the lower row, so it must NOT push p1's level (and stem height) up.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 150, 40, 20) },
      { phraseId: 'p1', r: rect(200, 150, 40, 20) },
      { phraseId: 'p2', r: rect(100, 0, 40, 20) },
      { phraseId: 'p2', r: rect(100, 150, 40, 20) },
    ]);
    const { levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    expect(levelByPhraseId.get('p1')).toBe(0);
    expect(maxLevel).toBe(0);
  });

  it('uses a higher stem for higher nesting levels', () => {
    // Two overlapping phrases — the level-1 arc must rise higher (lower y-peak) than level-0.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(300, 100, 40, 20) },
      { phraseId: 'p2', r: rect(50, 100, 40, 20) },
      { phraseId: 'p2', r: rect(250, 100, 40, 20) },
    ]);
    const { paths, levelByPhraseId } = computeAllArcPaths(container);
    const level0Id = [...levelByPhraseId.entries()].find(([, v]) => v === 0)?.[0];
    const level1Id = [...levelByPhraseId.entries()].find(([, v]) => v === 1)?.[0];
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

  it('returns requiredRowGapPx of 0 when all arcs are same-row', () => {
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 100, 40, 20) },
      { phraseId: 'p1', r: rect(100, 100, 40, 20) },
    ]);
    const { requiredRowGapPx } = computeAllArcPaths(container);
    expect(requiredRowGapPx).toBe(0);
  });

  it('returns a positive requiredRowGapPx for a single cross-row arc', () => {
    // p1 has one box on row y=0 and another on row y=150 — a cross-row arc.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, 20) },
      { phraseId: 'p1', r: rect(10, 150, 40, 20) },
    ]);
    const { requiredRowGapPx } = computeAllArcPaths(container);
    // One arc at level 0: a CLEARANCE margin above the arc plus a CLEARANCE separation slot below it
    // (no lower-row arcs here) = 2*CLEARANCE.
    expect(requiredRowGapPx).toBe(2 * CROSS_ROW_ARC_CLEARANCE);
  });

  it('produces different midY values for two cross-row arcs with overlapping x-spans in the same gap', () => {
    // p1 goes left→right (cx path 30→230) and p2 goes right→left (cx path 230→30) — their center
    // paths both span 30–230 and therefore conflict in the same gap.
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

  it('produces the same midY for two cross-row arcs whose x-spans do not overlap', () => {
    // p1 crosses entirely on the left (cx: 10→10) and p2 on the right (cx: 200→200) — no overlap.
    const container = buildContainer([
      { phraseId: 'p1', r: rect(0, 0, 20, 20) },
      { phraseId: 'p1', r: rect(0, 150, 20, 20) },
      { phraseId: 'p2', r: rect(190, 0, 20, 20) },
      { phraseId: 'p2', r: rect(190, 150, 20, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(2);
    const [midY0, midY1] = paths.map((p) => p.midY);
    expect(midY0).toBe(midY1);
  });

  it('produces a distinct midY for the third overlapping cross-row arc (even level)', () => {
    // Three mutually-overlapping cross-row arcs in the same gap force levels 0, 1, and 2.
    // Level 2 is even, triggering the negative-offset branch (offset = -(level/2)*CLEARANCE).
    // All three arcs share the x-range 30–230 so they all overlap with each other.
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
    const midYs = paths.map((p) => p.midY);
    // All three arcs must have distinct midY values.
    expect(new Set(midYs).size).toBe(3);
  });

  it('caps cross-row arc midY above same-row arcs protruding from the lower row', () => {
    // p1 has a same-row arc on the lower row (y=150), which populates maxLevelByRowTop for that
    // row. p2 has a cross-row arc whose lower box is also on y=150, so lowerRowMaxLevel >= 0 and
    // the true branch of the lowerRowProtrusion ternary is exercised.
    const container = buildContainer([
      // p1: two boxes on the lower row → same-row arc, sets maxLevelByRowTop[150]
      { phraseId: 'p1', r: rect(200, 150, 40, 20) },
      { phraseId: 'p1', r: rect(300, 150, 40, 20) },
      // p2: cross-row arc landing on the same lower row
      { phraseId: 'p2', r: rect(10, 0, 40, 20) },
      { phraseId: 'p2', r: rect(10, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    // p2's cross-row arc must still be produced and routed below its origin box; the lower-row
    // protrusion only widens the reserved gap, it never suppresses or clamps the arc.
    const p2 = paths.find((p) => p.phraseId === 'p2');
    expect(p2).toBeDefined();
    expect(p2?.midY).toBeGreaterThan(20);
  });

  it('keeps every cross-row arc midY below the bottom of its upper box', () => {
    // Three mutually-overlapping cross-row arcs force levels 0–2 in one gap. The arc's horizontal
    // segment must dip below the upper box bottom (y=20) for all of them, otherwise the arc renders
    // above its own origin. Regression guard for upward-stacking that crossed the origin box.
    const upperBottom = 20;
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, upperBottom) },
      { phraseId: 'p1', r: rect(210, 150, 40, 20) },
      { phraseId: 'p2', r: rect(210, 0, 40, upperBottom) },
      { phraseId: 'p2', r: rect(10, 150, 40, 20) },
      { phraseId: 'p3', r: rect(100, 0, 40, upperBottom) },
      { phraseId: 'p3', r: rect(100, 150, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(3);
    paths.forEach((p) => expect(p.midY).toBeGreaterThan(upperBottom));
  });

  it('keeps overlapping cross-row arcs distinct and below their origins even in a tight gap', () => {
    // Rows only 10px apart (upper bottom y=20, lower top y=30) — far tighter than requiredRowGapPx
    // will eventually reserve. Two overlapping arcs must still get distinct midY (no clamp
    // collapsing them onto each other) and both must sit below the upper box bottom.
    const upperBottom = 20;
    const container = buildContainer([
      { phraseId: 'p1', r: rect(10, 0, 40, upperBottom) },
      { phraseId: 'p1', r: rect(210, 30, 40, 20) },
      { phraseId: 'p2', r: rect(210, 0, 40, upperBottom) },
      { phraseId: 'p2', r: rect(10, 30, 40, 20) },
    ]);
    const { paths } = computeAllArcPaths(container);
    expect(paths).toHaveLength(2);
    const [midY0, midY1] = paths.map((p) => p.midY);
    expect(midY0).not.toBe(midY1);
    paths.forEach((p) => expect(p.midY).toBeGreaterThan(upperBottom));
  });

  it('increases requiredRowGapPx for two overlapping cross-row arcs vs one', () => {
    // Single arc: p1 left→right. Overlapping: p1 left→right + p2 right→left (same x-span).
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
    const { requiredRowGapPx: gapSingle } = computeAllArcPaths(single);
    const { requiredRowGapPx: gapOverlapping } = computeAllArcPaths(overlapping);
    expect(gapOverlapping).toBeGreaterThan(gapSingle);
  });
});

// ---------------------------------------------------------------------------
// getArcStrokeProps
// ---------------------------------------------------------------------------

describe('getArcStrokeProps', () => {
  const dimmed = { stroke: 'var(--border)', strokeOpacity: 0.5, strokeWidth: 2 };
  const hovered = { stroke: 'white', strokeOpacity: 0.55, strokeWidth: 2 };
  const highlighted = { stroke: 'white', strokeOpacity: 1, strokeWidth: 2 };
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

  it('uses full white for the focused phrase arc in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', undefined, 'p1')).toEqual(highlighted);
  });

  it('uses full white for the focused phrase even when it is also hovered', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', 'p1', 'p1')).toEqual(highlighted);
  });

  it('whitens the edited phrase arc in edit mode regardless of hover', () => {
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
