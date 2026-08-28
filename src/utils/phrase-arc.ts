import type { PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import type { PhraseMode } from '../types/phrase-mode';

// #region Constants

/**
 * Height (px) of the inter-row gap a floating phrase-controls pill claims above the arc it rides.
 * Independent of the pill's full {@link CONTROLS_HEIGHT_PX}, not a fraction of it: a pill sharing a
 * gap may overlap the row above without reading as clipped, so this is tuned to the gap the layout
 * needs rather than to the pill.
 */
const CONTROLS_ARC_OVERHANG_PX = 12;

/**
 * Full height (px) of a floating phrase-controls pill: its `icon-xs` buttons plus the pill's own
 * border and vertical padding. A phrase riding the box top rather than an arc sits the whole pill
 * above that line, so all of this must be reserved or its top edge is clipped away.
 */
const CONTROLS_HEIGHT_PX = 28;

/**
 * Top padding (px) a token strip needs so an inline verse-number superscript — which peeks above
 * its slot column via `bottom-full` and so overflows above the token row — stays inside the strip
 * instead of being clipped at the container's top edge. The floor matters only where no arcs or
 * phrase controls already reserve more (e.g. the very start of a book, all-contiguous phrases).
 */
const VERSE_SUPERSCRIPT_HEADROOM_PX = 14;

/** Base stem height (px) for arc connectors at nesting level 0. */
export const ARC_BASE_STEM = 10;

/** Additional stem height (px) added per nesting level so interleaved arcs don't overlap. */
export const ARC_LEVEL_STEP = 10;

/** Corner radius (px) used in all arc bracket paths. */
const ARC_CORNER_RADIUS = 5;

/** Extra breathing room (px) above the topmost arc run so its corner doesn't graze the boundary. */
const ARC_CLEARANCE_MARGIN_PX = 4;

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
 * so the utils layer doesn't depend on the store; the store's real dispatch type is structurally
 * compatible.
 */
type SplitPhraseDispatch = {
  createPhrase: (tokens: TokenSnapshot[]) => string;
  updatePhrase: (phraseId: string, tokens: TokenSnapshot[]) => void;
  deletePhrase: (phraseId: string) => void;
};

/**
 * Sorts token snapshots by flat document index, without mutating the input, so a stored phrase
 * token list reflects visual left-to-right order. The single document-order sort, so slicing a
 * phrase orders its tokens identically everywhere. Tokens missing from the order map sort to the
 * front.
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
 * Slices a phrase's tokens, in document order, into the half up to and including the boundary token
 * and the remainder after it; `undefined` when the boundary token is not among them.
 *
 * The single source of this slice, so the destructive-border preview cannot drift from the split it
 * previews.
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
 * Enumerates the tokens that a split just after the given boundary would leave solo (free), since a
 * half with exactly one token leaves it unattached. Returns `undefined` when both halves would keep
 * at least two tokens, the phrase is absent, or the boundary token is not found.
 *
 * The destructive-border preview and the split itself cannot disagree about which tokens end up
 * free.
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
 * Splits a phrase just after the given token and dispatches the resulting create, update, and
 * delete calls. The single split implementation, so no entry point can slice a phrase differently.
 *
 * Outcomes, where `before` is the half up to and including the boundary token:
 *
 * - Both halves ≤ 1 token → delete the phrase; it only had 2 tokens to begin with.
 * - Both halves ≥ 2 tokens → shrink the phrase to `before` and create a new phrase from `after`.
 * - Exactly one half has 1 token → shrink to the larger half; the solo token becomes free.
 *
 * The boundary is in document order, matching how the buttons present it, so this holds even when
 * the stored token list is out of order. Omitting the document-order map falls back to stored
 * order. A boundary that is absent or is the phrase's last token is a no-op.
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

/**
 * A phrase cut by a proposed segment boundary, paired with the in-phrase split point that puts each
 * resulting fragment wholly on its own side of the boundary.
 */
export type StraddledPhrase = {
  /** The phrase that would span the boundary. */
  link: PhraseAnalysisLink;
  /**
   * The phrase's last token before the boundary; splitting just after it (via
   * {@link splitPhraseAtBoundary}) severs the phrase cleanly at the boundary.
   */
  splitAfterTokenRef: string;
};

/**
 * Finds every phrase that a segment boundary would cut — those with tokens on both sides of it in
 * document order — together with where each would have to be severed. A discontiguous phrase counts
 * even when the boundary token is not one of its own, since the boundary can fall in the gap
 * between two fragments.
 *
 * The single source of truth for whether a boundary cuts a phrase, so deciding to force-break one
 * and deciding whether a boundary is safe to offer can never disagree. A boundary ref absent from
 * the document-order map yields no matches.
 */
export function phrasesStraddlingBoundary(
  boundaryRef: string,
  phraseLinks: Iterable<PhraseAnalysisLink>,
  tokenDocOrder: ReadonlyMap<string, number>,
): StraddledPhrase[] {
  const boundaryOrder = tokenDocOrder.get(boundaryRef);
  if (boundaryOrder === undefined) return [];
  const straddled: StraddledPhrase[] = [];
  Array.from(phraseLinks).forEach((link) => {
    let lastBefore: TokenSnapshot | undefined;
    let lastBeforeOrder = Number.NEGATIVE_INFINITY;
    let hasAfter = false;
    link.tokens.forEach((t) => {
      const order = tokenDocOrder.get(t.tokenRef);
      /* v8 ignore next -- phrase tokens are word tokens, which the doc-order map always contains */
      if (order === undefined) return;
      if (order < boundaryOrder) {
        if (order > lastBeforeOrder) {
          lastBefore = t;
          lastBeforeOrder = order;
        }
      } else {
        hasAfter = true;
      }
    });
    if (lastBefore && hasAfter) {
      straddled.push({ link, splitAfterTokenRef: lastBefore.tokenRef });
    }
  });
  return straddled;
}

// #endregion

// #region Arc geometry and strip sizing

/**
 * Stem height (px) an arc run rises above its box top at a given nesting level, where level 0 is
 * outermost. The single source of this formula, so same-row and cross-row runs at the same level
 * share a channel.
 */
function stemForLevel(level: number): number {
  return ARC_BASE_STEM + level * ARC_LEVEL_STEP;
}

/**
 * Vertical room (px) the topmost arc run needs above the line it rises from: its stem, the corner,
 * and the clearance margin. The single clearance figure, so everything reserving room above an arc
 * grows with arc depth alike.
 */
function arcClearancePx(maxArcLevel: number): number {
  return stemForLevel(maxArcLevel) + ARC_CORNER_RADIUS + ARC_CLEARANCE_MARGIN_PX;
}

/**
 * Top padding (px) a token strip needs so arcs and the floating controls pill both fit above the
 * boxes: the topmost arc run's full vertical clearance when any arc is drawn, plus controls
 * headroom.
 *
 * A phrase drawing no arc rides the box top with the whole pill above that line, so the reservation
 * is the pill's full height rather than the {@link CONTROLS_ARC_OVERHANG_PX} an arc-riding pill
 * would raise into the gap.
 *
 * Floored at {@link VERSE_SUPERSCRIPT_HEADROOM_PX} so a peeking verse number is never clipped.
 */
export function computeStripTopPadding(
  hasArcs: boolean,
  maxArcLevel: number,
  hasRealPhrase: boolean,
): number {
  const arcPadding = hasArcs ? arcClearancePx(maxArcLevel) : 0;
  const controlsHeadroom = hasRealPhrase ? CONTROLS_HEIGHT_PX : 0;
  // Floor at the verse-number headroom: with no arcs and no phrase controls the padding must still
  // clear the peeking verse number.
  return Math.max(VERSE_SUPERSCRIPT_HEADROOM_PX, arcPadding + controlsHeadroom);
}

/**
 * Default vertical gap (px) between wrapped token rows when no arc needs extra clearance. Matches
 * the `gap-y-6` (1.5rem) in the `token-row` utility so the non-arc layout is unchanged; used as the
 * floor of {@link computeStripRowGap}.
 */
export const BASE_ROW_GAP_PX = 24;

/**
 * Vertical gap (px) between wrapped token rows so arcs above a lower row clear the boxes of the row
 * above. Where {@link computeStripTopPadding} protects only the topmost row, this protects every
 * inter-row gap: a run in a lower row rises into the shared gap, with the controls pill's overhang
 * riding on top of that. Floored at {@link BASE_ROW_GAP_PX} so shallow or absent arcs never pack
 * rows tighter than the static layout.
 */
export function computeStripRowGap(
  hasArcs: boolean,
  maxArcLevel: number,
  hasRealPhrase: boolean,
): number {
  if (!hasArcs) return BASE_ROW_GAP_PX;
  const controlsHeadroom = hasRealPhrase ? CONTROLS_ARC_OVERHANG_PX : 0;
  return Math.max(BASE_ROW_GAP_PX, arcClearancePx(maxArcLevel) + controlsHeadroom);
}

// #endregion

// #region Arc stroke styling

/** Stroke styling for a single phrase arc; consumed directly as SVG `<path>` attributes. */
type ArcStrokeProps = {
  /** SVG `stroke` value — a CSS color expression. */
  stroke: string;
  /** SVG `stroke-opacity`. */
  strokeOpacity: number;
  /** SVG `stroke-width` in user units. */
  strokeWidth: number;
};

// Arc stroke constants mirror the `phrase-*` Tailwind utilities. If you change the opacity values
// here, update the matching `--phrase-stroke-opacity` in the CSS too, and vice-versa.

/** Matches `phrase-dimmed`: border-color at full opacity. */
const DIMMED_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--border)',
  strokeOpacity: 1,
  strokeWidth: 2,
};

/** Matches `phrase-destructive`: destructive color at full opacity. */
const DESTRUCTIVE_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--destructive)',
  strokeOpacity: 1,
  strokeWidth: 2,
};

/** Matches `phrase-hovered`: foreground at 55% opacity. */
const HOVERED_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--foreground)',
  strokeOpacity: 0.55,
  strokeWidth: 2,
};

/** Matches `phrase-focused`: foreground at 60% opacity. */
const HIGHLIGHTED_ARC_STROKE: ArcStrokeProps = {
  stroke: 'var(--foreground)',
  strokeOpacity: 0.6,
  strokeWidth: 2,
};

/**
 * Stroke styling for a phrase arc — the single definition, so lines render identically across
 * interaction modes:
 *
 * - `confirm-unlink`: target arc destructive, others dimmed.
 * - `edit`: edited arc foreground (matches its box ring), others dimmed, hover suppressed.
 * - `view`: focused arc full-foreground, hovered arc mid-foreground, others border-color.
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
 * A same-row run spans between the two box centers; a cross-row run spans only from its box center
 * out to the side gutter (the descent happens off in the gutter, not across to the other column).
 */
type ArcSegment = {
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
 * Greedy interval-graph coloring, parameterized by pre-sort order and conflict predicate so one
 * implementation serves every level assignment.
 *
 * @param items - The items to color, pre-sorted into the order they should be assigned.
 * @param conflicts - Whether two items overlap and so must take different levels.
 * @returns Each item's level, where 0 is nearest the boxes — outermost nesting for arc segments,
 *   the lane nearest the content edge for gutter descents.
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
 * Each run is leveled on its own — a cross-row arc's upper and lower runs are colored independently
 * against their respective rows — so an inter-row arc's bottom run rises only as far as its own
 * row's overlaps demand. Cross-row runs share the same top channel as same-row runs (not an
 * inter-row gap), so the two kinds do conflict when they share a row, keeping rerouted arcs aware
 * of the same-row brackets they cross.
 */
function assignSegmentLevels(segments: ArcSegment[]): Map<ArcSegment, number> {
  const ordered = [...segments].sort((a, b) => a.left - b.left || a.right - b.right);
  return assignLevels(ordered, (a, b) => a.row === b.row && a.left < b.right && a.right > b.left);
}

/**
 * The vertical descent of a cross-row arc through a side gutter, used for gutter-lane assignment.
 * Two descents on the same `side` whose `[top, bottom]` spans overlap collide if routed down one
 * lane, so they get different lanes.
 *
 * This is a separate axis from {@link ArcSegment} leveling, which deconflicts the horizontal runs. A
 * descent nested vertically inside a wider one (e.g. C..D inside A..F) shares no run row with it,
 * so segment levels never separate them — only this lane assignment does.
 */
type GutterDescent = {
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
 */
function assignGutterLanes(descents: GutterDescent[]): Map<GutterDescent, number> {
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
type ArcState = {
  /** SVG path strings for all discontiguous phrase arcs. */
  paths: ArcPath[];
  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  maxLevel: number;
  /**
   * Horizontal padding (px) the strip must reserve on its left so the leftmost cross-row gutter
   * lane isn't clipped or crowded against neighboring content. Zero when nothing routes down the
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
};

/** Re-expresses a viewport-relative rect against the arc container's top-left corner. */
function toContainerSpace(rect: DOMRect, containerRect: DOMRect): ContainerRect {
  const left = rect.left - containerRect.left;
  const right = rect.right - containerRect.left;
  const top = rect.top - containerRect.top;
  const bottom = rect.bottom - containerRect.top;
  return { left, right, top, bottom };
}

/**
 * Constructs an {@link ArcSegment} with its span normalized, so callers may pass the run's two
 * endpoint x values in either order.
 *
 * @returns An {@link ArcSegment} with `left`/`right` normalized so `left ≤ right`.
 */
function makeArcSegment(phraseId: string, row: number, x1: number, x2: number): ArcSegment {
  return { phraseId, row, left: Math.min(x1, x2), right: Math.max(x1, x2) };
}

/** A same-row box-pair: one run between the two box centers, leveled to avoid overlaps. */
type SameRowPair = {
  phraseId: string;
  a: ContainerRect;
  b: ContainerRect;
  splitAfterTokenRef: string;
  seg: ArcSegment;
};

/**
 * A cross-row box-pair: two independently-leveled runs — one per row, each from box center to the
 * chosen side gutter — plus the side (`nearerLeft`). The second pass reads each run's level from
 * `upperSeg`/`lowerSeg`.
 */
type CrossRowPair = {
  phraseId: string;
  a: ContainerRect;
  b: ContainerRect;
  splitAfterTokenRef: string;
  nearerLeft: boolean;
  upperSeg: ArcSegment;
  lowerSeg: ArcSegment;
};

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
   * Maps a box's top edge to its row's top line — the highest top among boxes sharing that row
   * band, and so never below the box's own top. Cross-row arcs anchor each endpoint here rather
   * than at their own box top, so a gloss-less box of differing height still meets the channel
   * shared by its row-mates. Half the box height serves as the row-matching tolerance.
   */
  rowTopFor: (boxTop: number, boxBottom: number) => number;
};

/**
 * Reads every phrase-box element in the container once and projects it into the container-relative
 * measurements both arc passes need. Split out so arc computation reads as a pipeline of named
 * phases — measure, describe, level, build — rather than one long function.
 */
function measurePhraseBoxes(container: Element): PhraseBoxMeasurements {
  const containerRect = container.getBoundingClientRect();

  // Reading a box's geometry forces layout, so every box is read once and the phrase-keyed
  // grouping, the row-top table, and the content extent all derive from that one snapshot.
  const boxesByPhrase = new Map<string, { rect: ContainerRect; lastTokenRef: string }[]>();
  const allTops: number[] = [];
  let contentLeft = 0;
  let contentRight = 0;
  let sawBox = false;
  container.querySelectorAll('[data-phrase-box="true"]').forEach((el) => {
    const rect = toContainerSpace(el.getBoundingClientRect(), containerRect);
    allTops.push(rect.top);
    if (!sawBox) {
      sawBox = true;
      contentLeft = rect.left;
      contentRight = rect.right;
    } else {
      if (rect.left < contentLeft) contentLeft = rect.left;
      if (rect.right > contentRight) contentRight = rect.right;
    }
    const id = el.getAttribute('data-phrase-id');
    // A box with no phrase id is a solo token: it takes part in the row and extent measurements
    // above, but has no phrase whose runs could need an arc.
    if (!id) return;
    const lastTokenRef = el.getAttribute('data-last-token-ref') ?? '';
    const list = boxesByPhrase.get(id) ?? [];
    list.push({ rect, lastTokenRef });
    boxesByPhrase.set(id, list);
  });

  const rowTopFor = (boxTop: number, boxBottom: number): number => {
    const band = (boxBottom - boxTop) / 2;
    let top = boxTop;
    allTops.forEach((t) => {
      if (t < top && boxTop - t < band) top = t;
    });
    return top;
  };

  return { boxesByPhrase, contentLeft, contentRight, rowTopFor };
}

/**
 * Computes the container-relative SVG arc paths connecting each phrase's discontiguous boxes, plus
 * the nesting depth and gutter padding the strip must reserve.
 *
 * Same-row arcs are leveled so they never overlap. Cross-row arcs rise into the upper row's top
 * channel and then drop down a side gutter — whichever side is nearer the arc's average x, ties
 * going left — one lane further out per overlapping descent, so no leg ever crosses a box.
 */
export function computeAllArcPaths(container: Element): ArcState {
  const { boxesByPhrase, contentLeft, contentRight, rowTopFor } = measurePhraseBoxes(container);

  /**
   * Builds a {@link SameRowPair} for two boxes that share a row. The single arc run spans between
   * their centers, anchored to the row's normalized top channel so it conflicts correctly with
   * cross-row runs sharing that channel.
   */
  const describeSameRowPair = (
    phraseId: string,
    a: ContainerRect,
    b: ContainerRect,
    splitAfterTokenRef: string,
  ): SameRowPair => {
    const x1 = (a.left + a.right) / 2;
    const x2 = (b.left + b.right) / 2;
    const seg = makeArcSegment(phraseId, Math.round(rowTopFor(a.top, a.bottom)), x1, x2);
    return { phraseId, a, b, splitAfterTokenRef, seg };
  };

  /**
   * Builds a {@link CrossRowPair} for two boxes on different rows. Emits two independently-leveled
   * segments — one per row's top channel, each spanning from its box center to the chosen side
   * gutter — so a nested arc routed out the opposite side doesn't conflict. The earlier box is
   * assumed to be the upper one. The routing side is fixed here, before levels exist.
   */
  const describeCrossRowPair = (
    phraseId: string,
    a: ContainerRect,
    b: ContainerRect,
    splitAfterTokenRef: string,
  ): CrossRowPair => {
    const x1 = (a.left + a.right) / 2;
    const x2 = (b.left + b.right) / 2;
    // Side is geometric (average x vs content edges) and independent of level, so it can be fixed
    // here, before levels exist. Tie favors the left.
    const midpointX = (x1 + x2) / 2;
    const nearerLeft = midpointX - contentLeft <= contentRight - midpointX;
    // A cross-row bracket has TWO runs — one per row's top channel — joined by a gutter descent. Each
    // can collide independently on its own row, so emit a segment for both and level them separately;
    // otherwise the bottom run's height would track the upper run's overlaps. Each run spans from its
    // box center to the chosen side edge (the lane sits just past it).
    const sideX = nearerLeft ? contentLeft : contentRight;
    const upperSeg = makeArcSegment(phraseId, Math.round(rowTopFor(a.top, a.bottom)), x1, sideX);
    const lowerSeg = makeArcSegment(phraseId, Math.round(rowTopFor(b.top, b.bottom)), x2, sideX);
    return { phraseId, a, b, splitAfterTokenRef, nearerLeft, upperSeg, lowerSeg };
  };

  // First pass: resolve each consecutive box-pair and collect its level-assignment segment(s) —
  // one for a same-row bracket, two (upper + lower run) for a cross-row one.
  const sameRowPairs: SameRowPair[] = [];
  const crossRowPairs: CrossRowPair[] = [];
  const segments: ArcSegment[] = [];
  boxesByPhrase.forEach((boxes, phraseId) => {
    if (boxes.length < 2) return;
    for (let i = 0; i < boxes.length - 1; i++) {
      const a = boxes[i].rect;
      const b = boxes[i + 1].rect;
      const splitAfterTokenRef = boxes[i].lastTokenRef;
      if (b.top - a.top < (a.bottom - a.top) / 2) {
        const pair = describeSameRowPair(phraseId, a, b, splitAfterTokenRef);
        sameRowPairs.push(pair);
        segments.push(pair.seg);
      } else {
        const pair = describeCrossRowPair(phraseId, a, b, splitAfterTokenRef);
        crossRowPairs.push(pair);
        segments.push(pair.upperSeg, pair.lowerSeg);
      }
    }
  });

  const segmentLevels = assignSegmentLevels(segments);
  // Deepest nesting level across every run; sizes the strip's top padding.
  const maxLevel = segmentLevels.size > 0 ? Math.max(...segmentLevels.values()) : 0;

  const levelOf = (seg: ArcSegment): number =>
    /* v8 ignore next -- every descriptor stores segments that were passed to assignSegmentLevels */
    segmentLevels.get(seg) ?? 0;

  const paths: ArcPath[] = [];
  // Track how far the outermost cross-row gutter lane extends past each content edge so the caller
  // can reserve matching horizontal padding. Stays 0 when nothing routes down that side.
  let leftPadding = 0;
  let rightPadding = 0;

  // Same-row brackets need no inter-arc gutter coordination, so build them directly.
  sameRowPairs.forEach(({ phraseId, a, b, splitAfterTokenRef, seg }) => {
    const stem = stemForLevel(levelOf(seg));
    const { d, midX, midY, runLeft, runRight } = buildSameRowArcPath(a, b, stem);
    paths.push({ phraseId, d, midX, midY, runLeft, runRight, splitAfterTokenRef });
  });

  // Cross-row arcs route down a side gutter. A descent's extent depends on each run's stem, so
  // resolve the geometry first, build a GutterDescent per arc, then color those into lanes. The
  // lane (not the run level) drives the gutter offset, so vertically-nested arcs (C..D inside A..F)
  // take different lanes. Endpoints anchor on each row's shared top line, not their own box top.
  const crossRowGeometries = crossRowPairs.map(
    ({ phraseId, a, b, splitAfterTokenRef, nearerLeft, upperSeg, lowerSeg }) => {
      const aStem = stemForLevel(levelOf(upperSeg));
      const bStem = stemForLevel(levelOf(lowerSeg));
      const aTop = rowTopFor(a.top, a.bottom);
      const bTop = rowTopFor(b.top, b.bottom);
      // The descent spans from the upper run line down to the lower run line.
      const descent: GutterDescent = {
        side: nearerLeft ? 'left' : 'right',
        top: aTop - aStem,
        bottom: bTop - bStem,
      };
      return { phraseId, a, b, splitAfterTokenRef, aStem, bStem, aTop, bTop, nearerLeft, descent };
    },
  );

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
const SPLIT_BUTTON_HEIGHT_PX = 14;

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
 * sits the full stem above the box top with corners rounded _into_ the stem rather than added on
 * top, so it shares a channel with a cross-row run at the same stem, keeping intra- and inter-row
 * arcs aligned at a given level.
 *
 * All coordinates are scroll-space. The returned run extent is the channel the split button slides
 * along.
 */
export function buildSameRowArcPath(
  a: { left: number; right: number; top: number },
  b: { left: number; right: number; top: number },
  stem: number,
): { d: string; midX: number; midY: number; runLeft: number; runRight: number } {
  const x1 = (a.left + a.right) / 2;
  const x2 = (b.left + b.right) / 2;
  const y = Math.min(a.top, b.top);
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
 * Builds an SVG path for an axis-aligned polyline, rounding each interior corner with a
 * quarter-circle so a multi-bend route reads as a single rounded bracket. The radius is clamped to
 * half the shorter adjacent leg, so a short leg never self-overlaps.
 *
 * @param points - Ordered waypoints; consecutive points must share an x or a y.
 * @param r - Desired corner radius in pixels, before clamping.
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
 * Builds the SVG path for an arc between two boxes on different rows, routed so it never passes
 * behind a box. Each run sits its own independently-leveled stem above its box, and keeping the
 * whole descent out in the side gutter is what clears the boxes lying between the two rows.
 *
 * All coordinates are scroll-space. The returned midpoint sits on the upper run line, whose extent
 * is the channel the split button slides along.
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
