import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseLinkMap } from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';
import { PhraseGroup, PhraseSlot, resolveIsHighlighted } from './PhraseStripParts';
import {
  ARC_BASE_STEM,
  ARC_CORNER_RADIUS,
  ARC_LEVEL_STEP,
  CONTROLS_HALF_HEIGHT_PX,
} from '../utils/phrase-arc';
import {
  buildRenderUnits,
  groupTokens,
  resolveFocusContext,
  type RenderUnit,
} from '../utils/token-layout';
import { useArcPaths } from '../hooks/useArcPaths';
import { useArcSplitHandler } from '../hooks/useArcSplitHandler';
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

/** Stable empty set passed to phrase boxes outside view mode so memoization isn't broken. */
const EMPTY_SPLIT_FREE_REFS: ReadonlySet<string> = new Set();

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

  /** Maps each token ref to its flat index within this segment for document-order phrase merges. */
  const tokenDocOrder = useMemo(() => {
    const map = new Map<string, number>();
    segment.tokens.forEach((t, i) => map.set(t.ref, i));
    return map;
  }, [segment.tokens]);

  const handleArcSplit = useArcSplitHandler(phraseLinkByRef, tokenDocOrder);

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
      /* v8 ignore next 2 -- callback passed to mocked ArcOverlay; exercised via integration */
      setSplitHoveredArc(arc);
      setSplitFreeTokenRefs(freeTokenRefs);
    },
    [],
  );

  /**
   * Sets (or clears) the would-become-free token refs previewed with a destructive border when a
   * link/unlink icon is hovered. Stable so memoized phrase boxes don't re-render each pass.
   *
   * @param refs - The would-be-free token refs, or `undefined`/empty on leave.
   */
  const handleHoverSplitFreeTokens = useCallback((refs: readonly string[] | undefined) => {
    /* v8 ignore next -- callback passed to mocked PhraseSlot; exercised via integration */
    setSplitFreeTokenRefs(refs ? new Set(refs) : new Set());
  }, []);

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

  /**
   * Token list of the phrase currently being edited, or `undefined` outside edit mode. Hoisted to a
   * single lookup here rather than recomputed per group; passed into each `PhraseGroup`.
   */
  const editPhraseTokens = useMemo(
    () =>
      phraseMode.kind === 'edit'
        ? /* v8 ignore next -- phrase always exists in the store when edit mode is entered */
          [...phraseLinkByRef.values()].find((l) => l.analysisId === phraseMode.phraseId)?.tokens
        : undefined,
    [phraseMode, phraseLinkByRef],
  );

  /** True when any committed phrase exists in this segment. */
  const hasRealPhraseInSegment = tokenGroups.some((g) => g.phraseLink !== undefined);

  // Measure phrase boxes inside this segment and compute arcs. Disabled in baseline-text mode,
  // where the arc container is unmounted, so the result resets to empty.
  const {
    arcPaths,
    arcLevelByPhraseId,
    stripTopPadding: tokenRowTopPadding,
  } = useArcPaths(arcContainerRef, displayMode !== 'baseline-text', hasRealPhraseInSegment, [
    tokenGroups,
    phraseMode,
    displayMode,
  ]);

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
          tokenDocOrder={tokenDocOrder}
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
                const { prevGroup, nextGroup } = unit.slot;
                const slotKey = `slot-${prevGroup?.tokens[prevGroup.tokens.length - 1]?.ref ?? 'start'}-${nextGroup?.tokens[0]?.ref ?? 'end'}`;
                // Both slot neighbors are in this segment by construction (one segment per render).
                return (
                  <PhraseSlot
                    key={slotKey}
                    slot={unit.slot}
                    focus={focus}
                    prevSegmentId={segment.id}
                    nextSegmentId={segment.id}
                    focusedSideIsPrev={focusedSideIsPrevByUnit.get(unit)}
                    hoveredPhraseId={hoveredPhraseId}
                    phraseMode={phraseMode}
                    tokenDocOrder={tokenDocOrder}
                    onHoverCandidatePhrase={onHoverPhrase}
                    /* v8 ignore next 3 -- callback only fires when link icon hover fires */
                    onHoverCandidateTokens={(refs) =>
                      setCandidateTokenRefs(refs ? new Set(refs) : new Set())
                    }
                    onHoverSplitFreeTokens={handleHoverSplitFreeTokens}
                  />
                );
              }
              const { group } = unit;
              const groupKey = group.tokens[0].ref;
              const phraseId = group.phraseLink?.analysisId;
              const showGlossInput = phraseId === undefined || !seenPhraseIds.has(phraseId);
              if (phraseId !== undefined) seenPhraseIds.add(phraseId);
              const arcLevel = phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
              const arcOffsetPx =
                arcLevel > 0
                  ? /* v8 ignore next -- arcLevel > 0 requires DOM layout, not available in jsdom */
                    ARC_BASE_STEM + arcLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
                  : CONTROLS_HALF_HEIGHT_PX;
              const isHighlighted = resolveIsHighlighted(
                phraseMode,
                phraseId,
                group,
                hoveredPhraseId,
                focus.focusedPhraseId,
                candidateTokenRefs,
              );
              return (
                <PhraseGroup
                  key={groupKey}
                  group={group}
                  groupKey={groupKey}
                  isFocused={group.tokens.some((t) => t.ref === focusedTokenRef)}
                  isHighlighted={isHighlighted}
                  splitFreeTokenRefs={
                    phraseMode.kind === 'view' ? splitFreeTokenRefs : EMPTY_SPLIT_FREE_REFS
                  }
                  showControls={
                    phraseMode.kind === 'view' &&
                    phraseId !== undefined &&
                    groupKey === hoveredGroupKey
                  }
                  showGlossInput={showGlossInput}
                  arcOffsetPx={arcOffsetPx}
                  allowHover={phraseMode.kind === 'view' && phraseId !== undefined}
                  onHoverEnter={() => {
                    onHoverPhrase(phraseId);
                    setHoveredGroupKey(groupKey);
                  }}
                  onHoverLeave={() => {
                    onHoverPhrase(undefined);
                    setHoveredGroupKey(undefined);
                  }}
                  onFocusPhrase={handleTokenClick}
                  onHoverCandidatePhrase={onHoverPhrase}
                  onHoverSplitFreeTokens={handleHoverSplitFreeTokens}
                  phraseMode={phraseMode}
                  setPhraseMode={setPhraseMode}
                  editPhraseTokens={editPhraseTokens}
                  editPhraseSegmentId={editPhraseSegmentId}
                  tokenDocOrder={tokenDocOrder}
                  tokenSegmentMap={tokenSegmentMap}
                />
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
