import type { PhraseAnalysisLink } from 'interlinearizer';
import { Link2Off } from 'lucide-react';
import { memo, useState, useCallback } from 'react';
import type { PhraseMode } from '../types/phrase-mode';
import { computeSplitFreeRefs, getArcStrokeProps, type ArcPath } from '../utils/phrase-arc';

// #region Types

/**
 * Identifies one specific arc boundary by phrase id and the token immediately before the split,
 * plus whether splitting there would free a token. `kind` drives the hovered arc's stroke: a `free`
 * split shows the destructive preview, while a `reshape` split (both halves stay ≥ 2 tokens) merely
 * dims the hovered segment to communicate that this one connection would disappear.
 */
export type ArcSplitTarget = {
  phraseId: string;
  splitAfterTokenRef: string;
  kind: 'free' | 'reshape';
};

// #endregion

// #region ArcOverlay

/** Props for {@link ArcOverlay}. */
type ArcOverlayProps = Readonly<{
  /** SVG arc path strings to draw above the token row, plus their midpoints for the split button. */
  arcPaths: ArcPath[];
  /** Current phrase-interaction mode; drives stroke colour and whether split buttons are rendered. */
  phraseMode: PhraseMode;
  /** PhraseId currently hovered anywhere in the interlinearizer, or `undefined` for none. */
  hoveredPhraseId: string | undefined;
  /** PhraseId of the focused token's phrase, or `undefined` when nothing is focused. */
  focusedPhraseId: string | undefined;
  /** Phrase ids whose arcs should be styled as hovered because a link-icon hover targets them. */
  candidatePhraseIds: ReadonlySet<string>;
  /** Map from phrase `analysisId` to phrase link; used to enumerate which tokens a split would free. */
  phraseLinkById: ReadonlyMap<string, PhraseAnalysisLink>;
  /**
   * Map from token ref to flat document index. Used to order a phrase's tokens before computing
   * which tokens a split would free, so the preview matches the document-order split.
   */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Called when a split button is clicked. */
  onArcSplit: (phraseId: string, splitAfterTokenRef: string) => void;
  /**
   * Called when the split button hover state changes. `freeTokenRefs` lists tokens that would
   * become solo after the split, or an empty set on leave.
   */
  onSplitHoverChange: (freeTokenRefs: ReadonlySet<string>) => void;
  /**
   * Called with a phrase id (or `undefined` on leave) when a split button that would _not_ free any
   * token is hovered. The parent sets this as the hovered phrase so the arc and both connected
   * phrase boxes light up exactly as if the box itself were hovered — the split here only reshapes
   * the phrase, so there is no destructive preview to show.
   */
  onHoverPhrase: (phraseId: string | undefined) => void;
}>;

/**
 * Renders the phrase-arc SVG layer and (in view mode) the split-button overlay on top of a token
 * row. Shared by ContinuousView and SegmentView; intended to sit as a sibling of the row inside the
 * `arc-container` element that owns the coordinate space the arc paths were measured in.
 *
 * @param props - Component props.
 * @returns The SVG + split-button overlay, or `undefined` when there are no arcs to draw.
 */
export function ArcOverlay({
  arcPaths,
  phraseMode,
  hoveredPhraseId,
  focusedPhraseId,
  candidatePhraseIds,
  phraseLinkById,
  tokenDocOrder,
  onArcSplit,
  onSplitHoverChange,
  onHoverPhrase,
}: ArcOverlayProps) {
  const [splitHoveredArc, setSplitHoveredArc] = useState<ArcSplitTarget | undefined>();

  /**
   * Marks a free-split arc segment as hovered and notifies the parent of the token refs that would
   * become free if the split were confirmed.
   *
   * @param phraseId - The id of the phrase whose arc segment is being hovered.
   * @param splitAfterTokenRef - Token ref at whose right edge the split would occur.
   * @param freeRefs - Token refs of the tokens that would become free after the split.
   */
  const handleSplitHoverEnter = useCallback(
    (phraseId: string, splitAfterTokenRef: string, freeRefs: string[]) => {
      setSplitHoveredArc({ phraseId, splitAfterTokenRef, kind: 'free' });
      onSplitHoverChange(new Set(freeRefs));
    },
    [onSplitHoverChange],
  );

  /** Clears the hovered free-split arc state and notifies the parent that no tokens are free. */
  const handleSplitHoverLeave = useCallback(() => {
    setSplitHoveredArc(undefined);
    onSplitHoverChange(new Set());
  }, [onSplitHoverChange]);

  /**
   * Marks the hovered arc segment as a non-freeing ("reshape") split so {@link renderArcPath} dims
   * just that segment, and highlights the whole phrase like a box hover. Used when both halves keep
   * ≥ 2 tokens, so there is nothing destructive to preview — only the disappearing connection.
   *
   * @param phraseId - The phrase whose arc segment is hovered.
   * @param splitAfterTokenRef - Token ref marking the start of the hovered segment's split.
   */
  const handleReshapeHoverEnter = useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      setSplitHoveredArc({ phraseId, splitAfterTokenRef, kind: 'reshape' });
      onHoverPhrase(phraseId);
    },
    [onHoverPhrase],
  );

  /** Clears both the dimmed-segment state and the phrase highlight for a non-freeing split leave. */
  const handleReshapeHoverLeave = useCallback(() => {
    setSplitHoveredArc(undefined);
    onHoverPhrase(undefined);
  }, [onHoverPhrase]);

  if (arcPaths.length === 0) return undefined;

  /**
   * Assigns a paint-order priority so highlighted arcs render on top of dimmed ones inside the
   * single SVG (last element wins). Split-hovered > focused > hovered/candidate > everything else.
   */
  const paintPriority = (phraseId: string, splitAfterTokenRef: string): number => {
    if (
      splitHoveredArc?.phraseId === phraseId &&
      splitHoveredArc?.splitAfterTokenRef === splitAfterTokenRef
    )
      return 3;
    if (phraseId === focusedPhraseId) return 2;
    if (phraseId === hoveredPhraseId || candidatePhraseIds.has(phraseId)) return 1;
    return 0;
  };

  const sortedArcPaths = [...arcPaths].sort(
    (a, b) =>
      paintPriority(a.phraseId, a.splitAfterTokenRef) -
      paintPriority(b.phraseId, b.splitAfterTokenRef),
  );

  /**
   * Renders a single arc `<path>`. When this exact segment's split button is hovered the stroke
   * depends on the split kind: a `free` split shows the destructive preview, while a `reshape`
   * split dims this one segment (it would simply disappear). All other arcs use the standard
   * hover/focus stroke.
   *
   * @param arc - The arc path to render.
   * @returns The SVG path element.
   */
  const renderArcPath = ({ phraseId, d, splitAfterTokenRef }: ArcPath) => {
    const effectiveHoveredPhraseId =
      hoveredPhraseId ?? (candidatePhraseIds.has(phraseId) ? phraseId : undefined);
    const isHoveredSegment =
      splitHoveredArc?.phraseId === phraseId &&
      splitHoveredArc?.splitAfterTokenRef === splitAfterTokenRef;
    let arcProps;
    if (isHoveredSegment && splitHoveredArc?.kind === 'free') {
      arcProps = { stroke: 'var(--destructive)', strokeOpacity: 1, strokeWidth: 2 };
    } else if (isHoveredSegment) {
      // Reshape split: dim just this segment so it reads as "this connection would go away".
      arcProps = { stroke: 'var(--border)', strokeOpacity: 0.25, strokeWidth: 2 };
    } else {
      arcProps = getArcStrokeProps(phraseMode, phraseId, effectiveHoveredPhraseId, focusedPhraseId);
    }
    return (
      <path
        key={`${phraseId}-${d}`}
        d={d}
        fill="none"
        strokeOpacity={arcProps.strokeOpacity}
        strokeWidth={arcProps.strokeWidth}
        style={{ stroke: arcProps.stroke }}
      />
    );
  };

  /**
   * Classifies a phrase into one of three emphasis tiers. A phrase is `focused` when it is the
   * focused phrase, `hovered` when it is hovered (directly or via a link-icon candidate) but not
   * focused, and `unfocused` otherwise.
   *
   * @param phraseId - The phrase id to classify.
   * @returns The emphasis tier.
   */
  const tierOf = (phraseId: string): 'focused' | 'hovered' | 'unfocused' => {
    if (phraseId === focusedPhraseId) return 'focused';
    if (phraseId === hoveredPhraseId || candidatePhraseIds.has(phraseId)) return 'hovered';
    return 'unfocused';
  };

  // Split arcs across three SVG layers so the emphasis z-stack interleaves correctly with the split
  // buttons. All these z-indices live inside `.tw:arc-container`, which is an isolated stacking
  // context, so they only compete with each other and stay small. Top → bottom the stack is:
  //   token row + controls pill (z-7) > hovered button (z-6) > hovered arc (z-5) > focused button
  //   (z-4) > focused arc (z-3) > dimmed button (z-2) > dimmed arc (z-1).
  // Each tier's button sits just above its own arc line, with hover above focus above dimmed so the
  // phrase under the cursor is always fully visible. A single SVG would force every arc it contains
  // to share one z-index, breaking the ordering. The token row sits on top so the phrase boxes and
  // their controls pill always stay above every arc and button; the split buttons sit below the row
  // (but above the arcs) and remain hoverable and clickable in the gap below the boxes.
  const focusedArcPaths = sortedArcPaths.filter((p) => tierOf(p.phraseId) === 'focused');
  const hoveredArcPaths = sortedArcPaths.filter((p) => tierOf(p.phraseId) === 'hovered');
  const unfocusedArcPaths = sortedArcPaths.filter((p) => tierOf(p.phraseId) === 'unfocused');

  /**
   * Maps an emphasis tier to the z-index class for its split button. Buttons sit above their own
   * arc line but below the token row, ordered hovered (6) > focused (4) > dimmed (2) so the button
   * under the cursor is always on top. See the layering comment above for the full stack.
   *
   * @param tier - The emphasis tier of the button's phrase.
   * @returns The Tailwind z-index class.
   */
  const buttonZClassFor = (tier: 'focused' | 'hovered' | 'unfocused'): string => {
    if (tier === 'hovered') return 'tw:z-6';
    if (tier === 'focused') return 'tw:z-4';
    return 'tw:z-2';
  };

  /**
   * Maps an emphasis tier to the split button's border + text colour classes. The focused button is
   * white to match its full-white arc; the hovered button reveals in muted foreground; the
   * unfocused button stays faint until its phrase is hovered or focused.
   *
   * @param tier - The emphasis tier of the button's phrase.
   * @returns The Tailwind border and text colour classes.
   */
  const buttonColorClassFor = (tier: 'focused' | 'hovered' | 'unfocused'): string => {
    if (tier === 'focused') return 'tw:border-white tw:text-white';
    if (tier === 'hovered') return 'tw:border-border/40 tw:text-muted-foreground';
    return 'tw:border-border/50 tw:text-border/50';
  };

  return (
    <>
      <svg
        aria-hidden="true"
        className="tw:arc-svg-layer tw:z-1"
        style={{ height: '100%', overflow: 'visible', width: '100%' }}
      >
        {unfocusedArcPaths.map(renderArcPath)}
      </svg>
      {focusedArcPaths.length > 0 && (
        <svg
          aria-hidden="true"
          className="tw:arc-svg-layer tw:z-3"
          style={{ height: '100%', overflow: 'visible', width: '100%' }}
        >
          {focusedArcPaths.map(renderArcPath)}
        </svg>
      )}
      {hoveredArcPaths.length > 0 && (
        <svg
          aria-hidden="true"
          className="tw:arc-svg-layer tw:z-5"
          style={{ height: '100%', overflow: 'visible', width: '100%' }}
        >
          {hoveredArcPaths.map(renderArcPath)}
        </svg>
      )}
      {phraseMode.kind === 'view' &&
        sortedArcPaths.map(({ phraseId, d, midX, midY, splitAfterTokenRef }) => {
          const tier = tierOf(phraseId);
          const buttonZClass = buttonZClassFor(tier);
          const buttonColorClass = buttonColorClassFor(tier);
          const phraseLink = phraseLinkById.get(phraseId);
          const arcSplitFreeRefs = computeSplitFreeRefs(
            phraseLink,
            splitAfterTokenRef,
            tokenDocOrder,
          );
          const willCreateFreeTokens = arcSplitFreeRefs !== undefined;
          return (
            <button
              key={`split-arc-${phraseId}-${d}`}
              aria-label="Split phrase here"
              className={`tw:absolute tw:-translate-x-1/2 tw:-translate-y-1/2 tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:border tw:bg-background tw:p-px ${buttonZClass} ${buttonColorClass}${willCreateFreeTokens ? ' tw:hover:border-destructive tw:hover:text-destructive' : ''}`}
              data-testid="split-arc-btn"
              style={{ left: midX, top: midY }}
              type="button"
              onClick={() => {
                // Clear the split-hover state synchronously with the click. The button is removed
                // from the DOM by the resulting re-render, so no mouseLeave fires — without this
                // the red "would become free" border would linger until the next mouse move.
                setSplitHoveredArc(undefined);
                onSplitHoverChange(new Set());
                // Also clear the phrase highlight applied for non-freeing splits, for the same
                // reason: the button unmounts on click so its mouseLeave never fires.
                if (!willCreateFreeTokens) onHoverPhrase(undefined);
                onArcSplit(phraseId, splitAfterTokenRef);
              }}
              onMouseEnter={() => {
                if (willCreateFreeTokens) {
                  handleSplitHoverEnter(phraseId, splitAfterTokenRef, arcSplitFreeRefs);
                } else {
                  // No token would be freed, so there is nothing destructive to preview. Highlight
                  // the phrase like a box hover and dim just this segment to show it would go away.
                  handleReshapeHoverEnter(phraseId, splitAfterTokenRef);
                }
              }}
              onMouseLeave={() => {
                if (willCreateFreeTokens) handleSplitHoverLeave();
                else handleReshapeHoverLeave();
              }}
            >
              <Link2Off className="tw:h-2.5 tw:w-2.5" />
            </button>
          );
        })}
    </>
  );
}

// #endregion

/** Memoized version of {@link ArcOverlay}. */
const MemoizedArcOverlay = memo(ArcOverlay);
export default MemoizedArcOverlay;
