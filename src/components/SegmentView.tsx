import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseLinkMap } from './AnalysisStore';
import { isWordToken } from './component-types';
import MemoizedPhraseBox from './PhraseBox';
import type { PhraseMode } from './phrase-mode';
import { MemoizedInertTokenChip } from './TokenChip';
import {
  ARC_BASE_STEM,
  ARC_CORNER_RADIUS,
  ARC_LEVEL_STEP,
  CONTROLS_HALF_HEIGHT_PX,
  buildEffectiveLinkMap,
  groupTokens,
  type TokenGroup,
} from '../utils/phrase-arc';

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
  /**
   * Nesting level per phraseId from the parent's unified arc computation. Used to compute
   * `arcOffsetPx` so each phrase box's controls pill aligns with the arc top drawn above it.
   */
  arcLevelByPhraseId: ReadonlyMap<string, number>;
  /** Controls whether tokens are rendered as chips or as raw baseline text. */
  displayMode: SegmentDisplayMode;
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
  /**
   * Set of phraseIds whose gloss input has already been shown in an earlier segment. Used to
   * suppress duplicate gloss inputs for cross-segment phrases.
   */
  seenPhraseIds: ReadonlySet<string>;
}>;

/**
 * Renders a single segment as either inline token chips or plain baseline text.
 *
 * @param props - Component props
 * @param props.arcLevelByPhraseId - Nesting level per phraseId from the parent's unified arc
 *   computation; drives the controls pill vertical offset.
 * @param props.displayMode - Controls how segment content is rendered
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
 * @param props.seenPhraseIds - PhraseIds whose gloss input has already been rendered in an earlier
 *   segment; used to suppress duplicate inputs for cross-segment phrases
 * @returns A button (baseline-text mode) or div (token-chip mode) containing a verse label and
 *   segment content
 */
export function SegmentView({
  arcLevelByPhraseId,
  displayMode,
  focusedTokenRef,
  isActive,
  onSelect,
  segment,
  phraseMode,
  setPhraseMode,
  hoveredPhraseId,
  onHoverPhrase,
  seenPhraseIds,
}: SegmentViewProps) {
  const { book, chapter, verse } = segment.startRef;
  const ref: ScriptureRef = useMemo(() => ({ book, chapter, verse }), [book, chapter, verse]);

  const phraseLinkByRef = usePhraseLinkMap();

  /**
   * Forwards a token-chip click (identified by its index in `segment.tokens`) to the parent as a
   * scripture reference + token id. Stable across renders so `MemoizedPhraseBox` can memoize.
   *
   * @param index - Index of the clicked token within `segment.tokens`.
   */
  const handleTokenClick = useCallback(
    (index?: number) => {
      if (index !== undefined) onSelect(ref, segment.tokens[index].ref);
    },
    [onSelect, ref, segment.tokens],
  );

  const effectiveLinkMap = useMemo(
    () => buildEffectiveLinkMap(phraseLinkByRef, phraseMode),
    [phraseLinkByRef, phraseMode],
  );

  /** Groups of adjacent same-phrase tokens (or solo tokens) for rendering as `PhraseBox`es. */
  const tokenGroups = useMemo(
    () => groupTokens(segment.tokens, effectiveLinkMap),
    [segment.tokens, effectiveLinkMap],
  );

  const sharedClassName = isActive
    ? 'tw:w-full tw:rounded tw:border tw:border-border tw:bg-muted/50 tw:p-2'
    : 'tw:w-full tw:rounded tw:p-2 tw:transition-colors tw:hover:bg-muted/30';

  const verseLabel = (
    <span className="tw:mb-2 tw:block tw:text-xs tw:font-medium tw:text-muted-foreground tw:uppercase tw:tracking-wide">
      {verse}
    </span>
  );

  /** Ref to the flex token row; kept so the parent's arc `useLayoutEffect` can query inside it. */
  // eslint-disable-next-line no-null/no-null
  const tokenRowRef = useRef<HTMLSpanElement | null>(null);

  /**
   * The group key (first token ref) of the phrase box currently being hovered; drives controls
   * placement. Local because controls float above whichever fragment the pointer is over.
   */
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | undefined>();

  /**
   * The phraseId of the phrase containing the currently focused token. Used to highlight phrase
   * boxes for the focused phrase even when the mouse is not over them.
   */
  const focusedPhraseId = useMemo(
    () =>
      focusedTokenRef !== undefined ? phraseLinkByRef.get(focusedTokenRef)?.analysisId : undefined,
    [focusedTokenRef, phraseLinkByRef],
  );

  /**
   * Interleaved render units in document order: each entry is either a punctuation token or a
   * `TokenGroup`. Built by walking `segment.tokens` once and emitting the appropriate render unit
   * for each token position.
   */
  const renderItems = useMemo(() => {
    // Build a set of token refs that are non-first members of a multi-token group so we can skip
    // them without advancing the group cursor past future groups.
    const nonFirstRefs = new Set(tokenGroups.flatMap((g) => g.tokens.slice(1).map((t) => t.ref)));
    let groupIndex = 0;
    return segment.tokens.reduce<
      Array<{ kind: 'punct'; token: Token } | { kind: 'group'; group: TokenGroup }>
    >((items, token) => {
      if (!isWordToken(token)) {
        items.push({ kind: 'punct', token });
      } else if (!nonFirstRefs.has(token.ref)) {
        // First (or only) member of its group — emit the group.
        if (
          groupIndex < tokenGroups.length &&
          tokenGroups[groupIndex].tokens[0].ref === token.ref
        ) {
          items.push({ kind: 'group', group: tokenGroups[groupIndex] });
          groupIndex += 1;
        }
      }
      // Non-first members are already rendered inside their group above.
      return items;
    }, []);
  }, [segment.tokens, tokenGroups]);

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
  // to be focusable. Keyboard access goes through the gloss inputs inside PhraseBox, not here.
  return (
    <div
      aria-current={isActive ? 'true' : undefined}
      className={sharedClassName}
      data-testid="segment-container"
    >
      {verseLabel}
      <div className="tw:overflow-visible">
        <span
          className="tw:relative tw:flex tw:flex-wrap tw:gap-x-1 tw:gap-y-6 tw:items-start tw:pt-4"
          ref={tokenRowRef}
        >
          {(() => {
            const localSeenPhraseIds = new Set(seenPhraseIds);
            return renderItems.map((item) => {
              if (item.kind === 'punct') {
                return <MemoizedInertTokenChip key={item.token.ref} token={item.token} />;
              }
              const { group } = item;
              const groupKey = group.tokens[0].ref;
              const isFocused = group.tokens.some((t) => t.ref === focusedTokenRef);
              const editPhraseTokens =
                phraseMode.kind === 'edit'
                  ? [...phraseLinkByRef.values()].find((l) => l.analysisId === phraseMode.phraseId)
                      ?.tokens
                  : undefined;
              const phraseId = group.phraseLink?.analysisId;
              const showGlossInput = phraseId === undefined || !localSeenPhraseIds.has(phraseId);
              if (phraseId !== undefined) localSeenPhraseIds.add(phraseId);
              const showControls =
                phraseMode.kind === 'view' &&
                phraseId !== undefined &&
                groupKey === hoveredGroupKey;
              const arcLevel = phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
              const arcOffsetPx =
                arcLevel > 0
                  ? ARC_BASE_STEM + arcLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
                  : CONTROLS_HALF_HEIGHT_PX;
              return (
                <span
                  key={groupKey}
                  onMouseEnter={
                    phraseId !== undefined
                      ? () => {
                          onHoverPhrase(phraseId);
                          setHoveredGroupKey(groupKey);
                        }
                      : undefined
                  }
                  onMouseLeave={
                    phraseId !== undefined
                      ? () => {
                          onHoverPhrase(undefined);
                          setHoveredGroupKey(undefined);
                        }
                      : undefined
                  }
                >
                  <MemoizedPhraseBox
                    arcOffsetPx={arcOffsetPx}
                    editPhraseTokens={editPhraseTokens}
                    index={group.firstIndex}
                    isFocused={isFocused}
                    isHighlighted={
                      phraseId !== undefined &&
                      (phraseId === hoveredPhraseId || phraseId === focusedPhraseId)
                    }
                    onFocusPhrase={handleTokenClick}
                    phraseMode={phraseMode}
                    phraseLink={group.phraseLink}
                    setPhraseMode={setPhraseMode}
                    showControls={showControls}
                    showGlossInput={showGlossInput}
                    tokens={group.tokens}
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
