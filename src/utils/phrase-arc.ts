import type { PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import type { PhraseMode } from '../types/phrase-mode';

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

/**
 * Subset of the phrase-store dispatch surface that {@link splitPhraseAtBoundary} needs. Kept local
 * to the utils layer so this module doesn't depend on `components/AnalysisStore`; the real
 * `PhraseDispatch` is structurally compatible.
 */
export type SplitPhraseDispatch = {
  createPhrase: (tokens: TokenSnapshot[]) => string;
  updatePhrase: (phraseId: string, tokens: TokenSnapshot[]) => void;
  deletePhrase: (phraseId: string) => void;
};

/**
 * Splits `phraseLink` at the boundary immediately after `splitAfterTokenRef` and dispatches the
 * resulting create/update/delete calls. Shared by ContinuousView's arc-split button, SegmentView's
 * arc-split button, and TokenLinkIcon's between-token unlink button so all three paths can never
 * drift apart.
 *
 * Outcomes (where `before` is the half up to and including `splitAfterTokenRef`, `after` is the
 * remainder):
 *
 * - Both halves ≤ 1 token → the phrase is deleted entirely (only 2 tokens to begin with).
 * - Both halves ≥ 2 tokens → the original phrase shrinks to `before`, a new phrase is created from
 *   `after`.
 * - Exactly one half has 1 token → the phrase shrinks to the larger half; the solo token becomes
 *   free.
 *
 * The boundary is defined in **document order**, which is how the split buttons present it
 * visually, so `phraseLink.tokens` is sorted by `tokenDocOrder` before slicing. This makes the
 * split correct even if the stored token list happens to be out of document order. Tokens missing
 * from `tokenDocOrder` sort to the front (index 0).
 *
 * If `splitAfterTokenRef` is not found in `phraseLink.tokens`, or is the last token in document
 * order (which would leave the phrase unchanged), the function is a no-op.
 *
 * @param phraseLink - The phrase link to split.
 * @param splitAfterTokenRef - Token ref of the last token to keep in the earlier fragment.
 * @param dispatch - Phrase create/update/delete callbacks.
 * @param tokenDocOrder - Map from token ref to flat document index, used to order the tokens before
 *   slicing. Defaults to an empty map (preserves the stored order).
 */
export function splitPhraseAtBoundary(
  phraseLink: PhraseAnalysisLink,
  splitAfterTokenRef: string,
  dispatch: SplitPhraseDispatch,
  tokenDocOrder: ReadonlyMap<string, number> = new Map(),
): void {
  const ordered = [...phraseLink.tokens].sort(
    (a, b) => (tokenDocOrder.get(a.tokenRef) ?? 0) - (tokenDocOrder.get(b.tokenRef) ?? 0),
  );
  const idx = ordered.findIndex((t) => t.tokenRef === splitAfterTokenRef);
  if (idx < 0) return;
  // Splitting after the last token would leave the phrase unchanged (all tokens `before`, none
  // `after`) while still dispatching an update + triggering `onSave`. Callers only place split
  // buttons between consecutive boxes, so this is defensive, but cheaper than a redundant write.
  if (idx === ordered.length - 1) return;
  const boundary = idx + 1;
  const before = ordered.slice(0, boundary);
  const after = ordered.slice(boundary);
  if (before.length <= 1 && after.length <= 1) {
    dispatch.deletePhrase(phraseLink.analysisId);
    return;
  }
  if (before.length >= 2 && after.length >= 2) {
    dispatch.updatePhrase(phraseLink.analysisId, before);
    dispatch.createPhrase(after);
    return;
  }
  dispatch.updatePhrase(phraseLink.analysisId, before.length >= 2 ? before : after);
}

/**
 * Computes the top padding (in pixels) required by a token strip/row so that arcs and the floating
 * phrase-controls pill both fit above the phrase boxes.
 *
 * Arc padding: `15` = `ARC_BASE_STEM` (6) + corner radius (5) + breathing room (4); each nesting
 * level adds `ARC_LEVEL_STEP` (8) px. When there are no arcs this contribution is zero.
 *
 * Controls headroom: when any real phrase is visible, the floating controls pill sits centred on
 * either the arc top (for discontiguous phrases) or the box top (for contiguous phrases). Its upper
 * half (`CONTROLS_HALF_HEIGHT_PX`) extends above whichever line it rides; on box-top phrases the
 * pill sits at `top: -CONTROLS_HALF_HEIGHT_PX`, so the strip needs `2 * CONTROLS_HALF_HEIGHT_PX` of
 * headroom to keep the full pill visible.
 *
 * @param hasArcs - Whether at least one arc is currently drawn.
 * @param maxArcLevel - Maximum arc nesting level among the visible arcs.
 * @param hasRealPhrase - Whether any committed phrase is rendered in the current window.
 * @returns The required top padding in pixels, with a floor of 8.
 */
export function computeStripTopPadding(
  hasArcs: boolean,
  maxArcLevel: number,
  hasRealPhrase: boolean,
): number {
  const arcPadding = hasArcs ? 15 + maxArcLevel * 8 : 0;
  const controlsHeadroom = hasRealPhrase ? 2 * CONTROLS_HALF_HEIGHT_PX : 0;
  return Math.max(8, arcPadding + controlsHeadroom);
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
 * - `edit`: the edited phrase's arc is white (matches its phrase-box ring); other arcs are dimmed and
 *   hover is suppressed.
 * - `view`: the focused phrase's arc is full-white; the hovered phrase's arc is mid-level white; all
 *   other arcs are drawn in the same border color as the unhighlighted phrase-box border.
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
    strokeOpacity: 0.5,
    strokeWidth: 2,
  };
  const destructive: ArcStrokeProps = {
    stroke: 'var(--destructive)',
    strokeOpacity: 1,
    strokeWidth: 2,
  };
  const hovered: ArcStrokeProps = { stroke: 'white', strokeOpacity: 0.55, strokeWidth: 2 };
  const highlighted: ArcStrokeProps = { stroke: 'white', strokeOpacity: 1, strokeWidth: 2 };

  if (phraseMode.kind === 'confirm-unlink') {
    return phraseId === phraseMode.phraseId ? destructive : dimmed;
  }
  if (phraseMode.kind === 'edit') {
    return phraseId === phraseMode.phraseId ? highlighted : dimmed;
  }
  // view mode
  if (phraseId === focusedPhraseId) return highlighted;
  if (phraseId === hoveredPhraseId) return hovered;
  return dimmed;
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
export type ArcPath = {
  phraseId: string;
  d: string;
  /** Scroll-space x coordinate of the arc's visual midpoint, used to position the split button. */
  midX: number;
  /** Scroll-space y coordinate of the arc's visual midpoint, used to position the split button. */
  midY: number;
  /**
   * Token ref of the last token in the earlier box. Passed to the arc split button so it knows
   * where to cut the phrase token list.
   */
  splitAfterTokenRef: string;
};

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
      lastTokenRef: string;
    }[]
  >();

  container.querySelectorAll('[data-phrase-box="true"][data-phrase-id]').forEach((el) => {
    const id = el.getAttribute('data-phrase-id');
    /* v8 ignore next -- selector already requires data-phrase-id to exist */
    if (!id) return;
    const lastTokenRef = el.getAttribute('data-last-token-ref') ?? '';
    const viewportRect = el.getBoundingClientRect();
    const rect = toScrollSpace(viewportRect, containerRect, scrollLeft, scrollTop);
    allBoxRects.push(rect);
    const list = boxesByPhrase.get(id) ?? [];
    list.push({ rect, viewportRect, lastTokenRef });
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
    /* v8 ignore next -- levelByPhraseId always has an entry for every multi-box phrase */
    const level = levelByPhraseId.get(phraseId) ?? 0;
    const stem = ARC_BASE_STEM + level * ARC_LEVEL_STEP;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      const sameRow = Math.abs(a.top - b.top) < a.height / 2;
      const { d, midX, midY } = sameRow
        ? buildSameRowArcPath(a, b, stem)
        : routeAroundBoxes(a, b, allBoxRects, stem);
      paths.push({ phraseId, d, midX, midY, splitAfterTokenRef: boxes[i].lastTokenRef });
    }
  });

  const maxLevel = levelByPhraseId.size > 0 ? Math.max(...levelByPhraseId.values()) : 0;

  return { paths, levelByPhraseId, maxLevel };
}

/**
 * Builds an SVG path string and scroll-space midpoint for a same-row upward bracket arc connecting
 * two boxes. Coordinates are expressed in scroll-space (relative to the scroll container's content
 * origin).
 *
 * @param a - Scroll-space rect of the left/earlier box.
 * @param b - Scroll-space rect of the right/later box.
 * @param stem - Total stem height in pixels (base + level offset).
 * @returns Object containing the SVG path `d` attribute string and the arc's visual midpoint.
 */
export function buildSameRowArcPath(
  a: { left: number; right: number; top: number },
  b: { left: number; right: number; top: number },
  stem: number,
): { d: string; midX: number; midY: number } {
  const r = ARC_CORNER_RADIUS;
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  const y = a.top;
  const ltr = x2 >= x1;
  const sw1 = ltr ? 1 : 0;
  const sw2 = ltr ? 1 : 0;
  const dx = ltr ? r : -r;
  const d = `M ${x1} ${y} L ${x1} ${y - stem} a ${r} ${r} 0 0 ${sw1} ${dx} ${-r} L ${x2 - dx} ${y - stem - r} a ${r} ${r} 0 0 ${sw2} ${dx} ${r} L ${x2} ${y}`;
  return { d, midX: (x1 + x2) / 2, midY: y - stem - r };
}

/**
 * Builds an SVG path string and scroll-space midpoint for a cross-row downward S-curve arc
 * connecting two boxes in different rows. Coordinates are expressed in scroll-space (relative to
 * the scroll container's content origin). The midpoint is bowed outward by `stem` pixels to give
 * the arc visual separation.
 *
 * @param a - Scroll-space rect of the earlier (upper) box.
 * @param b - Scroll-space rect of the later (lower) box.
 * @param stem - Vertical offset applied to the arc midpoint to bow the curve outward.
 * @returns Object containing the SVG path `d` attribute string and the arc's visual midpoint.
 */
export function buildCrossRowArcPath(
  a: { left: number; right: number; bottom: number },
  b: { left: number; right: number; top: number },
  stem: number,
): { d: string; midX: number; midY: number } {
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
  const midX = (tx1 + tx2 + dx - dx) / 2;
  const d = `M ${cx1} ${y1} L ${tx1} ${mid - r} a ${r} ${r} 0 0 ${sw1} ${dx} ${r} L ${tx2 - dx} ${mid} a ${r} ${r} 0 0 ${sw2} ${dx} ${r} L ${cx2} ${y2}`;
  return { d, midX, midY: mid };
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
 * @returns Object containing the SVG path `d` attribute string and the arc's visual midpoint.
 */
export function routeAroundBoxes(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
  obstacles: { left: number; right: number; top: number; bottom: number }[],
  stem: number,
): { d: string; midX: number; midY: number } {
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

  const d = `M ${cx1} ${y1} L ${tx1} ${midY - r} a ${r} ${r} 0 0 ${sw1} ${dx1} ${r} L ${tx2 - dx2} ${midY} a ${r} ${r} 0 0 ${sw2} ${dx2} ${r} L ${cx2} ${y2}`;
  return { d, midX, midY };
}
