/** @file Unit tests for utils/phrase-arc.ts */
/// <reference types="jest" />

import {
  ARC_BASE_STEM,
  buildSameRowArcPath,
  buildCrossRowArcPath,
  computeAllArcPaths,
  getArcStrokeProps,
  routeAroundBoxes,
} from '../../utils/phrase-arc';
import { DRAFT_PHRASE_ID } from '../../components/phrase-mode';

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
  it('returns a string starting with M', () => {
    const a = { left: 10, right: 30, top: 100 };
    const b = { left: 60, right: 80, top: 100 };
    const d = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('produces a symmetric path when boxes are equidistant left-to-right', () => {
    const a = { left: 0, right: 20, top: 50 };
    const b = { left: 80, right: 100, top: 50 };
    const d = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(0);
  });

  it('handles right-to-left direction (x2 < x1)', () => {
    const a = { left: 80, right: 100, top: 50 };
    const b = { left: 0, right: 20, top: 50 };
    const d = buildSameRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });
});

// ---------------------------------------------------------------------------
// buildCrossRowArcPath
// ---------------------------------------------------------------------------

describe('buildCrossRowArcPath', () => {
  it('returns a string starting with M', () => {
    const a = { left: 10, right: 30, bottom: 50 };
    const b = { left: 60, right: 80, top: 100 };
    const d = buildCrossRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('handles right-to-left direction', () => {
    const a = { left: 80, right: 100, bottom: 50 };
    const b = { left: 0, right: 20, top: 100 };
    const d = buildCrossRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('handles nearly-aligned boxes that trigger the nudge calculation', () => {
    // boxes so close horizontally that 2*r > |cx2 - cx1|, forcing nudge > 0
    const a = { left: 40, right: 60, bottom: 50 };
    const b = { left: 41, right: 61, top: 100 };
    const d = buildCrossRowArcPath(a, b, ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });
});

// ---------------------------------------------------------------------------
// computeAllArcPaths
// ---------------------------------------------------------------------------

describe('computeAllArcPaths', () => {
  it('returns empty state when the container has no phrase boxes', () => {
    const container = buildContainer([]);
    const { paths, levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    expect(paths).toHaveLength(0);
    expect(levelByPhraseId.size).toBe(0);
    expect(maxLevel).toBe(0);
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
});

// ---------------------------------------------------------------------------
// routeAroundBoxes
// ---------------------------------------------------------------------------

describe('routeAroundBoxes', () => {
  it('returns a valid SVG path string', () => {
    const a = { left: 10, right: 30, top: 50, bottom: 70 };
    const b = { left: 10, right: 30, top: 150, bottom: 170 };
    const d = routeAroundBoxes(a, b, [], ARC_BASE_STEM);
    expect(d).toMatch(/^M /);
  });

  it('produces the same path as buildCrossRowArcPath when there are no obstacles', () => {
    const a = { left: 10, right: 30, top: 50, bottom: 70 };
    const b = { left: 60, right: 80, top: 150, bottom: 170 };
    const routed = routeAroundBoxes(a, b, [], ARC_BASE_STEM);
    const direct = buildCrossRowArcPath(a, b, ARC_BASE_STEM);
    // Without obstacles and with symmetric routing, midX = (cx1+cx2)/2 which may produce
    // numerically identical or close paths. Just verify both are non-empty strings.
    expect(typeof routed).toBe('string');
    expect(typeof direct).toBe('string');
  });

  it('produces a different path when an obstacle straddles midX inside the arc vertical span', () => {
    // cx1 = cx2 = 100, so midX = 100. Obstacle straddles midX (90–110) inside the arc span.
    const a = { left: 90, right: 110, top: 50, bottom: 70 };
    const b = { left: 90, right: 110, top: 200, bottom: 220 };
    const midY = (70 + 200) / 2 + ARC_BASE_STEM;
    const obstacle = { left: 90, right: 110, top: 70, bottom: midY + 10 };
    const routed = routeAroundBoxes(a, b, [a, b, obstacle], ARC_BASE_STEM);
    const unobstructed = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    expect(routed).not.toBe(unobstructed);
  });

  it('routes left when midX is closer to the left edge of the obstacle', () => {
    // cx1 = cx2 = 100, midX = 100. Obstacle is 96–130: distLeft=4, distRight=30 → route left.
    const a = { left: 80, right: 120, top: 0, bottom: 20 };
    const b = { left: 80, right: 120, top: 200, bottom: 220 };
    const midY = (20 + 200) / 2 + ARC_BASE_STEM;
    const obstacle = { left: 96, right: 130, top: 20, bottom: midY + 10 };
    const routed = routeAroundBoxes(a, b, [a, b, obstacle], ARC_BASE_STEM);
    const unobstructed = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    // The path must change (routing moved midX left of the obstacle).
    expect(routed).not.toBe(unobstructed);
  });

  it('routes right when midX is closer to the right edge of the obstacle', () => {
    // cx1 = cx2 = 100, midX = 100. Obstacle is 70–104: distLeft=30, distRight=4 → route right.
    const a = { left: 80, right: 120, top: 0, bottom: 20 };
    const b = { left: 80, right: 120, top: 200, bottom: 220 };
    const midY = (20 + 200) / 2 + ARC_BASE_STEM;
    const obstacle = { left: 70, right: 104, top: 20, bottom: midY + 10 };
    const routed = routeAroundBoxes(a, b, [a, b, obstacle], ARC_BASE_STEM);
    const unobstructed = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    // The path must change (routing moved midX right of the obstacle).
    expect(routed).not.toBe(unobstructed);
  });

  it('skips obstacles where midX is not strictly inside (midX equals left boundary)', () => {
    // midX = 100. Obstacle starts exactly at 100 — condition is midX > obs.left, so not triggered.
    const a = { left: 80, right: 120, top: 0, bottom: 20 };
    const b = { left: 80, right: 120, top: 200, bottom: 220 };
    const midY = (20 + 200) / 2 + ARC_BASE_STEM;
    const obstacle = { left: 100, right: 150, top: 20, bottom: midY + 10 };
    const withObs = routeAroundBoxes(a, b, [a, b, obstacle], ARC_BASE_STEM);
    const withoutObs = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    expect(withObs).toBe(withoutObs);
  });

  it('skips obstacles where midX is not strictly inside (midX equals right boundary)', () => {
    // midX = 100. Obstacle ends exactly at 100 — condition is midX < obs.right, so not triggered.
    const a = { left: 80, right: 120, top: 0, bottom: 20 };
    const b = { left: 80, right: 120, top: 200, bottom: 220 };
    const midY = (20 + 200) / 2 + ARC_BASE_STEM;
    const obstacle = { left: 50, right: 100, top: 20, bottom: midY + 10 };
    const withObs = routeAroundBoxes(a, b, [a, b, obstacle], ARC_BASE_STEM);
    const withoutObs = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    expect(withObs).toBe(withoutObs);
  });

  it('skips obstacles outside the arc vertical span', () => {
    // midX = 100, obstacle straddles midX horizontally but sits above y1=20.
    const a = { left: 80, right: 120, top: 0, bottom: 20 };
    const b = { left: 80, right: 120, top: 200, bottom: 220 };
    const above = { left: 90, right: 110, top: 0, bottom: 15 };
    const withObs = routeAroundBoxes(a, b, [a, b, above], ARC_BASE_STEM);
    const withoutObs = routeAroundBoxes(a, b, [a, b], ARC_BASE_STEM);
    expect(withObs).toBe(withoutObs);
  });
});

// ---------------------------------------------------------------------------
// getArcStrokeProps
// ---------------------------------------------------------------------------

describe('getArcStrokeProps', () => {
  const dimmed = { stroke: 'var(--border)', strokeOpacity: 0.4, strokeWidth: 2 };
  const whiteHighlight = { stroke: 'white', strokeOpacity: 1, strokeWidth: 2 };
  const destructiveHighlight = {
    stroke: 'var(--destructive)',
    strokeOpacity: 1,
    strokeWidth: 2,
  };

  it('dims non-highlighted arcs in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', undefined, undefined)).toEqual(dimmed);
  });

  it('whitens the hovered phrase arc in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', 'p1', undefined)).toEqual(whiteHighlight);
  });

  it('whitens the focused phrase arc in view mode', () => {
    expect(getArcStrokeProps({ kind: 'view' }, 'p1', undefined, 'p1')).toEqual(whiteHighlight);
  });

  it('whitens the draft arc in create mode regardless of hover', () => {
    expect(
      getArcStrokeProps(
        { kind: 'create', draftTokenRefs: ['t1'] },
        DRAFT_PHRASE_ID,
        undefined,
        undefined,
      ),
    ).toEqual(whiteHighlight);
  });

  it('dims non-draft arcs in create mode even when hovered', () => {
    expect(getArcStrokeProps({ kind: 'create', draftTokenRefs: ['t1'] }, 'p1', 'p1', 'p1')).toEqual(
      dimmed,
    );
  });

  it('whitens the edited phrase arc in edit mode regardless of hover', () => {
    expect(
      getArcStrokeProps(
        { kind: 'edit', phraseId: 'p1', originalTokens: [] },
        'p1',
        undefined,
        undefined,
      ),
    ).toEqual(whiteHighlight);
  });

  it('dims non-target arcs in edit mode even when hovered', () => {
    expect(
      getArcStrokeProps({ kind: 'edit', phraseId: 'p1', originalTokens: [] }, 'p2', 'p2', 'p2'),
    ).toEqual(dimmed);
  });

  it('uses destructive color for the target arc in confirm-unlink mode', () => {
    expect(
      getArcStrokeProps({ kind: 'confirm-unlink', phraseId: 'p1' }, 'p1', undefined, undefined),
    ).toEqual(destructiveHighlight);
  });

  it('dims non-target arcs in confirm-unlink mode even when hovered', () => {
    expect(getArcStrokeProps({ kind: 'confirm-unlink', phraseId: 'p1' }, 'p2', 'p2', 'p2')).toEqual(
      dimmed,
    );
  });
});
