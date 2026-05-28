import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { isWordToken } from '../components/component-types';
import { DRAFT_PHRASE_ID, type PhraseMode } from '../components/phrase-mode';

/**
 * Half the height of a floating phrase-controls pill in pixels. The pill is centred on the arc top
 * line (or on the box top when no arc exists), so only this half extends above it into the
 * top-padding zone. Sized for text-xs + border + py-px ≈ 18px total.
 */
export const CONTROLS_HALF_HEIGHT_PX = 10;

/** Base stem height (px) for arc connectors at nesting level 0. */
export const ARC_BASE_STEM = 6;

/** Additional stem height (px) added per nesting level so interleaved arcs don't overlap. */
export const ARC_LEVEL_STEP = 8;

/** Corner radius (px) used in all arc bracket paths. */
export const ARC_CORNER_RADIUS = 5;

/** A grouped render unit: one or more adjacent tokens that share the same phrase (or no phrase). */
export type TokenGroup = {
  /** The tokens to render together in one `PhraseBox`. */
  tokens: (Token & { type: 'word' })[];
  /** The phrase link shared by all tokens in this group, or `undefined` for ungrouped solo tokens. */
  phraseLink: PhraseAnalysisLink | undefined;
  /**
   * The index of the first token in the flat token array from which this group was built — passed
   * as `index` to `PhraseBox`.
   */
  firstIndex: number;
};

/**
 * Groups adjacent word tokens that share the same approved `PhraseAnalysisLink` (or draft link)
 * into single `TokenGroup` entries. Non-word tokens are skipped. Discontiguous phrase members
 * produce separate groups that share the same `phraseLink`.
 *
 * @param tokens - The flat token list to group.
 * @param phraseLinkByRef - Map from `tokenRef` to the `PhraseAnalysisLink` containing it.
 * @returns An ordered array of `TokenGroup`s ready for rendering.
 */
export function groupTokens(
  tokens: Token[],
  phraseLinkByRef: Map<string, PhraseAnalysisLink>,
): TokenGroup[] {
  return tokens.reduce<TokenGroup[]>((groups, token, index) => {
    if (!isWordToken(token)) return groups;
    const link = phraseLinkByRef.get(token.ref);
    const last = groups[groups.length - 1];
    if (link && last?.phraseLink?.analysisId === link.analysisId) {
      last.tokens.push(token);
    } else {
      groups.push({ tokens: [token], phraseLink: link, firstIndex: index });
    }
    return groups;
  }, []);
}

/**
 * Builds an effective phrase-link map that overlays draft membership onto the committed map. In
 * create mode, selected draft token refs are mapped to a synthetic `PhraseAnalysisLink` with
 * `analysisId === DRAFT_PHRASE_ID`. Returns `committedMap` unchanged in other modes.
 *
 * @param committedMap - The committed phrase-link map from the Redux store.
 * @param phraseMode - Current phrase-interaction mode.
 * @returns Either `committedMap` unchanged or a new map with draft entries overlaid.
 */
export function buildEffectiveLinkMap(
  committedMap: Map<string, PhraseAnalysisLink>,
  phraseMode: PhraseMode,
): Map<string, PhraseAnalysisLink> {
  if (phraseMode.kind !== 'create' || phraseMode.draftTokenRefs.length === 0) return committedMap;

  const draftLink: PhraseAnalysisLink = {
    analysisId: DRAFT_PHRASE_ID,
    status: 'approved',
    tokens: phraseMode.draftTokenRefs.map((r) => ({ tokenRef: r, surfaceText: '' })),
  };

  const effective = new Map(committedMap);
  phraseMode.draftTokenRefs.forEach((ref) => effective.set(ref, draftLink));
  return effective;
}

/** Stroke styling for a single phrase arc; consumed directly as SVG `<path>` attributes. */
export type ArcStrokeProps = {
  /** SVG `stroke` value — a CSS color expression. */
  stroke: string;
  /** SVG `stroke-opacity`. */
  strokeOpacity: number;
  /** SVG `stroke-width` in user units. */
  strokeWidth: number;
};

/**
 * Computes the stroke styling for a phrase arc so SegmentView and ContinuousView render lines
 * identically across all phrase-interaction modes. The rules:
 *
 * - `confirm-unlink`: the target phrase's arc is drawn in the destructive color; all other arcs are
 *   dimmed.
 * - `create`: the draft phrase's arc is white (matches the white ring on its phrase box); other arcs
 *   are dimmed and hover is suppressed.
 * - `edit`: the edited phrase's arc is white (matches its phrase-box ring); other arcs are dimmed and
 *   hover is suppressed.
 * - `view`: the hovered or focused phrase's arc is white; other arcs are drawn in the same border
 *   color as the unhighlighted phrase-box border so the line and box read as a single shape.
 *
 * @param phraseMode - Current phrase-interaction mode.
 * @param phraseId - The phraseId of the arc being styled.
 * @param hoveredPhraseId - The phraseId currently hovered, if any.
 * @param focusedPhraseId - The phraseId of the focused token's phrase, if any.
 * @returns Stroke styling props for the arc.
 */
export function getArcStrokeProps(
  phraseMode: PhraseMode,
  phraseId: string,
  hoveredPhraseId: string | undefined,
  focusedPhraseId: string | undefined,
): ArcStrokeProps {
  // Matches the unhighlighted phrase-box border (`tw:border-border/40`) so a line and the boxes it
  // joins share the same visual weight. strokeWidth 2 keeps a 1px SVG line from disappearing once
  // alpha-composited at 40% opacity. Uses `--border` (not `--color-border`) because Tailwind 4's
  // `@theme inline` inlines the latter at build time and only the former is a runtime variable.
  const dimmed: ArcStrokeProps = {
    stroke: 'var(--border)',
    strokeOpacity: 0.4,
    strokeWidth: 2,
  };
  const destructive: ArcStrokeProps = {
    stroke: 'var(--destructive)',
    strokeOpacity: 1,
    strokeWidth: 2,
  };
  const highlighted: ArcStrokeProps = { stroke: 'white', strokeOpacity: 1, strokeWidth: 2 };

  if (phraseMode.kind === 'confirm-unlink') {
    return phraseId === phraseMode.phraseId ? destructive : dimmed;
  }
  if (phraseMode.kind === 'create') {
    return phraseId === DRAFT_PHRASE_ID ? highlighted : dimmed;
  }
  if (phraseMode.kind === 'edit') {
    return phraseId === phraseMode.phraseId ? highlighted : dimmed;
  }
  // view mode
  const isHighlighted = phraseId === hoveredPhraseId || phraseId === focusedPhraseId;
  return isHighlighted ? highlighted : dimmed;
}

/**
 * Assigns nesting levels to phrases using a greedy interval-graph colouring algorithm. Phrases
 * whose x-spans overlap are assigned different levels so their arcs don't visually cross.
 *
 * @param phraseSpans - Map from phraseId to its leftmost and rightmost x-coordinate in the row.
 * @returns Map from phraseId to its assigned nesting level (0 = outermost).
 */
export function assignPhraseLevels(
  phraseSpans: Map<string, { left: number; right: number }>,
): Map<string, number> {
  const phraseLevels = new Map<string, number>();
  phraseSpans.forEach((span, phraseId) => {
    const usedLevels = new Set<number>();
    phraseSpans.forEach((otherSpan, otherId) => {
      if (otherId !== phraseId && otherSpan.left < span.right && otherSpan.right > span.left) {
        const otherLevel = phraseLevels.get(otherId);
        if (otherLevel !== undefined) usedLevels.add(otherLevel);
      }
    });
    let level = 0;
    while (usedLevels.has(level)) level += 1;
    phraseLevels.set(phraseId, level);
  });
  return phraseLevels;
}

/** A computed arc path entry for a single segment between two phrase boxes. */
export type ArcPath = { phraseId: string; d: string };

/**
 * Result of {@link computeAllArcPaths}: the three pieces of arc state the Interlinearizer needs
 * after each layout measurement.
 */
export type ArcState = {
  /** SVG path strings for all discontiguous phrase arcs. */
  paths: ArcPath[];
  /** Nesting level per phraseId; drives arc height and controls pill offset. */
  levelByPhraseId: Map<string, number>;
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxLevel: number;
};

/**
 * Converts a viewport-relative `DOMRect` to scroll-space coordinates relative to the container's
 * content origin.
 *
 * @param rect - The viewport-relative bounding rect of a phrase-box element.
 * @param containerRect - The viewport-relative bounding rect of the scroll container.
 * @param scrollLeft - Current `scrollLeft` of the scroll container.
 * @param scrollTop - Current `scrollTop` of the scroll container.
 * @returns A plain object with `left`, `right`, `top`, `bottom`, `width`, and `height` in
 *   scroll-space.
 */
function toScrollSpace(
  rect: DOMRect,
  containerRect: DOMRect,
  scrollLeft: number,
  scrollTop: number,
): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
  const left = rect.left - containerRect.left + scrollLeft;
  const right = rect.right - containerRect.left + scrollLeft;
  const top = rect.top - containerRect.top + scrollTop;
  const bottom = rect.bottom - containerRect.top + scrollTop;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/**
 * Measures all `[data-phrase-box]` elements inside `container`, groups them by phrase id, and
 * computes SVG arc paths in scroll-space coordinates connecting discontiguous boxes — both same-row
 * upward brackets and cross-row/cross-segment S-curves. Phrases are assigned nesting levels so
 * their arcs don't overlap. Cross-row arcs are routed around intervening phrase boxes.
 *
 * @param container - The scroll container element to search.
 * @returns The computed arc paths, level map, and maximum nesting level.
 */
export function computeAllArcPaths(container: Element): ArcState {
  const containerRect = container.getBoundingClientRect();
  const { scrollLeft, scrollTop } = container;

  // Collect all phrase-box elements and their scroll-space rects.
  const allBoxRects: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  }[] = [];
  const boxesByPhrase = new Map<
    string,
    {
      rect: {
        left: number;
        right: number;
        top: number;
        bottom: number;
        width: number;
        height: number;
      };
      viewportRect: DOMRect;
    }[]
  >();

  container.querySelectorAll('[data-phrase-box="true"][data-phrase-id]').forEach((el) => {
    const id = el.getAttribute('data-phrase-id');
    if (!id) return;
    const viewportRect = el.getBoundingClientRect();
    const rect = toScrollSpace(viewportRect, containerRect, scrollLeft, scrollTop);
    allBoxRects.push(rect);
    const list = boxesByPhrase.get(id) ?? [];
    list.push({ rect, viewportRect });
    boxesByPhrase.set(id, list);
  });

  // Build phrase spans (leftmost/rightmost x in scroll-space) for level assignment.
  const phraseSpans = new Map<string, { left: number; right: number }>();
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    phraseSpans.set(phraseId, {
      left: Math.min(...boxes.map((b) => b.rect.left)),
      right: Math.max(...boxes.map((b) => b.rect.right)),
    });
  });

  const levelByPhraseId = assignPhraseLevels(phraseSpans);

  const paths: ArcPath[] = [];
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    const level = levelByPhraseId.get(phraseId) ?? 0;
    const stem = ARC_BASE_STEM + level * ARC_LEVEL_STEP;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      const sameRow = Math.abs(a.top - b.top) < a.height / 2;
      const d = sameRow
        ? buildSameRowArcPath(a, b, stem)
        : routeAroundBoxes(a, b, allBoxRects, stem);
      paths.push({ phraseId, d });
    }
  });

  const maxLevel = levelByPhraseId.size > 0 ? Math.max(...levelByPhraseId.values()) : 0;

  return { paths, levelByPhraseId, maxLevel };
}

/**
 * Builds an SVG path string for a same-row upward bracket arc connecting two boxes. Coordinates are
 * expressed in scroll-space (relative to the scroll container's content origin).
 *
 * @param a - Scroll-space rect of the left/earlier box.
 * @param b - Scroll-space rect of the right/later box.
 * @param stem - Total stem height in pixels (base + level offset).
 * @returns SVG path `d` attribute string.
 */
export function buildSameRowArcPath(
  a: { left: number; right: number; top: number },
  b: { left: number; right: number; top: number },
  stem: number,
): string {
  const r = ARC_CORNER_RADIUS;
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  const y = a.top;
  const ltr = x2 >= x1;
  const sw1 = ltr ? 1 : 0;
  const sw2 = ltr ? 1 : 0;
  const dx = ltr ? r : -r;
  return `M ${x1} ${y} L ${x1} ${y - stem} a ${r} ${r} 0 0 ${sw1} ${dx} ${-r} L ${x2 - dx} ${y - stem - r} a ${r} ${r} 0 0 ${sw2} ${dx} ${r} L ${x2} ${y}`;
}

/**
 * Builds an SVG path string for a cross-row downward S-curve arc connecting two boxes in different
 * rows. Coordinates are expressed in scroll-space (relative to the scroll container's content
 * origin). The midpoint is bowed outward by `stem` pixels to give the arc visual separation.
 *
 * @param a - Scroll-space rect of the earlier (upper) box.
 * @param b - Scroll-space rect of the later (lower) box.
 * @param stem - Vertical offset applied to the arc midpoint to bow the curve outward.
 * @returns SVG path `d` attribute string.
 */
export function buildCrossRowArcPath(
  a: { left: number; right: number; bottom: number },
  b: { left: number; right: number; top: number },
  stem: number,
): string {
  const r = ARC_CORNER_RADIUS;
  const cx1 = (a.left + a.right) / 2;
  const y1 = a.bottom;
  const cx2 = (b.left + b.right) / 2;
  const y2 = b.top;
  const mid = (y1 + y2) / 2 + stem;
  const ltr = cx2 >= cx1;
  const nudge = Math.max(0, 2 * r - Math.abs(cx2 - cx1)) / 2;
  const tx1 = cx1 + (ltr ? -nudge : nudge);
  const tx2 = cx2 + (ltr ? nudge : -nudge);
  const dx = ltr ? r : -r;
  const sw1 = ltr ? 0 : 1;
  const sw2 = ltr ? 1 : 0;
  return `M ${cx1} ${y1} L ${tx1} ${mid - r} a ${r} ${r} 0 0 ${sw1} ${dx} ${r} L ${tx2 - dx} ${mid} a ${r} ${r} 0 0 ${sw2} ${dx} ${r} L ${cx2} ${y2}`;
}

/**
 * Builds a cross-row/cross-segment arc path that routes around obstacle phrase boxes whose y-ranges
 * overlap the arc's vertical span. For each obstacle, the arc's mid-x control point is nudged left
 * or right — choosing the side that requires less horizontal deviation — so the arc passes to the
 * side of the box rather than through it. Multiple obstacles are processed in top-to-bottom order
 * with the nudges accumulated. If there are no relevant obstacles the result is identical to
 * {@link buildCrossRowArcPath}.
 *
 * @param a - Scroll-space rect of the earlier (upper) box.
 * @param b - Scroll-space rect of the later (lower) box.
 * @param obstacles - All phrase-box rects in scroll-space (including `a` and `b`; they are filtered
 *   out internally because their y-range does not overlap the arc's interior).
 * @param stem - Vertical offset applied to the arc midpoint to bow the curve outward.
 * @returns SVG path `d` attribute string.
 */
export function routeAroundBoxes(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
  obstacles: { left: number; right: number; top: number; bottom: number }[],
  stem: number,
): string {
  const r = ARC_CORNER_RADIUS;
  const cx1 = (a.left + a.right) / 2;
  const y1 = a.bottom;
  const cx2 = (b.left + b.right) / 2;
  const y2 = b.top;
  const midY = (y1 + y2) / 2 + stem;

  // Boxes whose vertical range overlaps the arc's interior span (exclusive of a and b themselves).
  const relevant = obstacles
    .filter((obs) => obs !== a && obs !== b && obs.top < midY && obs.bottom > y1)
    .sort((p, q) => p.top - q.top);

  let midX = (cx1 + cx2) / 2;

  relevant.forEach((obs) => {
    // Only act when midX falls inside the obstacle's horizontal extent.
    if (midX > obs.left && midX < obs.right) {
      // midX is inside the obstacle — choose the side that requires less deviation.
      const distLeft = midX - obs.left;
      const distRight = obs.right - midX;
      if (distLeft <= distRight) {
        // Route to the left: push midX past the left edge of the obstacle.
        midX = obs.left - r;
      } else {
        // Route to the right: push midX past the right edge of the obstacle.
        midX = obs.right + r;
      }
    }
  });

  // Build the S-curve via midX: first leg cx1→midX, second leg midX→cx2.
  const ltr1 = midX >= cx1;
  const nudge1 = Math.max(0, 2 * r - Math.abs(midX - cx1)) / 2;
  const tx1 = cx1 + (ltr1 ? -nudge1 : nudge1);
  const dx1 = ltr1 ? r : -r;
  const sw1 = ltr1 ? 0 : 1;

  const ltr2 = cx2 >= midX;
  const nudge2 = Math.max(0, 2 * r - Math.abs(cx2 - midX)) / 2;
  const tx2 = cx2 + (ltr2 ? nudge2 : -nudge2);
  const dx2 = ltr2 ? r : -r;
  const sw2 = ltr2 ? 1 : 0;

  return `M ${cx1} ${y1} L ${tx1} ${midY - r} a ${r} ${r} 0 0 ${sw1} ${dx1} ${r} L ${tx2 - dx2} ${midY} a ${r} ${r} 0 0 ${sw2} ${dx2} ${r} L ${cx2} ${y2}`;
}
