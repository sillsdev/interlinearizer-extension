import type { Book, Token } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type LinkSlot,
  type TokenGroup,
} from '../utils/token-layout';
import { useArcPaths } from '../hooks/useArcPaths';
import { useArcSplitHandler } from '../hooks/useArcSplitHandler';
import { useCandidatePhraseIds } from '../hooks/useCandidatePhraseIds';
import MemoizedArcOverlay, { type ArcSplitTarget } from './ArcOverlay';

/**
 * Clamps `index` to `[0, len - 1]`, returning `0` when `len` is zero.
 *
 * @param index - The raw index to clamp.
 * @param len - Length of the target array.
 * @returns A safe index guaranteed to be within bounds.
 */
function clampIndex(index: number, len: number): number {
  /* v8 ignore next -- only called when len > 0; guard is a defensive invariant */
  if (len === 0) return 0;
  return Math.max(0, Math.min(index, len - 1));
}

/** Stable empty set passed to phrase boxes outside view mode so memoization isn't broken. */
const EMPTY_SPLIT_FREE_REFS: ReadonlySet<string> = new Set();

/**
 * CSS easing for the strip opacity fade-in/out animation. Uses a sine-like curve for a natural feel
 * at both ends of the transition.
 */
const STRIP_FADE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Duration of the strip fade animation in milliseconds. Must match the `setTimeout` in the
 * pending-jump effect.
 */
const STRIP_FADE_MS = 500;

/**
 * Number of phrase slots rendered on each side of the focused phrase. Chosen large enough that no
 * realistic viewport can ever render all tokens simultaneously.
 */
const PHRASE_WINDOW_HALF = 100;

/** A between-group slot render item annotated with the absolute group indices on either side. */
type SlotUnit = {
  kind: 'slot';
  slot: LinkSlot;
  prevGroupIndex: number | undefined;
  nextGroupIndex: number | undefined;
};

/** A phrase-group render item annotated with its window-absolute group index. */
type GroupUnit = { kind: 'group'; group: TokenGroup; groupIndex: number };

/** Props for {@link ContinuousView}. */
type ContinuousViewProps = Readonly<{
  /** The full tokenized book whose tokens are streamed into the strip. */
  book: Book;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. Passed to `PhraseBox`. */
  editPhraseSegmentId: string | undefined;
  /**
   * Token ref of the currently focused word token, or `undefined` when nothing is focused. The
   * strip jumps to the group containing this token and uses it as the single source of truth for
   * highlight + slot rules. All scroll position is derived from this value.
   */
  focusedTokenRef: string | undefined;
  /**
   * Called when arrow navigation or a click in the strip should change which token is focused. The
   * parent echoes the value back through `focusedTokenRef`; the strip then re-renders with the new
   * focus and scrolls into view.
   */
  onFocusedTokenRefChange: (ref: string) => void;
  /** Current phrase-interaction mode; controls token click behaviour in the strip. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token ref → segment id lookup; used to resolve the focused token's segment for slot rules. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → token lookup; used to resolve the focused token from `focusedTokenRef`. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
}>;

/**
 * Renders all tokens from every segment in the given book as a single flat, horizontally scrollable
 * strip. Word tokens belonging to the same phrase are joined into a single `PhraseBox`; arcs are
 * drawn between discontiguous boxes that share a phrase. Arrow buttons advance or retreat the view
 * by one phrase group at a time with smooth scrolling animation. No segment markers, verse labels,
 * or chapter boundaries are shown — the strip is fully continuous.
 *
 * Scroll position is derived from `focusedTokenRef`: the strip always centres the group containing
 * that token. Arrow buttons advance or retreat focus by one group and notify the parent; the parent
 * echoes the new ref back through `focusedTokenRef`. The previous/next arrows are disabled when the
 * first/last phrase is focused.
 *
 * @param props - Component props
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.editPhraseSegmentId - Segment id of the phrase being edited; passed to `PhraseBox`
 * @param props.focusedTokenRef - Single source of truth for focus + scroll position
 * @param props.onFocusedTokenRefChange - Called when arrow navigation or click changes focus
 * @param props.tokenSegmentMap - Token ref → segment id lookup for focus resolution
 * @param props.wordTokenByRef - Word token ref → token lookup for focus resolution
 * @returns A horizontal phrase strip with previous/next navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  book,
  editPhraseSegmentId,
  focusedTokenRef,
  onFocusedTokenRefChange,
  phraseMode,
  setPhraseMode,
  tokenSegmentMap,
  wordTokenByRef,
}: ContinuousViewProps) {
  const isRtl = document.documentElement.dir === 'rtl';

  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  const committedPhraseLinkByRef = usePhraseLinkMap();

  /**
   * Token list of the phrase currently being edited, or `undefined` outside edit mode. Hoisted to a
   * single lookup here rather than recomputed per group; passed into each `PhraseGroup`.
   */
  const editPhraseTokens = useMemo(
    () =>
      phraseMode.kind === 'edit'
        ? /* v8 ignore next -- phrase always exists in the store when edit mode is entered */
          [...committedPhraseLinkByRef.values()].find((l) => l.analysisId === phraseMode.phraseId)
            ?.tokens
        : undefined,
    [phraseMode, committedPhraseLinkByRef],
  );

  /** Maps each word token ref to its flat document index for document-order phrase merges. */
  const tokenDocOrder = useMemo(() => {
    const map = new Map<string, number>();
    allTokens.forEach((t, i) => map.set(t.ref, i));
    return map;
  }, [allTokens]);

  /** Phrase groups built from the flat token list, respecting the committed phrase-link map. */
  const phraseGroups = useMemo(
    () => groupTokens(allTokens, committedPhraseLinkByRef),
    [allTokens, committedPhraseLinkByRef],
  );

  /** Maps each word token ref to the group index that contains it. */
  const groupIndexByTokenRef = useMemo(() => {
    const map = new Map<string, number>();
    phraseGroups.forEach((g, gi) => {
      g.tokens.forEach((t) => map.set(t.ref, gi));
    });
    return map;
  }, [phraseGroups]);

  /** Flat token index -> owning segment lookup; used for per-slot segment resolution. */
  const tokenSegment = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens.map(() => seg)),
    [book.segments],
  );

  /**
   * Token ref that the strip is currently displaying as focused. Lags `focusedTokenRef` during the
   * fade-out for external jumps so the window/scroll/highlight don't shift until the strip has
   * faded out. For internal nav (arrow buttons, phrase clicks) this is updated immediately so the
   * smooth scroll starts on the same frame.
   */
  const [displayFocusedTokenRef, setDisplayFocusedTokenRef] = useState<string | undefined>(
    focusedTokenRef,
  );

  /**
   * Group index of the displayed focused token, or `0` when nothing is focused. Single source of
   * truth for scroll position, windowing, arrow disabled state, and per-group focus highlighting.
   */
  const focusPhraseIndex = useMemo(() => {
    if (displayFocusedTokenRef === undefined) return 0;
    const gi = groupIndexByTokenRef.get(displayFocusedTokenRef);
    /* v8 ignore next -- gi is always defined when displayFocusedTokenRef is set */
    return gi === undefined ? 0 : clampIndex(gi, phraseGroups.length);
  }, [displayFocusedTokenRef, groupIndexByTokenRef, phraseGroups.length]);

  const [isVisible, setIsVisible] = useState(false);

  /** True until the first scroll-into-view completes; suppresses smooth scroll on initial mount. */
  const isInitialLoadInProgressRef = useRef(true);

  /**
   * Token ref that the strip set via `onFocusedTokenRefChange` from internal arrow nav or click.
   * When the parent echoes the same value back as `focusedTokenRef`, the focus-change effect
   * applies the new ref immediately and smooth-scrolls instead of fade-then-snap.
   */
  const internalFocusedTokenRefRef = useRef<string | undefined>(undefined);

  /** DOM ref array indexed by group index; used to scroll the focused phrase box into view. */
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /** Ref mirror of `onFocusedTokenRefChange` so callbacks never need it as a dep. */
  const onFocusedTokenRefChangeRef = useRef(onFocusedTokenRefChange);
  onFocusedTokenRefChangeRef.current = onFocusedTokenRefChange;

  // Notify the parent of the initially-focused token on mount so the segment list scrolls the
  // active verse into view on first render. Only fires when no token was already focused.
  useEffect(() => {
    if (focusedTokenRef !== undefined) return;
    const initialGroup = phraseGroups[focusPhraseIndex];
    const initialRef = initialGroup?.tokens[0]?.ref;
    if (initialRef !== undefined) onFocusedTokenRefChangeRef.current(initialRef);
    // Intentionally runs only on mount; do not add deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atStart = phraseGroups.length === 0 || focusPhraseIndex === 0;
  const atEnd = phraseGroups.length === 0 || focusPhraseIndex >= phraseGroups.length - 1;
  const stripOpacityClass = isVisible ? 'tw:opacity-100' : 'tw:opacity-0';

  /** The inclusive group-index bounds of the rendered window. */
  const windowStart = Math.max(0, focusPhraseIndex - PHRASE_WINDOW_HALF);
  const windowEnd = Math.min(phraseGroups.length - 1, focusPhraseIndex + PHRASE_WINDOW_HALF);

  /** The groups in the rendered window. */
  const windowGroups = phraseGroups.slice(windowStart, windowEnd + 1);

  /**
   * The flat token-index range spanned by the window groups, used to slice `allTokens` for
   * rendering punctuation tokens that appear between phrase groups.
   */
  const windowStartTokenIndex =
    phraseGroups.length > 0 && windowStart > 0 ? phraseGroups[windowStart].firstIndex : 0;
  const windowEndTokenIndex =
    phraseGroups.length > 0 && windowEnd < phraseGroups.length - 1
      ? phraseGroups[windowEnd].firstIndex + phraseGroups[windowEnd].tokens.length
      : allTokens.length;

  /**
   * Advances focus by `delta` phrases by notifying the parent of the new focused token ref. The
   * parent echoes the change back through `focusedTokenRef`, which re-derives `focusPhraseIndex`
   * and triggers the scroll effect. Marks the change as internal so the fade is suppressed.
   *
   * @param delta - Number of phrases to move (positive = forward, negative = backward).
   */
  const step = useCallback(
    (delta: number) => {
      /* v8 ignore next -- arrow buttons are disabled when phraseGroups is empty */
      if (phraseGroups.length === 0) return;
      const nextIndex = focusPhraseIndex + delta;
      /* v8 ignore next -- disabled buttons prevent under/overflow */
      const clamped = nextIndex < 0 ? 0 : Math.min(nextIndex, phraseGroups.length - 1);
      /* v8 ignore next -- disabled buttons prevent clicking when already at boundary */
      if (clamped === focusPhraseIndex) return;
      const nextRef = phraseGroups[clamped]?.tokens[0]?.ref;
      if (nextRef !== undefined) {
        internalFocusedTokenRefRef.current = nextRef;
        onFocusedTokenRefChangeRef.current(nextRef);
      }
    },
    [focusPhraseIndex, phraseGroups],
  );

  /** Moves focus one phrase backward. */
  const stepPrev = useCallback(() => step(-1), [step]);

  /** Moves focus one phrase forward. */
  const stepNext = useCallback(() => step(1), [step]);

  /**
   * Notifies the parent that the user selected the phrase whose first token is `ref`. The parent
   * echoes the new token ref back through `focusedTokenRef`; scroll + highlight follow
   * automatically.
   *
   * @param ref - First-token ref of the selected phrase, or `undefined` to do nothing.
   */
  const handlePhraseSelect = useCallback(
    (ref?: string) => {
      if (ref === undefined || ref === focusedTokenRef) return;
      internalFocusedTokenRefRef.current = ref;
      onFocusedTokenRefChangeRef.current(ref);
    },
    [focusedTokenRef],
  );

  const handleArcSplit = useArcSplitHandler(committedPhraseLinkByRef, tokenDocOrder);

  // React to changes in the prop `focusedTokenRef`. For internal nav (arrow/click in this view),
  // apply the change immediately and smooth-scroll. For external jumps (segment-mode click,
  // Paratext verse selector, mode switch), fade the strip out, wait for the fade to complete,
  // then snap the displayed focus into place so the scroll happens behind the curtain.
  useEffect(() => {
    if (focusedTokenRef === displayFocusedTokenRef) return undefined;
    const isInternal = internalFocusedTokenRefRef.current === focusedTokenRef;
    internalFocusedTokenRefRef.current = undefined;
    if (isInternal) {
      setDisplayFocusedTokenRef(focusedTokenRef);
      return undefined;
    }
    setIsVisible(false);
    const timeout = setTimeout(() => {
      setDisplayFocusedTokenRef(focusedTokenRef);
    }, STRIP_FADE_MS);
    return () => clearTimeout(timeout);
  }, [focusedTokenRef, displayFocusedTokenRef]);

  // Scroll the focused phrase into view whenever the displayed focus changes. Smooth-scroll for
  // internal nav (the displayed ref was updated immediately, so the prop and display agree); snap
  // for external jumps (the displayed ref was just updated post-fade) and for the initial mount.
  useEffect(() => {
    const isInternal = focusedTokenRef === displayFocusedTokenRef && isVisible;
    const isInitialLoad = isInitialLoadInProgressRef.current;
    const shouldJumpInstantly = !isInternal || isInitialLoad;
    phraseRefs.current[focusPhraseIndex]?.scrollIntoView({
      behavior: shouldJumpInstantly ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });

    if (isInternal && !isInitialLoad) return undefined;

    if (isInitialLoad) isInitialLoadInProgressRef.current = false;

    // Defer the fade-in until after the browser applies the instant scroll position.
    const rafId = requestAnimationFrame(() => setIsVisible(true));
    return () => {
      cancelAnimationFrame(rafId);
      setIsVisible(true);
    };
    // isVisible and focusedTokenRef are read for the isInternal decision but the effect is keyed on
    // focusPhraseIndex — the only thing that should trigger a scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPhraseIndex]);

  // When entering edit or confirm-unlink mode, smooth-scroll to the first group of the active
  // phrase by notifying the parent of the new focused token. Scroll then follows automatically
  // through focusedTokenRef → focusPhraseIndex.
  useEffect(() => {
    if (phraseMode.kind === 'view') return;
    const targetPhraseId = phraseMode.phraseId;
    const group = phraseGroups.find((g) => g.phraseLink?.analysisId === targetPhraseId);
    const nextRef = group?.tokens[0]?.ref;
    /* v8 ignore next -- phrase always has tokens; focusedTokenRef differs at mode entry */
    if (nextRef === undefined || nextRef === focusedTokenRef) return;
    internalFocusedTokenRefRef.current = nextRef;
    onFocusedTokenRefChangeRef.current(nextRef);
    // phraseGroups and focusedTokenRef are read once per mode change; intentionally not deps so the
    // effect only fires on actual mode transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseMode]);

  /** Ref to the token-strip row so we can handle mouse-leave events. */
  // eslint-disable-next-line no-null/no-null
  const stripRowRef = useRef<HTMLDivElement | null>(null);

  /**
   * Ref to the outer `tw:relative tw:overflow-visible` strip-fade-wrapper div that is both the SVG
   * parent and the arc measurement container. Using this element (rather than the inner token-strip
   * div) aligns the coordinate origin with the SVG's `inset: 0` anchor, so arc y-positions match.
   */
  // eslint-disable-next-line no-null/no-null
  const arcContainerRef = useRef<HTMLDivElement | null>(null);

  /** The phraseId whose arc is currently highlighted due to a phrase box being hovered. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  /**
   * The group key (first token ref) of the phrase box currently being hovered; drives controls
   * placement. Keyed by ref rather than index to match SegmentView.
   */
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | undefined>();

  /**
   * Token refs of the two free tokens that a hovered link icon would join into a new phrase.
   * `undefined` when no such hover is active.
   */
  const [candidateTokenRefs, setCandidateTokenRefs] = useState<ReadonlySet<string>>(new Set());

  const candidatePhraseIds = useCandidatePhraseIds(candidateTokenRefs, committedPhraseLinkByRef);

  /**
   * Group index of the focused token, derived from `focusedTokenRef`. Used per-slot to compute
   * `focusedSideIsPrev` from the same source as `focus.focusedPhraseLink` /
   * `focus.focusedFreeToken` so link direction and link target can never disagree.
   */
  const focusedGroupIndex = useMemo(
    () => (focusedTokenRef !== undefined ? groupIndexByTokenRef.get(focusedTokenRef) : undefined),
    [focusedTokenRef, groupIndexByTokenRef],
  );

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
   * SegmentView exactly.
   */
  const focus = useMemo(
    () =>
      resolveFocusContext(
        focusedTokenRef,
        wordTokenByRef,
        committedPhraseLinkByRef,
        tokenSegmentMap,
      ),
    [focusedTokenRef, wordTokenByRef, committedPhraseLinkByRef, tokenSegmentMap],
  );

  /** True when any committed phrase exists in the visible window. */
  const hasRealPhraseInWindow = windowGroups.some((g) => g.phraseLink !== undefined);

  // Measure phrase boxes after each render and compute arcs for discontiguous phrases.
  const { arcPaths, arcLevelByPhraseId, stripTopPadding } = useArcPaths(
    arcContainerRef,
    true,
    hasRealPhraseInWindow,
    [windowGroups, phraseMode],
  );

  /**
   * Interleaved render units (groups + link slots) in document order across the window. Built from
   * the window token slice using the shared {@link buildRenderUnits} utility, then each group unit
   * is annotated with its absolute group index.
   */
  const renderItems = useMemo(() => {
    const windowTokens = allTokens.slice(windowStartTokenIndex, windowEndTokenIndex);
    const rawUnits = buildRenderUnits(windowTokens, windowGroups);
    const groupIndexOffset = windowStart;
    const groupIndexByGroup = new Map(windowGroups.map((g, i) => [g, i + groupIndexOffset]));
    const result: (SlotUnit | GroupUnit)[] = [];
    rawUnits.forEach((unit) => {
      if (unit.kind === 'slot') {
        result.push({
          kind: 'slot',
          slot: unit.slot,
          prevGroupIndex: unit.slot.prevGroup
            ? groupIndexByGroup.get(unit.slot.prevGroup)
            : undefined,
          nextGroupIndex: unit.slot.nextGroup
            ? groupIndexByGroup.get(unit.slot.nextGroup)
            : undefined,
        });
      } else {
        const groupIndex =
          /* v8 ignore next -- all window groups are always indexed; fallback is a defensive guard */
          groupIndexByGroup.get(unit.group) ?? windowGroups.indexOf(unit.group) + groupIndexOffset;
        result.push({ kind: 'group', group: unit.group, groupIndex });
      }
    });
    return result;
  }, [allTokens, windowGroups, windowStartTokenIndex, windowEndTokenIndex, windowStart]);

  /**
   * Per-slot `focusedSideIsPrev`, precomputed once from the focused token's absolute group index. A
   * slot's value is `true` when the focused group is start-ward of the slot, `false` when end-ward,
   * and `undefined` when nothing is focused or the slot is a leading/trailing boundary. Keyed by
   * slot item so the render body can look it up instead of computing the comparison inline.
   */
  const focusedSideIsPrevByItem = useMemo(() => {
    const map = new Map<SlotUnit, boolean | undefined>();
    renderItems.forEach((item) => {
      if (item.kind !== 'slot') return;
      map.set(
        item,
        focusedGroupIndex !== undefined &&
          item.prevGroupIndex !== undefined &&
          item.nextGroupIndex !== undefined
          ? focusedGroupIndex <= item.prevGroupIndex
          : undefined,
      );
    });
    return map;
  }, [renderItems, focusedGroupIndex]);

  return (
    <div className="tw:relative tw:flex tw:items-center tw:gap-1">
      {/* Previous navigation arrow */}
      <button
        aria-label="Previous token"
        className="tw:icon-button"
        disabled={atStart}
        onClick={stepPrev}
        type="button"
      >
        <span aria-hidden="true">{isRtl ? '\u2192' : '\u2190'}</span>
      </button>

      {/* Scrollable token strip */}
      <div className="tw:relative tw:flex-1" style={{ overflowX: 'hidden', overflowY: 'visible' }}>
        {/* Previous fade overlay — only rendered when the previous arrow is enabled */}
        {!atStart && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:inset-s-0 tw:z-10 tw:w-8 tw:bg-linear-to-e tw:from-background tw:to-transparent"
          />
        )}

        {/* Next fade overlay — only rendered when the next arrow is enabled */}
        {!atEnd && (
          <div
            aria-hidden="true"
            className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:inset-e-0 tw:z-10 tw:w-8 tw:bg-linear-to-s tw:from-background tw:to-transparent"
          />
        )}

        {/* Inner flex row: both the arc SVG and the token strip fade together */}
        <div
          data-testid="strip-fade-wrapper"
          ref={arcContainerRef}
          className={`tw:arc-container tw:transition-opacity ${stripOpacityClass}`}
          style={{
            transitionDuration: `${STRIP_FADE_MS}ms`,
            transitionTimingFunction: STRIP_FADE_EASING,
          }}
        >
          <MemoizedArcOverlay
            arcPaths={arcPaths}
            phraseMode={phraseMode}
            hoveredPhraseId={hoveredPhraseId}
            focusedPhraseId={focus.focusedPhraseId}
            candidatePhraseIds={candidatePhraseIds}
            splitHoveredArc={splitHoveredArc}
            phraseLinkByRef={committedPhraseLinkByRef}
            tokenDocOrder={tokenDocOrder}
            onArcSplit={handleArcSplit}
            onSplitHoverChange={handleSplitHoverChange}
          />
          <div
            data-testid="token-strip"
            className="tw:no-scrollbar tw:flex tw:w-max tw:items-start tw:gap-1 tw:overflow-x-scroll tw:pb-2"
            ref={stripRowRef}
            style={{ paddingTop: `${stripTopPadding}px` }}
            onMouseLeave={() => {
              setCandidateTokenRefs(new Set());
              setSplitFreeTokenRefs(new Set());
              setSplitHoveredArc(undefined);
            }}
          >
            {(() => {
              const seenPhraseIds = new Set<string>();
              return renderItems.map((item) => {
                if (item.kind === 'slot') {
                  const { prevGroup, nextGroup } = item.slot;
                  const slotKey = `slot-${prevGroup?.tokens[prevGroup.tokens.length - 1]?.ref ?? 'start'}-${nextGroup?.tokens[0]?.ref ?? 'end'}`;
                  const prevSegId =
                    item.prevGroupIndex !== undefined &&
                    phraseGroups[item.prevGroupIndex] !== undefined
                      ? tokenSegment[phraseGroups[item.prevGroupIndex].firstIndex]?.id
                      : undefined;
                  const nextSegId =
                    item.nextGroupIndex !== undefined &&
                    phraseGroups[item.nextGroupIndex] !== undefined
                      ? tokenSegment[phraseGroups[item.nextGroupIndex].firstIndex]?.id
                      : undefined;
                  return (
                    <PhraseSlot
                      key={slotKey}
                      slot={item.slot}
                      focus={focus}
                      prevSegmentId={prevSegId}
                      nextSegmentId={nextSegId}
                      focusedSideIsPrev={focusedSideIsPrevByItem.get(item)}
                      hoveredPhraseId={hoveredPhraseId}
                      phraseMode={phraseMode}
                      tokenDocOrder={tokenDocOrder}
                      onHoverCandidatePhrase={setHoveredPhraseId}
                      /* v8 ignore next 3 -- callback only fires when link icon hover fires */
                      onHoverCandidateTokens={(refs) =>
                        setCandidateTokenRefs(refs ? new Set(refs) : new Set())
                      }
                      onHoverSplitFreeTokens={handleHoverSplitFreeTokens}
                    />
                  );
                }
                const { group, groupIndex } = item;
                const groupKey = group.tokens[0].ref;
                const phraseId = group.phraseLink?.analysisId;
                const showGlossInput = phraseId === undefined || !seenPhraseIds.has(phraseId);
                if (phraseId !== undefined) seenPhraseIds.add(phraseId);
                const arcLevel =
                  phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
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
                    isFocused={group.tokens.some((t) => t.ref === displayFocusedTokenRef)}
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
                      setHoveredPhraseId(phraseId);
                      setHoveredGroupKey(groupKey);
                    }}
                    onHoverLeave={() => {
                      setHoveredPhraseId(undefined);
                      setHoveredGroupKey(undefined);
                    }}
                    onFocusPhrase={handlePhraseSelect}
                    onHoverCandidatePhrase={setHoveredPhraseId}
                    onHoverSplitFreeTokens={handleHoverSplitFreeTokens}
                    groupRef={(el) => {
                      phraseRefs.current[groupIndex] = el;
                    }}
                    phraseMode={phraseMode}
                    setPhraseMode={setPhraseMode}
                    editPhraseTokens={editPhraseTokens}
                    tokenDocOrder={tokenDocOrder}
                    editPhraseSegmentId={editPhraseSegmentId}
                    tokenSegmentMap={tokenSegmentMap}
                  />
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Next navigation arrow */}
      <button
        aria-label="Next token"
        className="tw:icon-button"
        disabled={atEnd}
        onClick={stepNext}
        type="button"
      >
        <span aria-hidden="true">{isRtl ? '\u2190' : '\u2192'}</span>
      </button>
    </div>
  );
}
