import type { PhraseAnalysisLink } from 'interlinearizer';
import { Link2Off } from 'lucide-react';
import { memo } from 'react';
import type { PhraseMode } from '../types/phrase-mode';
import { getArcStrokeProps, type ArcPath } from '../utils/phrase-arc';

/** Identifies one specific arc boundary by phrase id and the token immediately before the split. */
export type ArcSplitTarget = { phraseId: string; splitAfterTokenRef: string };

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
  /** The arc whose split button is currently hovered; renders that arc in the destructive colour. */
  splitHoveredArc: ArcSplitTarget | undefined;
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
   * Called when the split button hover state changes. `arc` identifies the hovered boundary or
   * `undefined` on leave; `freeTokenRefs` lists tokens that would become solo after the split, or
   * an empty set on leave.
   */
  onSplitHoverChange: (arc: ArcSplitTarget | undefined, freeTokenRefs: ReadonlySet<string>) => void;
}>;

/**
 * Renders the phrase-arc SVG layer and (in view mode) the split-button overlay on top of a token
 * row. Shared by ContinuousView and SegmentView; intended to sit as a sibling of the row inside the
 * `arc-container` element that owns the coordinate space the arc paths were measured in.
 *
 * @param props - Component props.
 * @returns The SVG + split-button overlay, or `null` when there are no arcs to draw.
 */
export function ArcOverlay({
  arcPaths,
  phraseMode,
  hoveredPhraseId,
  focusedPhraseId,
  candidatePhraseIds,
  splitHoveredArc,
  phraseLinkById,
  tokenDocOrder,
  onArcSplit,
  onSplitHoverChange,
}: ArcOverlayProps) {
  if (arcPaths.length === 0) return undefined;
  return (
    <>
      <svg
        aria-hidden="true"
        className="tw:pointer-events-none tw:absolute tw:inset-0"
        style={{ height: '100%', overflow: 'visible', width: '100%' }}
      >
        {arcPaths.map(({ phraseId, d, splitAfterTokenRef }) => {
          const effectiveHoveredPhraseId =
            hoveredPhraseId ?? (candidatePhraseIds.has(phraseId) ? phraseId : undefined);
          const arcProps =
            splitHoveredArc?.phraseId === phraseId &&
            splitHoveredArc?.splitAfterTokenRef === splitAfterTokenRef
              ? { stroke: 'var(--destructive)', strokeOpacity: 1, strokeWidth: 2 }
              : getArcStrokeProps(phraseMode, phraseId, effectiveHoveredPhraseId, focusedPhraseId);
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
        })}
      </svg>
      {phraseMode.kind === 'view' &&
        arcPaths.map(({ phraseId, d, midX, midY, splitAfterTokenRef }) => {
          const isRevealed =
            phraseId === hoveredPhraseId ||
            phraseId === focusedPhraseId ||
            candidatePhraseIds.has(phraseId);
          if (!isRevealed) return undefined;
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
              className={`tw:absolute tw:z-10 tw:-translate-x-1/2 tw:-translate-y-1/2 tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:border tw:bg-background tw:p-0.5 tw:text-muted-foreground${willCreateFreeTokens ? ' tw:border-border/40 tw:hover:border-destructive tw:hover:text-destructive' : ' tw:border-border/40'}`}
              data-testid="split-arc-btn"
              style={{ left: midX, top: midY }}
              type="button"
              onClick={() => {
                // Clear the split-hover state synchronously with the click. The button is removed
                // from the DOM by the resulting re-render, so no mouseLeave fires — without this
                // the red "would become free" border would linger until the next mouse move.
                onSplitHoverChange(undefined, new Set());
                onArcSplit(phraseId, splitAfterTokenRef);
              }}
              onMouseEnter={() => {
                if (willCreateFreeTokens) {
                  onSplitHoverChange({ phraseId, splitAfterTokenRef }, new Set(arcSplitFreeRefs));
                }
              }}
              onMouseLeave={() => {
                onSplitHoverChange(undefined, new Set());
              }}
            >
              <Link2Off className="tw:h-3 tw:w-3" />
            </button>
          );
        })}
    </>
  );
}

/**
 * Enumerates the tokens in `phraseLink` that would become solo (free) after splitting at the
 * boundary immediately after `splitAfterTokenRef`. Returns `undefined` when no token would be left
 * solo (both halves have ≥ 2 tokens) or when the phrase cannot be resolved.
 *
 * @param phraseLink - The phrase to split, or `undefined` when not found.
 * @param splitAfterTokenRef - Token ref marking the end of the earlier fragment.
 * @param tokenDocOrder - Map from token ref to flat document index; the tokens are ordered by this
 *   before slicing so the preview matches the document-order split.
 * @returns The refs of tokens that would become free, or `undefined`.
 */
function computeSplitFreeRefs(
  phraseLink: PhraseAnalysisLink | undefined,
  splitAfterTokenRef: string,
  tokenDocOrder: ReadonlyMap<string, number>,
): string[] | undefined {
  /* v8 ignore next -- split buttons are only rendered for phrases found in phraseLinkByRef */
  if (!phraseLink) return undefined;
  const ordered = [...phraseLink.tokens].sort(
    /* v8 ignore next -- ?? 0 fallback for tokens not in tokenDocOrder; always provided in practice */
    (a, b) => (tokenDocOrder.get(a.tokenRef) ?? 0) - (tokenDocOrder.get(b.tokenRef) ?? 0),
  );
  const idx = ordered.findIndex((t) => t.tokenRef === splitAfterTokenRef);
  if (idx < 0) return undefined;
  const boundaryIndex = idx + 1;
  const before = ordered.slice(0, boundaryIndex);
  const after = ordered.slice(boundaryIndex);
  const freeRefs: string[] = [];
  if (before.length === 1) freeRefs.push(before[0].tokenRef);
  if (after.length === 1) freeRefs.push(after[0].tokenRef);
  return freeRefs.length > 0 ? freeRefs : undefined;
}

/** Memoized version of {@link ArcOverlay}. */
const MemoizedArcOverlay = memo(ArcOverlay);
export default MemoizedArcOverlay;
