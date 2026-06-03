import type { PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import type { PhraseMode } from '../types/phrase-mode';

// #region Constants

/**
 * Half the height of a floating phrase-controls pill (px). The pill is centred on the line it rides
 * (arc top, or box top when no arc), so only this half extends above into the top-padding zone.
 */
export const CONTROLS_HALF_HEIGHT_PX = 10;

/** Base stem height (px) for arc connectors at nesting level 0. */
export const ARC_BASE_STEM = 10;

/** Additional stem height (px) added per nesting level so interleaved arcs don't overlap. */
export const ARC_LEVEL_STEP = 10;

/** Corner radius (px) used in all arc bracket paths. */
export const ARC_CORNER_RADIUS = 5;

/** Extra breathing room (px) above the topmost arc run so its corner doesn't graze the boundary. */
export const ARC_CLEARANCE_MARGIN_PX = 4;

/**
 * Horizontal distance (px) from the content edge to the first gutter lane, where cross-row arcs
 * drop their vertical leg. Wide enough to clear the box border and keep the descent outside the
 * columns.
 */
export const GUTTER_MARGIN_PX = 10;

/** Horizontal spacing (px) between adjacent gutter lanes; one lane further out per gutter level. */
export const GUTTER_LANE_STEP = 10;

// #endregion

// #region Phrase split utilities

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
 * Sorts token snapshots by flat document index so a stored phrase token list reflects visual
 * left-to-right order. Shared by every path that slices a phrase so document order is computed
 * identically everywhere. Tokens missing from `tokenDocOrder` sort to the front (index 0).
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
 * Sorts a phrase's tokens into document order and slices them at the boundary just after
 * `splitAfterTokenRef`. The single source of this slice, read by both {@link computeSplitFreeRefs}
 * and {@link splitPhraseAtBoundary}, so the destructive-border preview can't drift from the split it
 * previews.
 *
 * @param tokens - The phrase's token snapshots. Not mutated.
 * @param splitAfterTokenRef - Token ref marking the end of the earlier fragment (`before`).
 * @param tokenDocOrder - Map from token ref to flat document index; tokens are ordered by this
 *   before slicing.
 * @returns The `before` half (up to and including the boundary token) and the `after` remainder, or
 *   `undefined` when the boundary token is not found.
 */
function sliceAtBoundary(
  tokens: readonly TokenSnapshot[],
  splitAfterTokenRef: string,
  tokenDocOrder: ReadonlyMap<string, number>,
): { before: TokenSnapshot[]; after: TokenSnapshot[] } | undefined {
  const ordered = sortByDocOrder(tokens, tokenDocOrder);
  const idx = ordered.findIndex((t) => t.tokenRef === splitAfterTokenRef);
  if (idx < 0) return undefined;
  const boundary = idx + 1;
  return { before: ordered.slice(0, boundary), after: ordered.slice(boundary) };
}

/**
 * Enumerates the tokens of `phraseLink` that would become solo (free) after splitting just after
 * `splitAfterTokenRef` — a half with exactly one token leaves it unattached. Shares
 * {@link sliceAtBoundary} with {@link splitPhraseAtBoundary} so the destructive-border preview
 * matches the resulting split.
 *
 * @param phraseLink - The phrase to split, or `undefined` when it cannot be resolved.
 * @param splitAfterTokenRef - Token ref marking the end of the earlier fragment.
 * @param tokenDocOrder - Map from token ref to flat document index; tokens are ordered by this
 *   before slicing.
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
  const slice = sliceAtBoundary(phraseLink.tokens, splitAfterTokenRef, tokenDocOrder);
  if (!slice) return undefined;
  const { before, after } = slice;
  const freeRefs: string[] = [];
  if (before.length === 1) freeRefs.push(before[0].tokenRef);
  if (after.length === 1) freeRefs.push(after[0].tokenRef);
  return freeRefs.length > 0 ? freeRefs : undefined;
}

/**
 * Splits `phraseLink` just after `splitAfterTokenRef` and dispatches the resulting
 * create/update/delete calls. Shared by both views' arc-split buttons and TokenLinkIcon's unlink
 * button so the three paths can't drift apart.
 *
 * Outcomes (`before` is the half up to and including `splitAfterTokenRef`, `after` the remainder):
 *
 * - Both halves ≤ 1 token → delete the phrase (only 2 tokens to begin with).
 * - Both halves ≥ 2 tokens → shrink the phrase to `before`, create a new phrase from `after`.
 * - Exactly one half has 1 token → shrink the phrase to the larger half; the solo token becomes free.
 *
 * The boundary is in document order (how the buttons present it), so tokens are sorted by
 * `tokenDocOrder` before slicing — correct even if the stored list is out of order. No-op when
 * `splitAfterTokenRef` is absent or is the last token (which would leave the phrase unchanged).
 *
 * @param phraseLink - The phrase link to split.
 * @param splitAfterTokenRef - Token ref of the last token to keep in the earlier fragment.
 * @param dispatch - Phrase create/update/delete callbacks.
 * @param tokenDocOrder - Map from token ref to flat document index. Defaults to empty (stored
 *   order).
 */
export function splitPhraseAtBoundary(
  phraseLink: PhraseAnalysisLink,
  splitAfterTokenRef: string,
  dispatch: SplitPhraseDispatch,
  tokenDocOrder: ReadonlyMap<string, number> = new Map(),
): void {
  const slice = sliceAtBoundary(phraseLink.tokens, splitAfterTokenRef, tokenDocOrder);
  if (!slice) return;
  const { before, after } = slice;
  // Splitting after the last token leaves the phrase unchanged but still dispatches an update +
  // triggers `onSave`. Defensive (callers only place buttons between boxes) but avoids a stray write.
  if (after.length === 0) return;
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

// #endregion

// #region Arc geometry and strip sizing

/**
 * Stem height (px) an arc run rises above its box top at a given nesting level: the base stem plus
 * one {@link ARC_LEVEL_STEP} per level. The single source of this formula, so same-row and cross-row
 * runs at the same level share a channel (see {@link buildSameRowArcPath} /
 * {@link buildCrossRowArcPath}).
 *
 * @param level - The run's nesting level (0 = outermost).
 * @returns The stem height in pixels.
 */
function stemForLevel(level: number): number {
  return ARC_BASE_STEM + level * ARC_LEVEL_STEP;
}

/**
 * Vertical room (px) the topmost arc run at `maxArcLevel` needs above the line it rises from: its
 * stem ({@link stemForLevel}), the corner, and the clearance margin. Shared by
 * {@link computeStripTopPadding} and {@link computeStripRowGap} so both grow with arc depth alike.
 *
 * @param maxArcLevel - Maximum arc nesting level among the visible arcs.
 * @returns The clearance height in pixels.
 */
function arcClearancePx(maxArcLevel: number): number {
  return stemForLevel(maxArcLevel) + ARC_CORNER_RADIUS + ARC_CLEARANCE_MARGIN_PX;
}

/**
 * Top padding (px) a token strip needs so arcs and the floating controls pill both fit above the
 * boxes: {@link arcClearancePx} when any arc is drawn, plus controls headroom.
 *
 * The pill rides the arc top (or box top for contiguous phrases) with its upper half extending
 * above; on box-top phrases it sits at `top: -CONTROLS_HALF_HEIGHT_PX`, so the strip needs `2 *
 * CONTROLS_HALF_HEIGHT_PX` to keep the whole pill visible.
 *
 * @param hasArcs - Whether at least one arc is currently drawn.
 * @param maxArcLevel - Maximum arc nesting level among the visible arcs.
 * @param hasRealPhrase - Whether any committed phrase is rendered in the current window.
 * @returns The required top padding in pixels, with a floor of {@link ARC_LEVEL_STEP}.
 */
export function computeStripTopPadding(
  hasArcs: boolean,
  maxArcLevel: number,
  hasRealPhrase: boolean,
): number {
  const arcPadding = hasArcs ? arcClearancePx(maxArcLevel) : 0;
  const controlsHeadroom = hasRealPhrase ? 2 * CONTROLS_HALF_HEIGHT_PX : 0;
  return Math.max(ARC_LEVEL_STEP, arcPadding + controlsHeadroom);
}

/**
 * Default vertical gap (px) between wrapped token rows when no arc needs extra clearance. Matches
 * the `gap-y-6` (1.5rem) in the `token-row` utility so the non-arc layout is unchanged; used as the
 * floor of {@link computeStripRowGap}.
 */
export const BASE_ROW_GAP_PX = 24;

/**
 * Vertical gap (px) between wrapped token rows so arcs above a lower row clear the boxes of the row
 * above. Where {@link computeStripTopPadding} only protects the topmost row, this protects every
 * inter-row gap: a run in a lower row rises {@link arcClearancePx} above its box top into the shared
 * gap, and the controls pill's upper half rides on top of that. Floored at {@link BASE_ROW_GAP_PX}
 * so shallow/absent arcs never pack rows tighter than the static layout.
 *
 * @param hasArcs - Whether at least one arc is currently drawn.
 * @param maxArcLevel - Maximum arc nesting level among the visible arcs.
 * @param hasRealPhrase - Whether any committed phrase is rendered (so a controls pill may ride the
 *   arc top of a lower row).
 * @returns The required inter-row vertical gap in pixels, never below {@link BASE_ROW_GAP_PX}.
 */
export function computeStripRowGap(
  hasArcs: boolean,
  maxArcLevel: number,
  hasRealPhrase: boolean,
): number {
  if (!hasArcs) return BASE_ROW_GAP_PX;
  const controlsHeadroom = hasRealPhrase ? CONTROLS_HALF_HEIGHT_PX : 0;
  return Math.max(BASE_ROW_GAP_PX, arcClearancePx(maxArcLevel) + controlsHeadroom);
}

// #endregion

// #region Arc stroke styling

/** Stroke styling for a single phrase arc; consumed directly as SVG `<path>` attributes. */
export type ArcStrokeProps = {
  /** SVG `stroke` value — a CSS color expression. */
  stroke: string;
  /** SVG `stroke-opacity`. */
  strokeOpacity: number;
  /** SVG `stroke-width` in user units. */
  strokeWidth: number;
};

/** Faint border-color stroke for an arc that is neither focused nor hovered. */
const DIMMED_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--border)',
  strokeOpacity: 0.5,
  strokeWidth: 2,
};

/** Destructive stroke for the targeted arc in `confirm-unlink` mode. */
const DESTRUCTIVE_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--destructive)',
  strokeOpacity: 1,
  strokeWidth: 2,
};

/** Mid-white stroke for a hovered-but-not-focused arc in `view` mode. */
const HOVERED_ARC_STROKE: ArcStrokeProps = { stroke: 'white', strokeOpacity: 0.55, strokeWidth: 2 };

/** Full-white stroke for the focused (or edited) arc. */
const HIGHLIGHTED_ARC_STROKE: ArcStrokeProps = {
  stroke: 'white',
  strokeOpacity: 1,
  strokeWidth: 2,
};

/**
 * Stroke styling for a phrase arc, so both views render lines identically across interaction modes:
 *
 * - `confirm-unlink`: target arc destructive, others dimmed.
 * - `edit`: edited arc white (matches its box ring), others dimmed, hover suppressed.
 * - `view`: focused arc full-white, hovered arc mid-white, others border-color.
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
  if (phraseMode.kind === 'confirm-unlink') {
    return phraseId === phraseMode.phraseId ? DESTRUCTIVE_ARC_STROKE : DIMMED_ARC_STROKE;
  }
  if (phraseMode.kind === 'edit') {
    return phraseId === phraseMode.phraseId ? HIGHLIGHTED_ARC_STROKE : DIMMED_ARC_STROKE;
  }
  // view mode
  if (phraseId === focusedPhraseId) return HIGHLIGHTED_ARC_STROKE;
  if (phraseId === hoveredPhraseId) return HOVERED_ARC_STROKE;
  return DIMMED_ARC_STROKE;
}

// #endregion

// #region Arc path computation

/**
 * A single horizontal run of a phrase arc, used for nesting-level assignment. Every arc is a top
 * bracket whose run sits in the top channel of its **upper** row, so a segment is its row plus the
 * x-extent its run occupies there — that extent is what can collide with other runs on the
 * channel.
 *
 * A same-row run spans between the two box centres; a cross-row run spans only from its box centre
 * out to the side gutter (the descent happens off in the gutter, not across to the other column).
 */
export type ArcSegment = {
  /** The phrase this segment belongs to. */
  phraseId: string;
  /**
   * Rounded scroll-space top of the segment's **upper** row — the row whose top channel its
   * horizontal run occupies. Two segments only conflict when they share this row.
   */
  row: number;
  /** Leftmost x the run occupies on its channel. */
  left: number;
  /** Rightmost x the run occupies on its channel. */
  right: number;
};

/**
 * Greedy interval-graph colouring shared by {@link assignSegmentLevels} and
 * {@link assignGutterLanes}: walks `items` in order, giving each the lowest level not already taken
 * by an earlier item it `conflicts` with. The two wrappers differ only in their pre-sort and
 * conflict predicate (which axis they overlap on).
 *
 * @param items - The items to colour, pre-sorted into the order they should be assigned.
 * @param conflicts - Returns whether two items overlap and so must take different levels.
 * @returns Map from each item to its assigned level. 0 is the level nearest the boxes — outermost
 *   nesting for segments, the lane nearest the content edge for descents.
 */
function assignLevels<T>(items: readonly T[], conflicts: (a: T, b: T) => boolean): Map<T, number> {
  const levels = new Map<T, number>();
  items.forEach((item) => {
    const usedLevels = new Set<number>();
    items.forEach((other) => {
      if (other === item || !conflicts(item, other)) return;
      const otherLevel = levels.get(other);
      if (otherLevel !== undefined) usedLevels.add(otherLevel);
    });
    let level = 0;
    while (usedLevels.has(level)) level += 1;
    levels.set(item, level);
  });
  return levels;
}

/**
 * Assigns a nesting level to every arc run. Two segments conflict when they share a row and their
 * x-spans overlap, since arc runs only collide within a row's shared top channel; runs on different
 * rows never conflict even when their x-spans overlap.
 *
 * Each run is levelled on its own — a cross-row arc's upper and lower runs are coloured
 * independently against their respective rows — so an inter-row arc's bottom run rises only as far
 * as its own row's overlaps demand. Cross-row runs share the same top channel as same-row runs (not
 * an inter-row gap), so the two kinds do conflict when they share a row, keeping rerouted arcs
 * aware of the same-row brackets they cross.
 *
 * @param segments - All arc segments across every phrase.
 * @returns Map from each segment to its assigned nesting level (0 = outermost).
 */
export function assignSegmentLevels(segments: ArcSegment[]): Map<ArcSegment, number> {
  const ordered = [...segments].sort((a, b) => a.left - b.left || a.right - b.right);
  return assignLevels(ordered, (a, b) => a.row === b.row && a.left < b.right && a.right > b.left);
}

/**
 * The vertical descent of a cross-row arc through a side gutter, used for gutter-lane assignment.
 * Two descents on the same `side` whose `[top, bottom]` spans overlap collide if routed down one
 * lane, so they get different lanes.
 *
 * This is a separate axis from {@link ArcSegment} levelling, which deconflicts the horizontal runs.
 * A descent nested vertically inside a wider one (e.g. C..D inside A..F) shares no run row with it,
 * so segment levels never separate them — only this lane assignment does.
 */
export type GutterDescent = {
  /** Which side gutter the descent travels down; descents on different sides never conflict. */
  side: 'left' | 'right';
  /** Topmost y the descent occupies (the upper run line). */
  top: number;
  /** Bottommost y the descent occupies (the lower run line). */
  bottom: number;
};

/**
 * Assigns a lane to every cross-row gutter descent — the vertical-axis counterpart to
 * {@link assignSegmentLevels}: two descents conflict when they route down the same side and their
 * `[top, bottom]` spans overlap. Catches the vertically-nested case (C..D inside A..F) that per-row
 * segment levels miss, since a descent's two run lines never share a top channel.
 *
 * @param descents - All cross-row gutter descents across every phrase.
 * @returns Map from each descent to its assigned lane (0 = nearest the content edge).
 */
export function assignGutterLanes(descents: GutterDescent[]): Map<GutterDescent, number> {
  const ordered = [...descents].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  return assignLevels(ordered, (a, b) => a.side === b.side && a.top < b.bottom && a.bottom > b.top);
}

/** A computed arc path entry for a single segment between two phrase boxes. */
export type ArcPath = {
  /** The phrase this arc segment belongs to. */
  phraseId: string;
  /** SVG `<path>` `d` attribute drawing the arc in scroll-space coordinates. */
  d: string;
  /** Scroll-space x coordinate of the arc's visual midpoint, used to position the split button. */
  midX: number;
  /** Scroll-space y coordinate of the arc's visual midpoint, used to position the split button. */
  midY: number;
  /**
   * Leftmost x of the arc's horizontal run line (the channel the split button slides along). Used
   * to keep a button within its own run when {@link deconflictSplitButtons} shifts it off a
   * collision.
   */
  runLeft: number;
  /** Rightmost x of the arc's horizontal run line; the right bound for button shifting. */
  runRight: number;
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
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxLevel: number;
  /**
   * Horizontal padding (px) the strip must reserve on its left so the leftmost cross-row gutter
   * lane isn't clipped or crowded against neighbouring content. Zero when nothing routes down the
   * left.
   */
  leftPadding: number;
  /**
   * Horizontal padding (px) the strip must reserve on its right, mirroring {@link leftPadding} for
   * arcs routed down the right gutter. Zero when nothing routes down the right.
   */
  rightPadding: number;
};

/** A phrase-box rect expressed relative to the arc container's top-left corner. */
type ContainerRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

/**
 * Converts a viewport-relative `DOMRect` to container-relative coordinates.
 *
 * @param rect - The viewport-relative bounding rect of a phrase-box element.
 * @param containerRect - The viewport-relative bounding rect of the arc container.
 * @returns The same rect with every edge expressed relative to the container's top-left corner.
 */
function toContainerSpace(rect: DOMRect, containerRect: DOMRect): ContainerRect {
  const left = rect.left - containerRect.left;
  const right = rect.right - containerRect.left;
  const top = rect.top - containerRect.top;
  const bottom = rect.bottom - containerRect.top;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/**
 * One box-pair of a phrase, resolved enough to assign nesting levels, as a discriminated union on
 * `sameRow`. A same-row bracket has a single run between the two box centres on their shared row
 * (`seg`); a cross-row bracket has two independently-levelled runs — one on each row, each reaching
 * from that row's box centre out to the chosen side gutter (`upperSeg`/`lowerSeg`) — plus the side
 * it routes down (`nearerLeft`, computed from the arc's average x, independent of level). The
 * second pass reads each run's own assigned level from these stored segments.
 */
type PairDescriptor = {
  phraseId: string;
  a: ContainerRect;
  b: ContainerRect;
  splitAfterTokenRef: string;
} & (
  | { sameRow: true; seg: ArcSegment }
  | { sameRow: false; nearerLeft: boolean; upperSeg: ArcSegment; lowerSeg: ArcSegment }
);

/**
 * Resolves one consecutive box-pair of a phrase into a {@link PairDescriptor}, deciding same-row vs.
 * cross-row and emitting the level-assignment segment(s) the second pass will read back. A
 * cross-row run's extent is box centre → side gutter, NOT across to the other box's column, so an
 * arc nested inside a wider phrase but routed out the opposite side doesn't conflict.
 *
 * @param phraseId - The phrase the pair belongs to.
 * @param a - Container-space rect of the earlier box.
 * @param b - Container-space rect of the later box.
 * @param splitAfterTokenRef - Token ref of the last token in box `a` (where a split would cut).
 * @param contentLeft - Container-space x of the strip's left content edge (left gutter anchor).
 * @param contentRight - Container-space x of the strip's right content edge (right gutter anchor).
 * @returns The resolved descriptor, with its segment(s) embedded for later level lookup.
 */
function describeBoxPair(
  phraseId: string,
  a: ContainerRect,
  b: ContainerRect,
  splitAfterTokenRef: string,
  contentLeft: number,
  contentRight: number,
): PairDescriptor {
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  if (Math.abs(a.top - b.top) < a.height / 2) {
    const seg: ArcSegment = {
      phraseId,
      row: Math.round(a.top),
      left: Math.min(x1, x2),
      right: Math.max(x1, x2),
    };
    return { phraseId, a, b, splitAfterTokenRef, sameRow: true, seg };
  }
  // Side is geometric (average x vs content edges) and independent of level, so it can be fixed
  // here, before levels exist. Tie favours the left.
  const midpointX = (x1 + x2) / 2;
  const nearerLeft = midpointX - contentLeft <= contentRight - midpointX;
  // A cross-row bracket has TWO runs — one per row's top channel — joined by a gutter descent. Each
  // can collide independently on its own row, so emit a segment for both and level them separately;
  // otherwise the bottom run's height would track the upper run's overlaps. Each run spans from its
  // box centre to the chosen side edge (the lane sits just past it).
  const sideX = nearerLeft ? contentLeft : contentRight;
  const upperSeg: ArcSegment = {
    phraseId,
    row: Math.round(Math.min(a.top, b.top)),
    left: Math.min(x1, sideX),
    right: Math.max(x1, sideX),
  };
  const lowerSeg: ArcSegment = {
    phraseId,
    row: Math.round(Math.max(a.top, b.top)),
    left: Math.min(x2, sideX),
    right: Math.max(x2, sideX),
  };
  return { phraseId, a, b, splitAfterTokenRef, sameRow: false, nearerLeft, upperSeg, lowerSeg };
}

/**
 * Container-relative measurements of every phrase box in the strip, read once up front so the two
 * arc-building passes share a single layout snapshot.
 */
type PhraseBoxMeasurements = {
  /** Each phrase's boxes (left-to-right) with the ref of its last token, keyed by phrase id. */
  boxesByPhrase: Map<string, { rect: ContainerRect; lastTokenRef: string }[]>;
  /** Container-space x of the strip's left content edge (left gutter anchor); 0 when no boxes. */
  contentLeft: number;
  /** Container-space x of the strip's right content edge (right gutter anchor); 0 when no boxes. */
  contentRight: number;
  /**
   * Maps a box's top edge to its row's top line — the highest (minimum) top among boxes sharing the
   * box's row band. Cross-row arcs anchor each endpoint here rather than at its own box top, so a
   * gloss-less box of differing height still meets the channel shared by its row-mates.
   *
   * @param boxTop - The top edge of the box whose row top line is wanted.
   * @param height - The box height, defining the half-band tolerance for matching the row.
   * @returns The minimum top across boxes on the same row, never greater than `boxTop`.
   */
  rowTopFor: (boxTop: number, height: number) => number;
};

/**
 * Reads every `[data-phrase-box]` element inside `container` once and projects it into the
 * container-relative measurements both arc passes need: per-phrase box lists, the strip's content
 * extent, and the row-top lookup. Splitting this off keeps {@link computeAllArcPaths} a pipeline of
 * named phases (measure → describe → level → build) rather than one long function.
 *
 * @param container - The arc container element to search.
 * @returns The measured phrase boxes, content edges, and row-top lookup.
 */
function measurePhraseBoxes(container: Element): PhraseBoxMeasurements {
  const containerRect = container.getBoundingClientRect();

  const boxesByPhrase = new Map<string, { rect: ContainerRect; lastTokenRef: string }[]>();
  container.querySelectorAll('[data-phrase-box="true"][data-phrase-id]').forEach((el) => {
    const id = el.getAttribute('data-phrase-id');
    /* v8 ignore next -- selector already requires data-phrase-id to exist */
    if (!id) return;
    const lastTokenRef = el.getAttribute('data-last-token-ref') ?? '';
    const rect = toContainerSpace(el.getBoundingClientRect(), containerRect);
    const list = boxesByPhrase.get(id) ?? [];
    list.push({ rect, lastTokenRef });
    boxesByPhrase.set(id, list);
  });

  const allBoxRects = [...container.querySelectorAll('[data-phrase-box="true"]')].map((el) =>
    el.getBoundingClientRect(),
  );
  const allTops = allBoxRects.map((r) => r.top - containerRect.top);
  const rowTopFor = (boxTop: number, height: number): number => {
    const band = height / 2;
    let top = boxTop;
    allTops.forEach((t) => {
      if (Math.abs(t - boxTop) < band && t < top) top = t;
    });
    return top;
  };

  // Strip content extent; cross-row arcs drop their vertical leg in a gutter just outside it. The
  // SVG layer is `overflow: visible`, so drawing past the content box is fine. The 0 fallback is
  // unread (no cross-row arc is built with < 2 boxes).
  /* v8 ignore next -- empty fallback: cross-row arcs are only built when ≥ 2 boxes exist */
  const contentLeft = allBoxRects.length
    ? Math.min(...allBoxRects.map((r) => r.left - containerRect.left))
    : 0;
  /* v8 ignore next -- empty fallback: cross-row arcs are only built when ≥ 2 boxes exist */
  const contentRight = allBoxRects.length
    ? Math.max(...allBoxRects.map((r) => r.right - containerRect.left))
    : 0;

  return { boxesByPhrase, contentLeft, contentRight, rowTopFor };
}

/**
 * Measures all `[data-phrase-box]` elements inside `container` and computes SVG arc paths (in
 * container-relative coordinates) connecting each phrase's discontiguous boxes — same-row upward
 * brackets and cross-row brackets. Same-row arcs are levelled so they don't overlap; cross-row arcs
 * rise into the upper row's top channel then drop down a side gutter (the side nearer the arc's
 * average x, ties left), one lane further out per descent overlap so legs never cross a box.
 *
 * @param container - The arc container element to search.
 * @returns The arc paths, max nesting level, and the left/right padding to reserve for gutter
 *   lanes.
 */
export function computeAllArcPaths(container: Element): ArcState {
  const { boxesByPhrase, contentLeft, contentRight, rowTopFor } = measurePhraseBoxes(container);

  // First pass: resolve each consecutive box-pair into a descriptor and collect the segment(s) it
  // emits for level assignment — one for a same-row bracket, two (upper + lower run) for a cross-row
  // one. See {@link describeBoxPair} for how each segment's extent is chosen.
  const descriptors: PairDescriptor[] = [];
  const segments: ArcSegment[] = [];
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    for (let i = 0; i < boxes.length - 1; i++) {
      const descriptor = describeBoxPair(
        phraseId,
        boxes[i].rect,
        boxes[i + 1].rect,
        boxes[i].lastTokenRef,
        contentLeft,
        contentRight,
      );
      descriptors.push(descriptor);
      if (descriptor.sameRow) segments.push(descriptor.seg);
      else segments.push(descriptor.upperSeg, descriptor.lowerSeg);
    }
  });

  const segmentLevels = assignSegmentLevels(segments);
  // Deepest nesting level across every run; sizes the strip's top padding.
  const maxLevel = segmentLevels.size > 0 ? Math.max(...segmentLevels.values()) : 0;
  /**
   * Reads a segment's assigned nesting level.
   *
   * @param seg - The segment whose level is wanted; always present, having been levelled above.
   * @returns The segment's nesting level (0 = outermost).
   */
  const levelOf = (seg: ArcSegment): number =>
    /* v8 ignore next -- every descriptor stores segments that were passed to assignSegmentLevels */
    segmentLevels.get(seg) ?? 0;

  const paths: ArcPath[] = [];
  // Track how far the outermost cross-row gutter lane extends past each content edge so the caller
  // can reserve matching horizontal padding. Stays 0 when nothing routes down that side.
  let leftPadding = 0;
  let rightPadding = 0;

  // Same-row brackets need no inter-arc gutter coordination, so build them directly.
  descriptors.forEach((descriptor) => {
    if (!descriptor.sameRow) return;
    const { phraseId, a, b, splitAfterTokenRef } = descriptor;
    const stem = stemForLevel(levelOf(descriptor.seg));
    const { d, midX, midY, runLeft, runRight } = buildSameRowArcPath(a, b, stem);
    paths.push({ phraseId, d, midX, midY, runLeft, runRight, splitAfterTokenRef });
  });

  // Cross-row arcs route down a side gutter. A descent's extent depends on each run's stem, so
  // resolve the geometry first, build a GutterDescent per arc, then colour those into lanes. The
  // lane (not the run level) drives the gutter offset, so vertically-nested arcs (C..D inside A..F)
  // take different lanes. Endpoints anchor on each row's top line via rowTopFor.
  const crossRowGeometries = descriptors.flatMap((descriptor) => {
    if (descriptor.sameRow) return [];
    const { phraseId, a, b, splitAfterTokenRef, nearerLeft, upperSeg, lowerSeg } = descriptor;
    const aStem = stemForLevel(levelOf(upperSeg));
    const bStem = stemForLevel(levelOf(lowerSeg));
    const aTop = rowTopFor(a.top, a.height);
    const bTop = rowTopFor(b.top, b.height);
    // The descent spans from the upper run line down to the lower run line.
    const descent: GutterDescent = {
      side: nearerLeft ? 'left' : 'right',
      top: aTop - aStem,
      bottom: bTop - bStem,
    };
    return [{ phraseId, a, b, splitAfterTokenRef, aStem, bStem, aTop, bTop, nearerLeft, descent }];
  });

  const gutterLanes = assignGutterLanes(crossRowGeometries.map((g) => g.descent));
  crossRowGeometries.forEach((geom) => {
    const { phraseId, a, b, splitAfterTokenRef, aStem, bStem, aTop, bTop, nearerLeft } = geom;
    /* v8 ignore next -- every descent was passed to assignGutterLanes, so get() is always defined */
    const lane = gutterLanes.get(geom.descent) ?? 0;
    const laneOffset = GUTTER_MARGIN_PX + lane * GUTTER_LANE_STEP;
    const gutterX = nearerLeft ? contentLeft - laneOffset : contentRight + laneOffset;
    // The lane extends `laneOffset` past the content edge; reserve that much padding on its side.
    if (nearerLeft) leftPadding = Math.max(leftPadding, laneOffset);
    else rightPadding = Math.max(rightPadding, laneOffset);
    const { d, midX, midY, runLeft, runRight } = buildCrossRowArcPath(
      { left: a.left, right: a.right, top: aTop },
      { left: b.left, right: b.right, top: bTop },
      aStem,
      bStem,
      gutterX,
    );
    paths.push({ phraseId, d, midX, midY, runLeft, runRight, splitAfterTokenRef });
  });

  deconflictSplitButtons(paths);

  return { paths, maxLevel, leftPadding, rightPadding };
}

/** Approximate rendered width (px) of a split button (10px icon + padding + borders + a gap). */
export const SPLIT_BUTTON_WIDTH_PX = 16;

/** Approximate rendered height (px) of a split button (10px icon + padding + borders). */
export const SPLIT_BUTTON_HEIGHT_PX = 14;

/**
 * Nudges split-button x positions apart so no two rendered boxes overlap. Two buttons conflict only
 * when their boxes overlap on **both** axes — `midY` within {@link SPLIT_BUTTON_HEIGHT_PX} and
 * `midX` within {@link SPLIT_BUTTON_WIDTH_PX} — so the vertical test uses the full button height,
 * catching buttons on different run heights whose x is nearly identical.
 *
 * The separation is taken entirely from the button on the **longer** run (most room to absorb a
 * shift), then clamped to that run's `[runLeft, runRight]`; the shorter-run button stays put, and
 * any residual overlap left by clamping is accepted. Mutates `midX` in place; `d` and `midY` (the
 * arcs) are untouched.
 *
 * The scan repeats to a fixed point — nudging one button can collide it with another — capped at
 * one pass per button so an unresolvable residual terminates rather than loops.
 *
 * @param paths - All computed arc paths for the current layout; mutated in place.
 */
export function deconflictSplitButtons(paths: ArcPath[]): void {
  for (let pass = 0; pass < paths.length; pass += 1) {
    let movedThisPass = false;
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const p = paths[i];
        const q = paths[j];
        const verticalOverlap = Math.abs(p.midY - q.midY) < SPLIT_BUTTON_HEIGHT_PX;
        const gap = q.midX - p.midX;
        const overlap = SPLIT_BUTTON_WIDTH_PX - Math.abs(gap);
        if (verticalOverlap && overlap > 0) {
          // Move the button on the longer run; it has the most slack before sliding off its own arc.
          const pLen = p.runRight - p.runLeft;
          const qLen = q.runRight - q.runLeft;
          const mover = pLen >= qLen ? p : q;
          // Push the mover away from the other button: left if it sits left of it, right otherwise.
          const moverIsLeft = mover.midX <= (mover === p ? q.midX : p.midX);
          const target = mover.midX + (moverIsLeft ? -overlap : overlap);
          const clamped = Math.min(Math.max(target, mover.runLeft), mover.runRight);
          if (clamped !== mover.midX) {
            mover.midX = clamped;
            movedThisPass = true;
          }
        }
      }
    }
    if (!movedThisPass) break;
  }
}

// #endregion

// #region Arc path builders

/**
 * Builds the SVG path and midpoint for a same-row upward-bracket arc between two boxes. The run
 * sits `stem` px above the box top with corners rounded _into_ the stem (not added on top), so it
 * shares the same channel as a cross-row run at the same stem — keeping intra- and inter-row arcs
 * aligned at a given level. Coordinates are scroll-space.
 *
 * @param a - Scroll-space rect of the left/earlier box.
 * @param b - Scroll-space rect of the right/later box.
 * @param stem - Total stem height in pixels (base + level offset).
 * @returns The SVG path `d`, the arc's visual midpoint, and the x-extent of its run (the channel
 *   the split button slides along).
 */
export function buildSameRowArcPath(
  a: { left: number; right: number; top: number },
  b: { left: number; right: number; top: number },
  stem: number,
): { d: string; midX: number; midY: number; runLeft: number; runRight: number } {
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  const y = a.top;
  const runY = y - stem;
  const d = roundedPolyline(
    [
      { x: x1, y },
      { x: x1, y: runY },
      { x: x2, y: runY },
      { x: x2, y },
    ],
    ARC_CORNER_RADIUS,
  );
  return {
    d,
    midX: (x1 + x2) / 2,
    midY: runY,
    runLeft: Math.min(x1, x2),
    runRight: Math.max(x1, x2),
  };
}

/**
 * Builds an SVG path for an axis-aligned polyline through `points`, rounding each interior corner
 * with a quarter-circle of radius `r` (a line stopping `r` short of the corner, an arc onto the
 * next leg, continuing `r` past it). The radius is clamped to half the shorter adjacent leg so a
 * short leg never self-overlaps. Used by {@link buildCrossRowArcPath} so its multi-bend route reads
 * as a single rounded bracket.
 *
 * @param points - Ordered waypoints; consecutive points must share an x or a y (axis-aligned legs).
 * @param r - Desired corner radius in pixels.
 * @returns The SVG path `d` attribute string starting with `M`.
 */
export function roundedPolyline(points: { x: number; y: number }[], r: number): string {
  const [first] = points;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    // Clamp the radius to half of each adjacent leg so two tight bends never overrun each other.
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const cr = Math.min(r, inLen / 2, outLen / 2);
    // Unit vectors along the incoming and outgoing legs; the zero-length guards are defensive.
    /* v8 ignore next 4 -- consecutive waypoints are always distinct, so inLen/outLen are never 0 */
    const ux = inLen === 0 ? 0 : (corner.x - prev.x) / inLen;
    const uy = inLen === 0 ? 0 : (corner.y - prev.y) / inLen;
    const vx = outLen === 0 ? 0 : (next.x - corner.x) / outLen;
    const vy = outLen === 0 ? 0 : (next.y - corner.y) / outLen;
    // Stop `cr` short of the corner, then arc onto the outgoing leg `cr` past it.
    const sx = corner.x - ux * cr;
    const sy = corner.y - uy * cr;
    const ex = corner.x + vx * cr;
    const ey = corner.y + vy * cr;
    // Sweep flag: 1 when the turn is clockwise in SVG's y-down space (cross product of in→out > 0).
    const sweep = ux * vy - uy * vx > 0 ? 1 : 0;
    d += ` L ${sx} ${sy} A ${cr} ${cr} 0 0 ${sweep} ${ex} ${ey}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Builds the SVG path for a cross-row arc between two boxes on different rows, routed so it never
 * passes behind a box: up from the upper box into its row's top channel (`aStem` above the box),
 * across to the gutter at `gutterX`, down the gutter, across into the lower row's channel (`bStem`
 * above that box), then down into its top. Each run sits its own (independently-levelled) stem
 * above its box; keeping the whole descent in the gutter is what avoids the boxes between the rows.
 * Coordinates are scroll-space.
 *
 * @param a - Scroll-space rect (top edge) of the earlier (upper) box.
 * @param b - Scroll-space rect (top edge) of the later (lower) box.
 * @param aStem - Stem height (px) of the upper run above the upper box top.
 * @param bStem - Stem height (px) of the lower run above the lower box top.
 * @param gutterX - Scroll-space x of the box-free side gutter the descent travels down.
 * @returns The SVG path `d`, the midpoint on the upper run line (for the split button), and the
 *   x-extent of the upper run (box centre → gutter) the button slides along.
 */
export function buildCrossRowArcPath(
  a: { left: number; right: number; top: number },
  b: { left: number; right: number; top: number },
  aStem: number,
  bStem: number,
  gutterX: number,
): { d: string; midX: number; midY: number; runLeft: number; runRight: number } {
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  const aRunY = a.top - aStem;
  const bRunY = b.top - bStem;
  // Waypoints: up from A → across to the gutter → down → back in above B → drop into B's top.
  const d = roundedPolyline(
    [
      { x: x1, y: a.top },
      { x: x1, y: aRunY },
      { x: gutterX, y: aRunY },
      { x: gutterX, y: bRunY },
      { x: x2, y: bRunY },
      { x: x2, y: b.top },
    ],
    ARC_CORNER_RADIUS,
  );
  // Midpoint rides the upper run line; x1..gutterX keeps the button over the strip, not the margin.
  return {
    d,
    midX: (x1 + gutterX) / 2,
    midY: aRunY,
    runLeft: Math.min(x1, gutterX),
    runRight: Math.max(x1, gutterX),
  };
}

// #endregion
