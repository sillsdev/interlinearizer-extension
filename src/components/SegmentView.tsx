import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseLinkMap, usePhraseDispatch } from './AnalysisStore';
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from '../types/phrase-mode';
import { MemoizedInertTokenChip } from './TokenChip';
import MemoizedTokenLinkIcon from './TokenLinkIcon';
import {
  ARC_BASE_STEM,
  ARC_CORNER_RADIUS,
  ARC_LEVEL_STEP,
  CONTROLS_HALF_HEIGHT_PX,
  computeAllArcPaths,
  computeStripTopPadding,
  splitPhraseAtBoundary,
  type ArcPath,
} from '../utils/phrase-arc';
import {
  buildRenderUnits,
  groupTokens,
  resolveFocusContext,
  resolveSlotFocus,
  type RenderUnit,
} from '../utils/token-layout';
import { useCandidatePhraseIds } from '../hooks/useCandidatePhraseIds';
import MemoizedArcOverlay, { type ArcSplitTarget } from './ArcOverlay';

/**
 * The two display modes for {@link SegmentView}.
 *
 * - `token-chip` — renders each token as an inline chip (word tokens via `PhraseBox`, punctuation via
 *   `TokenChip`). Used for the main interactive view.
 * - `baseline-text` — renders the segment's raw `baselineText` as a single monospace string. Used for
 *   fallback or debug display.
 */
export type SegmentDisplayMode = 'token-chip' | 'baseline-text';

/** Props for {@link SegmentView}. */
type SegmentViewProps = Readonly<{
  /** Controls whether tokens are rendered as chips or as raw baseline text. */
  displayMode: SegmentDisplayMode;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref of the word token that should appear focused; `undefined` clears focus. */
  focusedTokenRef: string | undefined;
  /** Whether this segment corresponds to the currently active verse. */
  isActive: boolean;
  /**
   * Called when the segment or one of its word tokens is selected. In `baseline-text` mode the
   * whole segment is clickable and `tokenRef` is omitted; in `token-chip` mode only word tokens
   * trigger this and `tokenRef` is always provided.
   */
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  /** The segment to render. */
  segment: Segment;
  /** Current phrase-interaction mode; controls token click behavior and disabled state. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /**
   * The phraseId currently hovered anywhere in the interlinearizer. When set, phrase boxes matching
   * this id are highlighted even if the pointer is over a different segment.
   */
  hoveredPhraseId: string | undefined;
  /** Called when the pointer enters or leaves a phrase box; passes the phraseId or `undefined`. */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Token ref → segment id lookup; passed through to `PhraseBox` for segment-scope edit. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → token lookup for the whole book; used to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
}>;

/**
 * Renders a single segment as either inline token chips or plain baseline text.
 *
 * @param props - Component props
 * @param props.displayMode - Controls how segment content is rendered
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited; used to disable
 *   cross-segment selection.
 * @param props.focusedTokenRef - When set, the matching word token's `PhraseBox` is rendered in the
 *   focused state; only meaningful in `token-chip` mode.
 * @param props.isActive - Whether this segment is the currently selected verse
 * @param props.onSelect - Required callback invoked when the segment or one of its word tokens is
 *   interacted with. In `baseline-text` mode the whole segment is clickable and `tokenRef` is
 *   omitted. In `token-chip` mode only word tokens trigger this callback and `tokenRef` is always
 *   provided.
 * @param props.segment - The segment to render
 * @param props.phraseMode - Current phrase-interaction mode
 * @param props.setPhraseMode - Setter for `phraseMode`
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the interlinearizer
 * @param props.onHoverPhrase - Called with the phraseId when the pointer enters a phrase box, or
 *   `undefined` when it leaves
 * @param props.tokenSegmentMap - Token ref → segment id lookup; passed through to `PhraseBox` for
 *   segment-scope edit.
 * @param props.wordTokenByRef - Word token ref → token lookup; used to resolve focus context.
 * @returns A button (baseline-text mode) or div (token-chip mode) containing a verse label and
 *   segment content
 */
export function SegmentView({
  displayMode,
  editPhraseSegmentId,
  focusedTokenRef,
  isActive,
  onSelect,
  segment,
  phraseMode,
  setPhraseMode,
  hoveredPhraseId,
  onHoverPhrase,
  tokenSegmentMap,
  wordTokenByRef,
}: SegmentViewProps) {
  const { book, chapter, verse } = segment.startRef;
  const ref: ScriptureRef = useMemo(() => ({ book, chapter, verse }), [book, chapter, verse]);

  const phraseLinkByRef = usePhraseLinkMap();
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

  /**
   * Splits a discontiguous phrase at the arc boundary ending at `splitAfterTokenRef`. Resolves the
   * phrase from the link map and delegates to {@link splitPhraseAtBoundary}.
   *
   * @param phraseId - ID of the phrase to split.
   * @param splitAfterTokenRef - Ref of the last token in the earlier fragment.
   */
  const handleArcSplit = useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = [...phraseLinkByRef.values()].find((l) => l.analysisId === phraseId);
      if (!phraseLink) return;
      splitPhraseAtBoundary(phraseLink, splitAfterTokenRef, {
        createPhrase,
        updatePhrase,
        deletePhrase,
      });
    },
    [phraseLinkByRef, createPhrase, updatePhrase, deletePhrase],
  );

  /**
   * Forwards a token-chip click (identified by the group's first-token ref) to the parent as a
   * scripture reference + token id. Stable across renders so `MemoizedPhraseBox` can memoize.
   *
   * @param tokenRef - Ref of the group's first token, supplied by `PhraseBox`.
   */
  const handleTokenClick = useCallback(
    (tokenRef?: string) => {
      if (tokenRef !== undefined) onSelect(ref, tokenRef);
    },
    [onSelect, ref],
  );

  /** Groups of adjacent same-phrase tokens (or solo tokens) for rendering as `PhraseBox`es. */
  const tokenGroups = useMemo(
    () => groupTokens(segment.tokens, phraseLinkByRef),
    [segment.tokens, phraseLinkByRef],
  );

  const sharedClassName = isActive
    ? 'tw:w-full tw:rounded tw:border tw:border-border tw:bg-muted/50 tw:p-2'
    : 'tw:w-full tw:rounded tw:p-2 tw:transition-colors tw:hover:bg-muted/30';

  const verseLabel = (
    <span className="tw:mb-2 tw:block tw:text-xs tw:font-medium tw:text-muted-foreground tw:uppercase tw:tracking-wide">
      {verse}
    </span>
  );

  /** Ref to the flex token row; used by mouse-leave handling. */
  // eslint-disable-next-line no-null/no-null
  const tokenRowRef = useRef<HTMLSpanElement | null>(null);

  /**
   * Ref to the outer `tw:relative tw:overflow-visible` div that is both the SVG parent and the arc
   * measurement container. Using this element (rather than the inner token-row span) aligns the
   * coordinate origin with the SVG's `inset: 0` anchor, so arc y-positions are always correct.
   */
  // eslint-disable-next-line no-null/no-null
  const arcContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * The group key (first token ref) of the phrase box currently being hovered; drives controls
   * placement. Local because controls float above whichever fragment the pointer is over.
   */
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | undefined>();

  /**
   * Token refs of the two free tokens that a hovered link icon would join into a new phrase.
   * `undefined` when no such hover is active.
   */
  const [candidateTokenRefs, setCandidateTokenRefs] = useState<ReadonlySet<string>>(new Set());

  const candidatePhraseIds = useCandidatePhraseIds(candidateTokenRefs, phraseLinkByRef);

  /**
   * Token refs that would become solo (free) after a hovered split/unlink action completes. Shown
   * with a red (destructive) border to preview the effect.
   */
  const [splitFreeTokenRefs, setSplitFreeTokenRefs] = useState<ReadonlySet<string>>(new Set());

  /**
   * The specific arc boundary whose split button is currently hovered. While set, only that arc is
   * drawn in the destructive color — other arcs of the same phrase remain unaffected.
   */
  const [splitHoveredArc, setSplitHoveredArc] = useState<ArcSplitTarget | undefined>();

  /**
   * Updates the split-hover state in one call so the `<ArcOverlay>` doesn't need to know about the
   * two underlying state slots.
   *
   * @param arc - The hovered arc target, or `undefined` on leave.
   * @param freeTokenRefs - Token refs that would become solo after the split, or an empty set on
   *   leave.
   */
  const handleSplitHoverChange = useCallback(
    (arc: ArcSplitTarget | undefined, freeTokenRefs: ReadonlySet<string>) => {
      setSplitHoveredArc(arc);
      setSplitFreeTokenRefs(freeTokenRefs);
    },
    [],
  );

  /**
   * Resolved focus context — what's focused, what segment it's in, what phrase it belongs to. Built
   * once from `focusedTokenRef` and reused by all highlight + slot decisions so the rules match
   * ContinuousView exactly.
   */
  const focus = useMemo(
    () => resolveFocusContext(focusedTokenRef, wordTokenByRef, phraseLinkByRef, tokenSegmentMap),
    [focusedTokenRef, wordTokenByRef, phraseLinkByRef, tokenSegmentMap],
  );

  /** Render units (groups + slots) for this segment. */
  const renderUnits = useMemo(
    () => buildRenderUnits(segment.tokens, tokenGroups),
    [segment.tokens, tokenGroups],
  );

  /**
   * Per-slot `focusedSideIsPrev`, precomputed once by walking the render units in document order. A
   * slot's value is `true` once the focused group has been seen (focus is start-ward of the slot),
   * `false` before it (focus is end-ward), and `undefined` when nothing is focused. Keyed by render
   * unit so the render body can look it up instead of threading a cursor through the map.
   */
  const focusedSideIsPrevByUnit = useMemo(() => {
    const map = new Map<RenderUnit, boolean | undefined>();
    let focusedGroupSeen = false;
    renderUnits.forEach((unit) => {
      if (unit.kind === 'group') {
        if (unit.group.tokens.some((t) => t.ref === focusedTokenRef)) focusedGroupSeen = true;
      } else {
        map.set(unit, focusedTokenRef === undefined ? undefined : focusedGroupSeen);
      }
    });
    return map;
  }, [renderUnits, focusedTokenRef]);

  /** Maps each token ref to its flat index within this segment for document-order phrase merges. */
  const tokenDocOrder = useMemo(() => {
    const map = new Map<string, number>();
    segment.tokens.forEach((t, i) => map.set(t.ref, i));
    return map;
  }, [segment.tokens]);

  /** SVG arc paths for discontiguous phrases inside this segment. */
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);

  /** Nesting level per phraseId; used to compute the controls pill offset per phrase box. */
  const [arcLevelByPhraseId, setArcLevelByPhraseId] = useState<Map<string, number>>(new Map());

  /** Maximum nesting level across all arcs; drives dynamic top padding for the token row. */
  const [maxArcLevel, setMaxArcLevel] = useState(0);

  /** True when any committed phrase exists in this segment. */
  const hasRealPhraseInSegment = tokenGroups.some((g) => g.phraseLink !== undefined);

  const tokenRowTopPadding = computeStripTopPadding(
    arcPaths.length > 0,
    maxArcLevel,
    hasRealPhraseInSegment,
  );

  // After each render, measure phrase boxes inside this segment and compute arcs.
  // No-op in baseline-text mode (the ref is unmounted).
  useLayoutEffect(() => {
    const container = arcContainerRef.current;
    if (!container) {
      setArcPaths((prev) => (prev.length === 0 ? prev : []));
      setArcLevelByPhraseId((prev) => (prev.size === 0 ? prev : new Map()));
      setMaxArcLevel((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const { paths, levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    setArcPaths((prev) => {
      const prevKey = prev.map((p) => p.d).join('|');
      const nextKey = paths.map((p) => p.d).join('|');
      return prevKey === nextKey ? prev : paths;
    });
    setArcLevelByPhraseId((prev) => {
      const changed =
        prev.size !== levelByPhraseId.size ||
        [...levelByPhraseId.entries()].some(([id, level]) => prev.get(id) !== level);
      return changed ? new Map(levelByPhraseId) : prev;
    });
    setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
    // tokenRowTopPadding is intentionally a dep: its applied value affects the DOM layout that
    // we measure arcs against. Without it, going from 0→1 arcs leaves the arc paths measured at
    // the no-padding layout while the boxes shift to the with-padding position, drawing the arcs
    // too high until the next unrelated state change re-runs the effect. The loop stabilizes
    // after one extra pass because arc count doesn't change between passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenGroups, phraseMode, displayMode, tokenRowTopPadding]);

  if (displayMode === 'baseline-text') {
    return (
      <button
        aria-current={isActive ? 'true' : undefined}
        className={`${sharedClassName} tw:text-left`}
        data-testid="segment-container"
        onClick={() => onSelect?.(ref)}
        type="button"
      >
        {verseLabel}
        <span className="tw:font-mono tw:text-sm tw:text-foreground">{segment.baselineText}</span>
      </button>
    );
  }

  // Intentional: token-chip mode renders a div, not a button. In this mode individual word tokens
  // (via PhraseBox gloss inputs) are the interactive elements, so the outer container does not need
  // to be focusable.
  return (
    <div
      aria-current={isActive ? 'true' : undefined}
      className={sharedClassName}
      data-testid="segment-container"
    >
      {verseLabel}
      <div className="tw:arc-container" ref={arcContainerRef}>
        <MemoizedArcOverlay
          arcPaths={arcPaths}
          phraseMode={phraseMode}
          hoveredPhraseId={hoveredPhraseId}
          focusedPhraseId={focus.focusedPhraseId}
          candidatePhraseIds={candidatePhraseIds}
          splitHoveredArc={splitHoveredArc}
          phraseLinkByRef={phraseLinkByRef}
          onArcSplit={handleArcSplit}
          onSplitHoverChange={handleSplitHoverChange}
        />
        <span
          className="tw:token-row"
          ref={tokenRowRef}
          style={{ paddingTop: `${tokenRowTopPadding}px` }}
          onMouseLeave={() => {
            setCandidateTokenRefs(new Set());
            setSplitFreeTokenRefs(new Set());
            setSplitHoveredArc(undefined);
          }}
        >
          {(() => {
            const seenPhraseIds = new Set<string>();
            return renderUnits.map((unit) => {
              if (unit.kind === 'slot') {
                const { prevGroup, nextGroup, punctuation } = unit.slot;
                if (!prevGroup && !nextGroup && punctuation.length === 0) return undefined;
                const prevToken = prevGroup?.tokens[prevGroup.tokens.length - 1];
                const nextToken = nextGroup?.tokens[0];
                const prevPhraseId = prevGroup?.phraseLink?.analysisId;
                const nextPhraseId = nextGroup?.phraseLink?.analysisId;
                const phraseRevealed =
                  prevPhraseId !== undefined &&
                  prevPhraseId === nextPhraseId &&
                  (prevPhraseId === hoveredPhraseId || prevPhraseId === focus.focusedPhraseId);
                // focusedSideIsPrev is precomputed per slot by walking the render units once.
                // Both slot neighbors are in this segment by construction (one segment per render).
                const slotFocus = resolveSlotFocus(
                  segment.id,
                  segment.id,
                  focus.focusedSegmentId,
                  focusedSideIsPrevByUnit.get(unit),
                );
                const slotKey = `slot-${prevToken?.ref ?? 'start'}-${nextToken?.ref ?? 'end'}`;
                return (
                  <span key={slotKey} className="tw:link-slot">
                    <MemoizedTokenLinkIcon
                      focusedFreeToken={focus.focusedFreeToken}
                      focusedPhraseLink={focus.focusedPhraseLink}
                      focusedSideIsPrev={slotFocus.focusedSideIsPrev}
                      isSameSegmentAsFocus={slotFocus.isSameSegmentAsFocus}
                      isPhraseRevealed={phraseRevealed}
                      nextPhraseLink={nextGroup?.phraseLink}
                      nextToken={nextToken}
                      onHoverCandidatePhrase={onHoverPhrase}
                      onHoverCandidateTokens={(refs) =>
                        setCandidateTokenRefs(refs ? new Set(refs) : new Set())
                      }
                      onHoverSplitFreeTokens={(refs) =>
                        setSplitFreeTokenRefs(refs ? new Set(refs) : new Set())
                      }
                      phraseMode={phraseMode}
                      prevPhraseLink={prevGroup?.phraseLink}
                      prevToken={prevToken}
                      tokenDocOrder={tokenDocOrder}
                    />
                    {punctuation.map((punctToken) => (
                      <MemoizedInertTokenChip key={punctToken.ref} token={punctToken} />
                    ))}
                  </span>
                );
              }
              const { group } = unit;
              const groupKey = group.tokens[0].ref;
              const isFocused = group.tokens.some((t) => t.ref === focusedTokenRef);
              const editPhraseTokens =
                phraseMode.kind === 'edit'
                  ? [...phraseLinkByRef.values()].find((l) => l.analysisId === phraseMode.phraseId)
                      ?.tokens
                  : undefined;
              const phraseId = group.phraseLink?.analysisId;
              const showGlossInput = phraseId === undefined || !seenPhraseIds.has(phraseId);
              if (phraseId !== undefined) seenPhraseIds.add(phraseId);
              const showControls =
                phraseMode.kind === 'view' &&
                phraseId !== undefined &&
                groupKey === hoveredGroupKey;
              const arcLevel = phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
              const arcOffsetPx =
                arcLevel > 0
                  ? ARC_BASE_STEM + arcLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
                  : CONTROLS_HALF_HEIGHT_PX;

              const activeModeHighlightId =
                phraseMode.kind === 'edit' || phraseMode.kind === 'confirm-unlink'
                  ? phraseMode.phraseId
                  : undefined;
              const isHighlighted = (() => {
                if (phraseMode.kind === 'view') {
                  if (phraseId !== undefined && phraseId === hoveredPhraseId) return true;
                  // Highlight all boxes of the focused phrase, even when not directly hovered, so
                  // discontiguous fragments are visually grouped with the focused box.
                  if (phraseId !== undefined && phraseId === focus.focusedPhraseId) return true;
                  if (group.tokens.some((t) => candidateTokenRefs.has(t.ref))) return true;
                  return false;
                }
                return phraseId !== undefined && phraseId === activeModeHighlightId;
              })();
              const isSplitFree =
                phraseMode.kind === 'view' &&
                group.tokens.some((t) => splitFreeTokenRefs.has(t.ref));
              const allowHover = phraseMode.kind === 'view' && phraseId !== undefined;
              return (
                <span
                  key={groupKey}
                  onMouseEnter={
                    allowHover
                      ? () => {
                          onHoverPhrase(phraseId);
                          setHoveredGroupKey(groupKey);
                        }
                      : undefined
                  }
                  onMouseLeave={
                    allowHover
                      ? () => {
                          onHoverPhrase(undefined);
                          setHoveredGroupKey(undefined);
                        }
                      : undefined
                  }
                >
                  <MemoizedPhraseBox
                    arcOffsetPx={arcOffsetPx}
                    editPhraseSegmentId={editPhraseSegmentId}
                    editPhraseTokens={editPhraseTokens}
                    focusRef={groupKey}
                    isFocused={isFocused}
                    isHighlighted={isHighlighted}
                    isSplitFree={isSplitFree}
                    onFocusPhrase={handleTokenClick}
                    phraseMode={phraseMode}
                    phraseLink={group.phraseLink}
                    setPhraseMode={setPhraseMode}
                    showControls={showControls}
                    showGlossInput={showGlossInput}
                    tokens={group.tokens}
                    tokenSegmentMap={tokenSegmentMap}
                  />
                </span>
              );
            });
          })()}
        </span>
      </div>
    </div>
  );
}

/** Memoized version of {@link SegmentView}; use in render-stable segment lists. */
const MemoizedSegmentView = memo(SegmentView);
export default MemoizedSegmentView;
