import { useLocalizedStrings } from '@papi/frontend/react';
import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';
import { usePhraseDispatch, usePhraseLinkByIdMap, usePhraseLinkMap } from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';
import { PhraseStripProvider } from './PhraseStripContext';
import type { PhraseStripContextValue } from './PhraseStripContext';
import { PhraseStrip, LINK_SLOT_TRANSITION_MS, type StripItem } from './PhraseStripParts';
import {
  buildRenderUnits,
  groupTokens,
  resolveFocusContext,
  type RenderUnit,
} from '../utils/token-layout';
import { useArcPaths } from '../hooks/useArcPaths';
import { usePhraseHoverState } from '../hooks/usePhraseHoverState';
import MemoizedArcOverlay from './ArcOverlay';

/**
 * The two display modes for {@link SegmentView}.
 *
 * - `token-chip` — renders each token as an inline chip (word tokens via `PhraseBox`, punctuation via
 *   `TokenChip`). Used for the main interactive view.
 * - `baseline-text` — renders the segment's raw `baselineText` as a single monospace string. Used for
 *   fallback or debug display.
 */
export type SegmentDisplayMode = 'token-chip' | 'baseline-text';

/**
 * Localized string keys this view needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders. A fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render, which (with one SegmentView per verse) escalates
 * into an infinite update loop that freezes the WebView.
 */
const STRING_KEYS = [
  '%interlinearizer_linkButton_crossSegmentDisabledTooltip%',
] as const satisfies `%${string}%`[];

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
  /** Word token ref → flat book-level index; used to sort phrase tokens in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Word token ref → token lookup for the whole book; used to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * When `true`, the link/unlink buttons between phrase boxes are hidden unless this segment is the
   * active verse. Passed through to {@link PhraseStripContextValue}.
   */
  hideInactiveLinkButtons: boolean;
  /**
   * When `true`, phrase-level controls (split, intra-phrase unlink, remove-token) are hidden on
   * every phrase except the focused one. Passed through to {@link PhraseStripContextValue}.
   */
  simplifyPhrases: boolean;
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
 * @param props.tokenDocOrder - Book-level map from word token ref to flat document index; used to
 *   sort phrase tokens across segment boundaries.
 * @param props.wordTokenByRef - Word token ref → token lookup; used to resolve focus context.
 * @param props.hideInactiveLinkButtons - When true, link buttons between phrases are hidden unless
 *   this segment is the active verse.
 * @param props.simplifyPhrases - When true, phrase-level controls are hidden on every phrase except
 *   the focused one.
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
  tokenDocOrder,
  wordTokenByRef,
  hideInactiveLinkButtons,
  simplifyPhrases,
}: SegmentViewProps) {
  const { book, chapter, verse } = segment.startRef;
  const ref: ScriptureRef = useMemo(() => ({ book, chapter, verse }), [book, chapter, verse]);

  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const phraseLinkByRef = usePhraseLinkMap();
  const phraseLinkById = usePhraseLinkByIdMap();
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

  /**
   * Bridges an {@link ArcOverlay} split-button click into phrase-store writes via
   * {@link splitPhraseAtBoundary}, which calls {@link createPhrase}, {@link updatePhrase}, and
   * {@link deletePhrase} to divide the phrase at the chosen boundary. Early-returns when `phraseId`
   * has no corresponding link in the store.
   *
   * @param phraseId - The id of the phrase to split.
   * @param splitAfterTokenRef - Token ref after which the phrase is divided; tokens at or before
   *   this ref go to the first half, tokens after go to the second.
   */
  const handleArcSplit = useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = phraseLinkById.get(phraseId);
      if (!phraseLink) return;
      splitPhraseAtBoundary(
        phraseLink,
        splitAfterTokenRef,
        { createPhrase, updatePhrase, deletePhrase },
        tokenDocOrder,
      );
    },
    [phraseLinkById, tokenDocOrder, createPhrase, updatePhrase, deletePhrase],
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
   * `false` until just after the first paint, then `true`. Gates the link-slot open/close
   * transition: the initial layout must snap to its final width before paint (animating from
   * collapsed on mount would flash), but every later flip of `isActive` / `hideInactiveLinkButtons`
   * should animate. Animating those flips is what fixes the mis-selection bug — when a click on an
   * inactive segment flips it active, the inter-phrase slots slide open over
   * `LINK_SLOT_TRANSITION_MS` instead of snapping, so the bubbled click still resolves against the
   * pre-reflow layout and lands on the phrase the user aimed at rather than whatever instantly
   * shifted under the pointer.
   */
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  /**
   * Bumped on each animation frame while the link slots are sliding open/closed, then fed into the
   * arc re-measure deps below. When `isActive` or `hideInactiveLinkButtons` flips, the inter-phrase
   * slots animate their width over `LINK_SLOT_TRANSITION_MS`, continuously shifting the token
   * boxes; a discontiguous phrase's arc endpoints move with them. The arc `ResizeObserver` only
   * fires when the container's own box changes (e.g. a wrap), so a pure horizontal shift within a
   * row would leave the arcs lagging the tokens for the whole transition. Re-measuring every frame
   * keeps the arcs pinned to their runs throughout the slide — mirroring ContinuousView's re-center
   * loop.
   */
  const [slotAnimationTick, setSlotAnimationTick] = useState(0);
  const skipSlotAnimationRef = useRef(true);
  useEffect(() => {
    // Skip the first run: the initial layout snaps (skipLinkTransition), so there's nothing sliding.
    if (skipSlotAnimationRef.current) {
      skipSlotAnimationRef.current = false;
      return undefined;
    }
    const deadline = performance.now() + LINK_SLOT_TRANSITION_MS;
    let rafId = requestAnimationFrame(function tick() {
      setSlotAnimationTick((n) => n + 1);
      if (performance.now() < deadline) rafId = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, hideInactiveLinkButtons]);

  /**
   * Ref to the outer `tw:relative tw:overflow-visible` div that is both the SVG parent and the arc
   * measurement container. Using this element (rather than the inner token-row span) aligns the
   * coordinate origin with the SVG's `inset: 0` anchor, so arc y-positions are always correct.
   */
  // eslint-disable-next-line no-null/no-null
  const arcContainerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Hover-preview state shared with ContinuousView: the hovered group key (controls float above
   * whichever fragment the pointer is over), link-candidate token refs, and would-become-free token
   * refs, plus their stable handlers.
   */
  const {
    hoveredGroupKey,
    setHoveredGroupKey,
    candidateTokenRefs,
    setCandidateTokenRefs,
    splitFreeTokenRefs,
    handleSplitHoverChange,
    handleHoverSplitFreeTokens,
    clearAll: clearHoverState,
  } = usePhraseHoverState();

  const candidatePhraseIds = useMemo<ReadonlySet<string>>(() => {
    if (candidateTokenRefs.size === 0) return new Set();
    const ids = new Set<string>();
    phraseLinkByRef.forEach((link) => {
      if (link.tokens.some((t) => candidateTokenRefs.has(t.tokenRef))) ids.add(link.analysisId);
    });
    return ids;
  }, [candidateTokenRefs, phraseLinkByRef]);

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
   * Normalized strip items handed to the shared {@link PhraseStrip} body. Both slot neighbors are in
   * this segment by construction (one segment per render), so both slot segment ids are
   * `segment.id`.
   */
  const stripItems = useMemo<StripItem[]>(
    () =>
      renderUnits.map((unit) => {
        if (unit.kind === 'slot') {
          const { prevGroup, nextGroup } = unit.slot;
          const key = `slot-${prevGroup?.tokens[prevGroup.tokens.length - 1]?.ref ?? 'start'}-${nextGroup?.tokens[0]?.ref ?? 'end'}`;
          return {
            kind: 'slot',
            key,
            slot: unit.slot,
            prevSegmentId: segment.id,
            nextSegmentId: segment.id,
            focusedSideIsPrev: focusedSideIsPrevByUnit.get(unit),
          };
        }
        return {
          kind: 'group',
          key: unit.group.tokens[0].ref,
          group: unit.group,
          isFocused: unit.group.tokens.some((t) => t.ref === focusedTokenRef),
        };
      }),
    [renderUnits, segment.id, focusedSideIsPrevByUnit, focusedTokenRef],
  );

  /**
   * Token list of the phrase currently being edited, or `undefined` outside edit mode. Hoisted to a
   * single lookup here rather than recomputed per group; passed into each `PhraseGroup`.
   */
  const editPhraseTokens = useMemo(
    () =>
      phraseMode.kind === 'edit'
        ? /* v8 ignore next -- phrase always exists in the store when edit mode is entered */
          phraseLinkById.get(phraseMode.phraseId)?.tokens
        : undefined,
    [phraseMode, phraseLinkById],
  );

  /**
   * Strip-wide context value shared by every phrase group and link slot in this segment. Memoized
   * so the leaf `MemoizedPhraseBox` / `MemoizedTokenLinkIcon` consumers don't re-render on
   * unrelated changes. `onHoverPhrase` doubles as the candidate-phrase hover callback.
   */
  const stripContext = useMemo<PhraseStripContextValue>(
    () => ({
      phraseMode,
      setPhraseMode,
      editPhraseTokens,
      editPhraseSegmentId,
      tokenSegmentMap,
      tokenDocOrder,
      onHoverPhrase,
      onHoverCandidateTokens: setCandidateTokenRefs,
      onHoverSplitFreeTokens: handleHoverSplitFreeTokens,
      hideInactiveLinkButtons,
      simplifyPhrases,
      activeSegmentId: isActive ? segment.id : undefined,
      crossSegmentLinkTooltip:
        localizedStrings['%interlinearizer_linkButton_crossSegmentDisabledTooltip%'],
      skipLinkTransition: !hasMounted,
    }),
    [
      phraseMode,
      setPhraseMode,
      editPhraseTokens,
      editPhraseSegmentId,
      tokenSegmentMap,
      tokenDocOrder,
      onHoverPhrase,
      setCandidateTokenRefs,
      handleHoverSplitFreeTokens,
      hideInactiveLinkButtons,
      simplifyPhrases,
      isActive,
      segment.id,
      localizedStrings,
      hasMounted,
    ],
  );

  /** True when any committed phrase exists in this segment. */
  const hasRealPhraseInSegment = tokenGroups.some((g) => g.phraseLink !== undefined);

  /**
   * Ref of the first word token in this segment, used to focus its phrase when the background is
   * clicked.
   */
  const firstWordTokenRef = useMemo(
    () => segment.tokens.find((t) => t.type === 'word')?.ref,
    [segment.tokens],
  );

  /**
   * Brings this segment's first phrase into focus and updates the active verse when the click lands
   * on segment background or structural wrappers rather than a genuinely interactive element. The
   * token row and arc container fill most of the segment, so a strict `target === currentTarget`
   * check would only catch the thin padding ring; instead we ignore the click only when it
   * originated inside an interactive element (token button, gloss input, etc.) or anywhere inside a
   * phrase box, each of which handles its own selection. The `label` and `[data-phrase-box]` cases
   * matter for clicks that land on a token chip's surrounding `<label>` or its surface-text span
   * rather than directly on the gloss input: those targets are not in the interactive-tag list, but
   * the browser still forwards the click to the chip's input (firing its own phrase focus), so the
   * background handler must not also fire and override that focus with the segment's first phrase —
   * which was most visible when clicking an out-of-segment phrase fragment. The `[data-link-slot]`
   * case is the inter-phrase link slot: when its link button is visible the button absorbs the
   * click, but when `hideInactiveLinkButtons` collapses the button to zero width the slot becomes
   * an empty clickable gap between phrases. Treating it as background was the bug where clicking
   * near a phrase in an inactive segment (buttons hidden) snapped focus to the segment's first
   * phrase; ignoring it leaves the click a no-op, matching the buttons-visible behavior. Everything
   * else — padding, arc gutters, empty wrap space — focuses the first phrase.
   *
   * @param event - The click event on the segment container.
   */
  const handleBackgroundClick = useCallback(
    (event: MouseEvent) => {
      if (firstWordTokenRef === undefined) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, a, input, textarea, select, label, [contenteditable="true"], [data-phrase-box], [data-link-slot]',
        )
      ) {
        return;
      }
      onSelect(ref, firstWordTokenRef);
    },
    [firstWordTokenRef, onSelect, ref],
  );

  // Measure phrase boxes inside this segment and compute arcs. Disabled in baseline-text mode,
  // where the arc container is unmounted, so the result resets to empty.
  const {
    arcPaths,
    stripTopPadding: tokenRowTopPadding,
    stripRowGap,
    stripLeftPadding,
    stripRightPadding,
  } = useArcPaths(arcContainerRef, displayMode !== 'baseline-text', hasRealPhraseInSegment, [
    tokenGroups,
    phraseMode,
    displayMode,
    isActive,
    hideInactiveLinkButtons,
    slotAnimationTick,
  ]);

  if (displayMode === 'baseline-text') {
    return (
      <button
        aria-current={isActive ? 'true' : undefined}
        className={`${sharedClassName} tw:text-left`}
        data-testid="segment-container"
        tabIndex={-1}
        onClick={() => onSelect?.(ref)}
        type="button"
      >
        {verseLabel}
        <span className="tw:font-mono tw:text-sm tw:text-foreground">{segment.baselineText}</span>
      </button>
    );
  }

  // Intentional: token-chip mode renders a div, not a button. In this mode individual word tokens
  // (via PhraseBox gloss inputs) are the interactive elements; the background click below only
  // focuses the first phrase, which keyboard users reach through those token elements directly. A
  // redundant key handler / role / tabIndex on the container would add a non-functional tab stop, so
  // the click-events-have-key-events and no-static-element-interactions rules are disabled here.
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      aria-current={isActive ? 'true' : undefined}
      className={sharedClassName}
      data-testid="segment-container"
      onClick={handleBackgroundClick}
    >
      {verseLabel}
      <div className="tw:arc-container" ref={arcContainerRef}>
        <MemoizedArcOverlay
          arcPaths={arcPaths}
          phraseMode={phraseMode}
          hoveredPhraseId={hoveredPhraseId}
          focusedPhraseId={focus.focusedPhraseId}
          candidatePhraseIds={candidatePhraseIds}
          phraseLinkById={phraseLinkById}
          tokenDocOrder={tokenDocOrder}
          onArcSplit={handleArcSplit}
          onSplitHoverChange={handleSplitHoverChange}
          onHoverPhrase={onHoverPhrase}
          simplifyPhrases={simplifyPhrases}
        />
        <PhraseStripProvider value={stripContext}>
          <span
            className="tw:token-row tw:pointer-events-none"
            ref={tokenRowRef}
            style={{
              paddingTop: `${tokenRowTopPadding}px`,
              paddingLeft: `${stripLeftPadding}px`,
              paddingRight: `${stripRightPadding}px`,
              rowGap: `${stripRowGap}px`,
            }}
            onMouseLeave={() => {
              onHoverPhrase(undefined);
              clearHoverState();
            }}
          >
            <PhraseStrip
              items={stripItems}
              phraseMode={phraseMode}
              focus={focus}
              hoveredPhraseId={hoveredPhraseId}
              hoveredGroupKey={hoveredGroupKey}
              candidateTokenRefs={candidateTokenRefs}
              splitFreeTokenRefs={splitFreeTokenRefs}
              onHoverPhrase={onHoverPhrase}
              setHoveredGroupKey={setHoveredGroupKey}
              onFocusPhrase={handleTokenClick}
            />
          </span>
        </PhraseStripProvider>
      </div>
    </div>
  );
}

/** Memoized version of {@link SegmentView}; use in render-stable segment lists. */
const MemoizedSegmentView = memo(SegmentView);
export default MemoizedSegmentView;
