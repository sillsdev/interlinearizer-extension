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
 * Vertical clearance (px) added per cross-row arc that must pass through a row gap. When multiple
 * arcs share the same inter-row gap their midY values are spread by this amount so they don't
 * overlap.
 */
export const CROSS_ROW_ARC_CLEARANCE = 10;

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
 * Sorts token snapshots by their flat document index so a stored phrase token list always reflects
 * the visual left-to-right order. Shared by every path that slices a phrase (split previews,
 * splits, and edit-mode inserts) so document order is computed identically everywhere. Tokens
 * missing from `tokenDocOrder` sort to the front (index 0).
 *
 * @param tokens - Token snapshots to sort. Not mutated; a new array is returned.
 * @param tokenDocOrder - Map from token ref to flat document index.
 * @returns A new array sorted by ascending document index.
 */
export function sortByDocOrder<T extends { tokenRef: string }>(
  tokens: readonly T[],
  tokenDocOrder: ReadonlyMap<string, number>,
): T[] {
  return [...tokens].sort(
    /* v8 ignore next -- ?? 0 fallback for tokens not in tokenDocOrder; always provided in practice */
    (a, b) => (tokenDocOrder.get(a.tokenRef) ?? 0) - (tokenDocOrder.get(b.tokenRef) ?? 0),
  );
}

/**
 * Enumerates the tokens of `phraseLink` that would become solo (free) after splitting at the
 * boundary immediately after `splitAfterTokenRef`. A half with exactly one token leaves that token
 * unattached; this is what the link/unlink and arc-split hovers preview with a destructive border.
 * Mirrors the slicing in {@link splitPhraseAtBoundary} so the preview always matches the resulting
 * split.
 *
 * @param phraseLink - The phrase to split, or `undefined` when it cannot be resolved.
 * @param splitAfterTokenRef - Token ref marking the end of the earlier fragment.
 * @param tokenDocOrder - Map from token ref to flat document index; the tokens are ordered by this
 *   before slicing so the preview matches the document-order split.
 * @returns The refs of tokens that would become free, or `undefined` when no token would be left
 *   solo (both halves ≥ 2 tokens), the phrase is absent, or the boundary token is not found.
 */
export function computeSplitFreeRefs(
  phraseLink: PhraseAnalysisLink | undefined,
  splitAfterTokenRef: string,
  tokenDocOrder: ReadonlyMap<string, number>,
): string[] | undefined {
  /* v8 ignore next -- split buttons are only rendered for phrases found in the link map */
  if (!phraseLink) return undefined;
  const ordered = sortByDocOrder(phraseLink.tokens, tokenDocOrder);
  const idx = ordered.findIndex((t) => t.tokenRef === splitAfterTokenRef);
  if (idx < 0) return undefined;
  const boundary = idx + 1;
  const before = ordered.slice(0, boundary);
  const after = ordered.slice(boundary);
  const freeRefs: string[] = [];
  if (before.length === 1) freeRefs.push(before[0].tokenRef);
  if (after.length === 1) freeRefs.push(after[0].tokenRef);
  return freeRefs.length > 0 ? freeRefs : undefined;
}

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
  const ordered = sortByDocOrder(phraseLink.tokens, tokenDocOrder);
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
 * Arc padding: `ARC_BASE_STEM + ARC_CORNER_RADIUS + 4` per row plus `ARC_LEVEL_STEP` px per nesting
 * level. When there are no arcs this contribution is zero.
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
  const arcPadding = hasArcs
    ? ARC_BASE_STEM + ARC_CORNER_RADIUS + 4 + maxArcLevel * ARC_LEVEL_STEP
    : 0;
  const controlsHeadroom = hasRealPhrase ? 2 * CONTROLS_HALF_HEIGHT_PX : 0;
  return Math.max(ARC_LEVEL_STEP, arcPadding + controlsHeadroom);
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

/** A single same-row upward-bracket arc segment, used for nesting-level assignment. */
export type SameRowArcSegment = {
  /** The phrase this segment belongs to. */
  phraseId: string;
  /** Rounded scroll-space top of the row the segment sits on; segments only conflict within a row. */
  row: number;
  /** Leftmost x of the segment's span (midpoint of the earlier box). */
  left: number;
  /** Rightmost x of the segment's span (midpoint of the later box). */
  right: number;
};

/**
 * Assigns nesting levels to phrases using a greedy interval-graph colouring algorithm over their
 * **same-row arc segments only**. Two segments conflict — and must receive different levels — only
 * when they sit on the same row and their x-spans overlap, because nesting levels drive the stem
 * height of same-row upward brackets and only co-located brackets can visually overlap.
 *
 * Cross-row arcs deliberately do not participate: they are routed through the inter-row gap (and
 * clamped below same-row brackets via `maxMidY`), so they occupy no upward-bracket space on any row
 * and must not push same-row arcs higher. Including a cross-row phrase's full bounding box here was
 * the cause of same-row arcs being bumped up to "compensate" for inter-row arcs.
 *
 * A phrase's level is the maximum level across all of its same-row segments, so its stem is uniform
 * even when it has brackets on multiple rows. Phrases with only cross-row arcs receive no entry
 * (callers treat a missing entry as level 0).
 *
 * @param segments - All same-row arc segments across every phrase.
 * @returns Map from phraseId to its assigned nesting level (0 = outermost).
 */
export function assignPhraseLevels(segments: SameRowArcSegment[]): Map<string, number> {
  const segmentLevels = new Map<SameRowArcSegment, number>();
  segments.forEach((seg) => {
    const usedLevels = new Set<number>();
    segments.forEach((other) => {
      if (
        other !== seg &&
        other.row === seg.row &&
        other.left < seg.right &&
        other.right > seg.left
      ) {
        const otherLevel = segmentLevels.get(other);
        if (otherLevel !== undefined) usedLevels.add(otherLevel);
      }
    });
    let level = 0;
    while (usedLevels.has(level)) level += 1;
    segmentLevels.set(seg, level);
  });

  // Collapse to one level per phrase: the max across its segments keeps the stem uniform.
  const phraseLevels = new Map<string, number>();
  segments.forEach((seg) => {
    /* v8 ignore next -- segmentLevels.set is called for every seg above, so get() never returns undefined */
    const level = segmentLevels.get(seg) ?? 0;
    const prev = phraseLevels.get(seg.phraseId);
    if (prev === undefined || level > prev) phraseLevels.set(seg.phraseId, level);
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
 * Result of {@link computeAllArcPaths}: the arc state the Interlinearizer needs after each layout
 * measurement.
 */
export type ArcState = {
  /** SVG path strings for all discontiguous phrase arcs. */
  paths: ArcPath[];
  /** Nesting level per phraseId; drives arc height and controls pill offset. */
  levelByPhraseId: Map<string, number>;
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxLevel: number;
  /**
   * Minimum row gap (px) required to accommodate all cross-row arcs without overlapping. When
   * multiple arcs must pass through the same inter-row gap this exceeds the default CSS `gap-y`.
   * Zero when there are no cross-row arcs.
   */
  requiredRowGapPx: number;
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
 * their arcs don't overlap. Cross-row arcs are routed around intervening phrase boxes and spread
 * vertically within each inter-row gap so they don't overlap each other.
 *
 * @param container - The scroll container element to search.
 * @returns The computed arc paths, level map, maximum nesting level, and required row gap.
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

  // Collect every same-row upward-bracket arc segment. Only these drive nesting levels: cross-row
  // arcs are routed through the gap and never occupy bracket space on a row, so including them would
  // bump same-row arcs higher for no visual reason. Each segment's x-span runs between the box
  // midpoints, matching the bracket geometry in buildSameRowArcPath.
  const sameRowSegments: SameRowArcSegment[] = [];
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      if (Math.abs(a.top - b.top) < a.height / 2) {
        const x1 = (a.left + a.right) / 2;
        const x2 = (b.left + b.right) / 2;
        sameRowSegments.push({
          phraseId,
          row: Math.round(a.top),
          left: Math.min(x1, x2),
          right: Math.max(x1, x2),
        });
      }
    }
  });

  const levelByPhraseId = assignPhraseLevels(sameRowSegments);

  // Build a map from rounded row-top to the maximum same-row arc level on that row. Used to
  // ensure cross-row arc midY values stay clear of same-row arcs that protrude into the gap from
  // the lower row.
  const maxLevelByRowTop = new Map<number, number>();
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    /* v8 ignore next -- levelByPhraseId always has an entry for every multi-box phrase */
    const level = levelByPhraseId.get(phraseId) ?? 0;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      if (Math.abs(a.top - b.top) < a.height / 2) {
        // Same-row arc — record the level against this row's top.
        const rowKey = Math.round(a.top);
        const prev = maxLevelByRowTop.get(rowKey) ?? -1;
        if (level > prev) maxLevelByRowTop.set(rowKey, level);
      }
    }
  });

  // First pass: build same-row arcs and collect cross-row arc descriptors (without final midY).
  type CrossRowDescriptor = {
    phraseId: string;
    a: { left: number; right: number; top: number; bottom: number };
    b: { left: number; right: number; top: number; bottom: number };
    midX: number;
    splitAfterTokenRef: string;
    // Key identifying this inter-row gap: rounded bottom of upper box and top of lower box.
    gapKey: string;
    // Minimum y-coordinate (scroll-space) for this arc's midY: just below the bottom edge of the
    // upper box so the arc's horizontal segment never rides above its own origin. Level-0 arcs sit
    // here and deeper levels step downward from it.
    minMidY: number;
    // Bottom edge (scroll-space) of the upper box; the gap's reserved height is measured from here.
    upperBottom: number;
    // Height (px) that the lower row's tallest same-row arc protrudes upward from b.top. The cross-
    // row arc stack must end at least one ARC_LEVEL_STEP above this so it never overlaps those arcs.
    lowerRowProtrusion: number;
  };

  const paths: ArcPath[] = [];
  const crossRowDescriptors: CrossRowDescriptor[] = [];

  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    /* v8 ignore next -- levelByPhraseId always has an entry for every multi-box phrase */
    const level = levelByPhraseId.get(phraseId) ?? 0;
    const stem = ARC_BASE_STEM + level * ARC_LEVEL_STEP;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      const sameRow = Math.abs(a.top - b.top) < a.height / 2;
      if (sameRow) {
        const { d, midX, midY } = buildSameRowArcPath(a, b, stem);
        paths.push({ phraseId, d, midX, midY, splitAfterTokenRef: boxes[i].lastTokenRef });
      } else {
        const { midX } = routeAroundBoxes(a, b, allBoxRects, (a.bottom + b.top) / 2);
        // The lower row's highest same-row arc peaks at b.top minus its protrusion height. The
        // cross-row arc must sit one ARC_LEVEL_STEP above that peak so they don't overlap.
        const lowerRowMaxLevel = maxLevelByRowTop.get(Math.round(b.top)) ?? -1;
        const lowerRowProtrusion =
          lowerRowMaxLevel >= 0
            ? ARC_BASE_STEM + lowerRowMaxLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
            : 0;
        crossRowDescriptors.push({
          phraseId,
          a,
          b,
          midX,
          splitAfterTokenRef: boxes[i].lastTokenRef,
          gapKey: `${Math.round(a.bottom)}_${Math.round(b.top)}`,
          // Floor for this arc's horizontal segment: it must dip below the bottom edge of the upper
          // box it springs from, otherwise the arc's top renders above its own origin. Stacking
          // starts here and steps downward per nesting level.
          minMidY: a.bottom + CROSS_ROW_ARC_CLEARANCE,
          upperBottom: a.bottom,
          lowerRowProtrusion,
        });
      }
    }
  });

  // Second pass: assign a vertical level within each inter-row gap so arcs don't overlap, then
  // build final paths with spread midY values.
  //
  // Within a gap, two cross-row arcs conflict when their x-spans (from cx_a to cx_b) overlap. Use
  // the same greedy coloring approach as assignPhraseLevels.
  const crossRowByGap = new Map<string, CrossRowDescriptor[]>();
  crossRowDescriptors.forEach((desc) => {
    const list = crossRowByGap.get(desc.gapKey) ?? [];
    list.push(desc);
    crossRowByGap.set(desc.gapKey, list);
  });

  let requiredRowGapPx = 0;

  crossRowByGap.forEach((gapArcs) => {
    // Assign levels within this gap by greedy interval coloring on x-span overlap.
    const levels = new Map<CrossRowDescriptor, number>();
    gapArcs.forEach((desc) => {
      const dLeft = Math.min((desc.a.left + desc.a.right) / 2, (desc.b.left + desc.b.right) / 2);
      const dRight = Math.max((desc.a.left + desc.a.right) / 2, (desc.b.left + desc.b.right) / 2);
      const usedLevels = new Set<number>();
      gapArcs.forEach((other) => {
        if (other === desc) return;
        const oLeft = Math.min(
          (other.a.left + other.a.right) / 2,
          (other.b.left + other.b.right) / 2,
        );
        const oRight = Math.max(
          (other.a.left + other.a.right) / 2,
          (other.b.left + other.b.right) / 2,
        );
        if (oLeft < dRight && oRight > dLeft) {
          const otherLevel = levels.get(other);
          if (otherLevel !== undefined) usedLevels.add(otherLevel);
        }
      });
      let level = 0;
      while (usedLevels.has(level)) level += 1;
      levels.set(desc, level);
    });

    // gapArcs is always non-empty here (the map only contains keys with ≥ 1 entry), so the
    // fallback branch is unreachable — defensive guard only.
    /* v8 ignore next */
    const maxGapLevel = gapArcs.length > 0 ? Math.max(...[...levels.values()]) : 0;

    // The floor for all midY values in this gap: the lowest minMidY across all arcs sharing it (so
    // every arc clears the bottom edge of its own upper box). Level-0 arcs sit here; deeper levels
    // step downward (increasing y) from it so the arc always springs out below its origin box.
    /* v8 ignore next -- gapArcs is non-empty; Math.max over a non-empty array always yields a number */
    const gapMinMidY = Math.max(...gapArcs.map((d) => d.minMidY));

    // Tallest same-row arc protruding up from the lower row across this gap's arcs. These arcs
    // occupy the bottom `gapLowerRowProtrusion` band of the gap; the cross-row stack must stay one
    // CROSS_ROW_ARC_CLEARANCE above that band so the two never touch.
    /* v8 ignore next -- gapArcs is non-empty; Math.max over a non-empty array always yields a number */
    const gapLowerRowProtrusion = Math.max(...gapArcs.map((d) => d.lowerRowProtrusion));
    /* v8 ignore next -- gapArcs is non-empty; Math.min over a non-empty array always yields a number */
    const gapUpperBottom = Math.min(...gapArcs.map((d) => d.upperBottom));

    // Deepest arc sits this far below the upper boxes. Below it the gap must still fit one
    // CROSS_ROW_ARC_CLEARANCE separation slot plus the lower row's protruding same-row arcs.
    // Measuring from gapUpperBottom keeps requiredRowGapPx in sync with where the stack is actually
    // drawn, so once the CSS gap widens to this value no arc ever needs clamping above its origin
    // box. The single uniform clearance below the stack also matches the spacing between stacked
    // arcs, so there's no leftover empty slot between the cross-row stack and the lower-row arcs.
    const deepestMidY = gapMinMidY + maxGapLevel * CROSS_ROW_ARC_CLEARANCE;
    const neededGap =
      deepestMidY - gapUpperBottom + CROSS_ROW_ARC_CLEARANCE + gapLowerRowProtrusion;
    if (neededGap > requiredRowGapPx) requiredRowGapPx = neededGap;

    // Spread midY values: start from gapMinMidY (just below the upper boxes) and step downward
    // (increasing y) per level so arcs stack within the gap without rising above their origins. No
    // upper clamp — requiredRowGapPx reserves enough room that the whole stack fits below b.top.
    gapArcs.forEach((desc) => {
      /* v8 ignore next -- levels.set is called for every desc above, so get() never returns undefined */
      const level = levels.get(desc) ?? 0;
      const spreadMidY = gapMinMidY + level * CROSS_ROW_ARC_CLEARANCE;
      const { d, midX, midY } = routeAroundBoxes(desc.a, desc.b, allBoxRects, spreadMidY);
      paths.push({
        phraseId: desc.phraseId,
        d,
        midX,
        midY,
        splitAfterTokenRef: desc.splitAfterTokenRef,
      });
    });
  });

  const maxLevel = levelByPhraseId.size > 0 ? Math.max(...levelByPhraseId.values()) : 0;

  return { paths, levelByPhraseId, maxLevel, requiredRowGapPx };
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
 * the scroll container's content origin). The horizontal mid-section sits at the vertical centre of
 * the gap between rows so it never overlaps the boxes above or below.
 *
 * @param a - Scroll-space rect of the earlier (upper) box.
 * @param b - Scroll-space rect of the later (lower) box.
 * @returns Object containing the SVG path `d` attribute string and the arc's visual midpoint.
 */
export function buildCrossRowArcPath(
  a: { left: number; right: number; bottom: number },
  b: { left: number; right: number; top: number },
): { d: string; midX: number; midY: number } {
  const r = ARC_CORNER_RADIUS;
  const cx1 = (a.left + a.right) / 2;
  const y1 = a.bottom;
  const cx2 = (b.left + b.right) / 2;
  const y2 = b.top;
  const mid = (y1 + y2) / 2;
  const ltr = cx2 >= cx1;
  const nudge = Math.max(0, 2 * r - Math.abs(cx2 - cx1)) / 2;
  const tx1 = cx1 + (ltr ? -nudge : nudge);
  const tx2 = cx2 + (ltr ? nudge : -nudge);
  const dx = ltr ? r : -r;
  const sw1 = ltr ? 0 : 1;
  const sw2 = ltr ? 1 : 0;
  const midX = (tx1 + tx2) / 2;
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
 * @param midY - Vertical midpoint for the horizontal crossing segment. Defaults to the centre of
 *   the gap between `a` and `b`. Pass an explicit value to spread multiple arcs through the same
 *   gap so they don't overlap.
 * @returns Object containing the SVG path `d` attribute string and the arc's visual midpoint.
 */
export function routeAroundBoxes(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
  obstacles: { left: number; right: number; top: number; bottom: number }[],
  midY: number = (a.bottom + b.top) / 2,
): { d: string; midX: number; midY: number } {
  const r = ARC_CORNER_RADIUS;
  const cx1 = (a.left + a.right) / 2;
  const y1 = a.bottom;
  const cx2 = (b.left + b.right) / 2;
  const y2 = b.top;

  // Boxes whose vertical range overlaps the arc's interior span (exclusive of a and b themselves).
  const relevant = obstacles
    .filter((obs) => obs !== a && obs !== b && obs.top < y1 && obs.bottom > y2)
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
