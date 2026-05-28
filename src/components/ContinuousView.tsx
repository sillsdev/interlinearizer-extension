import type { Book, ScriptureRef, Token } from 'interlinearizer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type LinkSlot,
  type TokenGroup,
} from '../utils/token-layout';
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
  if (len === 0) return 0;
  return Math.max(0, Math.min(index, len - 1));
}

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

/** Props for {@link ContinuousView}. */
type ContinuousViewProps = Readonly<{
  /** Verse coordinate; when it changes the strip scrolls to the first token of that segment. */
  activeVerse: ScriptureRef;
  /** The full tokenized book whose tokens are streamed into the strip. */
  book: Book;
  /**
   * Token ref of the currently focused word token, or `undefined` when nothing is focused. When
   * set, the strip jumps to the group containing this token; also drives highlight rules across the
   * view.
   */
  focusedTokenRef: string | undefined;
  /**
   * Called when arrow navigation in the strip should change which token is focused. The parent
   * propagates this back through `focusedTokenRef`. This keeps the strip's link-target logic and
   * highlight logic reading the same source — both come from `focusedTokenRef`.
   */
  onFocusedTokenRefChange: (ref: string) => void;
  /** Called when arrow navigation moves the focus into a new verse. */
  onVerseChange: (verse: ScriptureRef) => void;
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
 * Edge behaviour:
 *
 * - Previous arrow is disabled (and previous fade suppressed) when the first phrase is focused.
 * - Next arrow is disabled (and next fade suppressed) when the last phrase is focused.
 *
 * When `activeVerse` changes the strip jumps to the first phrase of the matching segment. When
 * arrow navigation crosses a verse boundary `onVerseChange` is called with the new verse
 * coordinate.
 *
 * @param props - Component props
 * @param props.activeVerse - Verse coordinate; when it changes the strip scrolls to the first
 *   phrase of the matching segment
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.focusedTokenRef - When set, the strip jumps to the group containing this token; also
 *   feeds the shared focus context that drives slot and highlight rules
 * @param props.onFocusedTokenRefChange - Called when arrow navigation in the strip should change
 *   which token is focused; the parent echoes it back via `focusedTokenRef`
 * @param props.onVerseChange - Called when arrow navigation moves the focus into a new verse
 * @param props.tokenSegmentMap - Token ref → segment id lookup for focus resolution
 * @param props.wordTokenByRef - Word token ref → token lookup for focus resolution
 * @returns A horizontal phrase strip with previous/next navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  activeVerse,
  book,
  focusedTokenRef,
  onFocusedTokenRefChange,
  onVerseChange,
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
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

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

  /** Maps each segment id to the group index of its first phrase group. */
  const segmentStartGroupIndex = useMemo(() => {
    const map = new Map<string, number>();
    // Build a quick lookup from flat token index to group index.
    const groupByFirstTokenIndex = new Map<number, number>();
    phraseGroups.forEach((g, gi) => groupByFirstTokenIndex.set(g.firstIndex, gi));

    // For each segment, find its first word token's flat index, then find the group that starts
    // at or after that index.
    let offset = 0;
    book.segments.forEach((seg) => {
      const firstWordLocalIndex = seg.tokens.findIndex((t) => t.type === 'word');
      if (firstWordLocalIndex >= 0) {
        const flatIndex = offset + firstWordLocalIndex;
        // Walk forward from flatIndex until we find a group that starts here or later.
        for (let gi = 0; gi < phraseGroups.length; gi++) {
          if (phraseGroups[gi].firstIndex >= flatIndex) {
            map.set(seg.id, gi);
            break;
          }
        }
      }
      offset += seg.tokens.length;
    });
    return map;
  }, [book.segments, phraseGroups]);

  /** Maps each word token ref to the group index that contains it. */
  const groupIndexByTokenRef = useMemo(() => {
    const map = new Map<string, number>();
    phraseGroups.forEach((g, gi) => {
      g.tokens.forEach((t) => map.set(t.ref, gi));
    });
    return map;
  }, [phraseGroups]);

  /**
   * Ref mirror of `phraseGroups`. Read inside effects and callbacks that need the latest list
   * without declaring it as a dependency.
   */
  const phraseGroupsRef = useRef(phraseGroups);
  phraseGroupsRef.current = phraseGroups;

  /**
   * Ref mirror of `groupIndexByTokenRef`. Read inside the `focusedTokenRef` effect so it never
   * needs to be a dep (which would cause spurious re-runs whenever phrase membership changes
   * without the parent's `focusedTokenRef` changing).
   */
  const groupIndexByTokenRefRef = useRef(groupIndexByTokenRef);
  groupIndexByTokenRefRef.current = groupIndexByTokenRef;

  /** Flat token index -> owning segment lookup. */
  const tokenSegment = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens.map(() => seg)),
    [book.segments],
  );

  /**
   * Maps a flat token index to the segment that owns it. Stored in a ref so that a new book object
   * reference (same content) does not cause the verse-change effect to re-fire.
   */
  const tokenSegmentRef = useRef(tokenSegment);
  tokenSegmentRef.current = tokenSegment;

  /**
   * Returns the group index of the first phrase group in the segment that matches `verse`, or
   * `undefined` when `verse` is absent or does not match any known segment.
   *
   * @param verse - Target scripture reference to locate.
   * @returns Zero-based group index, or `undefined` if the verse cannot be resolved.
   */
  const getGroupIndexForVerse = useCallback(
    (verse?: ScriptureRef): number | undefined => {
      /* v8 ignore next -- verse is always defined at the one call site */
      if (!verse) return;

      const seg = book.segments.find(
        (s) =>
          s.startRef.book === verse.book &&
          s.startRef.chapter === verse.chapter &&
          s.startRef.verse === verse.verse,
      );
      /* v8 ignore next -- only reachable when an external activeVerse references an unrecognized segment */
      if (!seg) return;

      return segmentStartGroupIndex.get(seg.id);
    },
    [book.segments, segmentStartGroupIndex],
  );

  /**
   * Ref mirror of `getGroupIndexForVerse` so the active-verse effect never needs it as a dep.
   * Without this, any phrase-group re-indexing (e.g. toggling tokens during create/edit mode) would
   * change `segmentStartGroupIndex` → new `getGroupIndexForVerse` identity → effect re-fires →
   * spurious fade-out + jump on every token selection.
   */
  const getGroupIndexForVerseRef = useRef(getGroupIndexForVerse);
  getGroupIndexForVerseRef.current = getGroupIndexForVerse;

  // Lazy-initialize to the target verse so on first render the strip is already positioned
  // correctly before the initial-load fade-in fires. Prefer focusedTokenRef (e.g. a focused token
  // carried over from segment view) so there is no flash to the verse-start position on mount.
  const [focusPhraseIndex, setFocusPhraseIndex] = useState<number>(() => {
    if (focusedTokenRef !== undefined) {
      const gi = groupIndexByTokenRef.get(focusedTokenRef);
      if (gi !== undefined) return clampIndex(gi, phraseGroups.length);
    }

    const seg = book.segments.find(
      (s) =>
        s.startRef.book === activeVerse.book &&
        s.startRef.chapter === activeVerse.chapter &&
        s.startRef.verse === activeVerse.verse,
    );
    /* v8 ignore next -- V8 does not track branches inside useState lazy initializer */
    if (!seg) return 0;

    const gi = segmentStartGroupIndex.get(seg.id);
    /* v8 ignore next -- V8 does not track branches inside useState lazy initializer */
    return gi ?? 0;
  });

  /**
   * The phrase index of the most recent external jump (prop-driven). Read inside the
   * `focusPhraseIndex` effect to suppress the echo-back verse-change notification that would
   * otherwise fire when the strip repositions itself in response to an incoming prop.
   */
  const jumpTargetRef = useRef<number | undefined>(undefined);
  const [pendingExternalJumpPhraseIndex, setPendingExternalJumpPhraseIndex] = useState<
    number | undefined
  >();
  const [isVisible, setIsVisible] = useState(false);

  /** True while an externally triggered jump (prop change) is in progress; suppresses smooth scroll. */
  const isExternalJumpInProgressRef = useRef(false);
  /** True until the first scroll-into-view completes; suppresses smooth scroll on initial mount. */
  const isInitialLoadInProgressRef = useRef(true);

  /**
   * True when the lazy `useState` initializer already positioned the strip at `focusedTokenRef`, so
   * the first run of the `focusedTokenRef` effect should be skipped to avoid a redundant jump.
   */
  const focusedTokenRefAppliedRef = useRef(focusedTokenRef !== undefined);

  /**
   * Token ref that the strip set via `onFocusedTokenRefChange` from internal arrow nav. When the
   * parent echoes the same value back as `focusedTokenRef`, the fade-jump effect should skip — the
   * strip already moved itself with smooth scroll.
   */
  const internalFocusedTokenRefRef = useRef<string | undefined>(undefined);

  /**
   * Records the verse most recently reported via `onVerseChange`. When the parent echoes that verse
   * back as `activeVerse` we skip the jump — the change originated here, not externally.
   * Initialized to `activeVerse` so the initial mount position (set by the lazy `useState`
   * initializer) is treated as already handled, preventing a spurious jump on first render.
   */
  const lastInternalVerseRef = useRef<ScriptureRef | undefined>(activeVerse);

  // The focusedTokenRef and activeVerse effects could theoretically race if both props change in
  // one render — the verse effect would overwrite the token-level jump. In practice the parent
  // only changes focusedTokenRef from segment-mode clicks (where ContinuousView is unmounted) or
  // from the mode-switch reconcile, so the two never change together. Any future change that adds
  // token-level clicks in continuous mode must revisit this.

  // Jump to the group containing focusedTokenRef when it changes externally (segment-mode click,
  // mode switch). Internal arrow nav goes through `step` which already updates focusPhraseIndex
  // and notifies the parent; the echo-back is suppressed via internalFocusedTokenRefRef.
  useEffect(() => {
    if (focusedTokenRef === undefined) return;

    // Skip the first run when the lazy initializer already positioned the strip here.
    if (focusedTokenRefAppliedRef.current) {
      focusedTokenRefAppliedRef.current = false;
      return;
    }

    // Skip the echo-back of an internal arrow-nav update — the strip already smooth-scrolled.
    if (internalFocusedTokenRefRef.current === focusedTokenRef) {
      internalFocusedTokenRefRef.current = undefined;
      return;
    }

    // Resolve token ref → group index via ref so this effect only re-runs when focusedTokenRef
    // itself changes.
    const gi = groupIndexByTokenRefRef.current.get(focusedTokenRef);
    /* v8 ignore next -- focusedTokenRef always refers to a known word token while mounted */
    if (gi === undefined) return;
    const clamped = clampIndex(gi, phraseGroupsRef.current.length);
    jumpTargetRef.current = clamped;
    isExternalJumpInProgressRef.current = true;
    setIsVisible(false);
    setPendingExternalJumpPhraseIndex(clamped);
    // groupIndexByTokenRefRef is intentionally excluded — it is a ref so changes are always current
    // without needing to be declared as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedTokenRef]);

  // Jump to the first group of the matching segment when the active verse changes.
  useEffect(() => {
    // Skip if this activeVerse update is an echo-back of a verse change we reported ourselves.
    const lastInternal = lastInternalVerseRef.current;
    if (
      lastInternal?.book === activeVerse.book &&
      lastInternal.chapter === activeVerse.chapter &&
      lastInternal.verse === activeVerse.verse
    ) {
      lastInternalVerseRef.current = undefined;
      return;
    }

    const groupIndex = getGroupIndexForVerseRef.current(activeVerse);
    if (groupIndex === undefined) return;

    jumpTargetRef.current = groupIndex;
    isExternalJumpInProgressRef.current = true;
    setIsVisible(false);
    setPendingExternalJumpPhraseIndex(groupIndex);
    // Exclude activeVerse and getGroupIndexForVerseRef — verse fields capture the actual change,
    // and the ref is always current without needing to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerse?.book, activeVerse?.chapter, activeVerse?.verse]);

  // Let the fade-out complete before triggering the focus jump scroll.
  useEffect(() => {
    if (pendingExternalJumpPhraseIndex === undefined) return undefined;

    const timeout = setTimeout(() => {
      setFocusPhraseIndex(pendingExternalJumpPhraseIndex);
      setPendingExternalJumpPhraseIndex(undefined);
    }, STRIP_FADE_MS);

    return () => clearTimeout(timeout);
  }, [pendingExternalJumpPhraseIndex]);

  // Fire onVerseChange when arrow navigation crosses into a new verse.
  // Initialize to the segment that owns the initial focusPhraseIndex so the initial render does
  // not trigger the callback.
  const firstVisibleSegId =
    phraseGroups.length > 0 ? tokenSegment[phraseGroups[0].firstIndex]?.id : undefined;
  const initialFocusedGroup = phraseGroups[focusPhraseIndex];
  const initialSegId = initialFocusedGroup
    ? tokenSegment[initialFocusedGroup.firstIndex]?.id
    : firstVisibleSegId;
  /**
   * Segment id of the last verse reported via `onVerseChange`. Compared against the current focused
   * segment to avoid firing the callback redundantly when focus stays within the same verse.
   */
  const lastReportedSegIdRef = useRef<string | undefined>(initialSegId);

  // Keep the reported-segment baseline in sync when switching to a different book.
  useEffect(() => {
    lastReportedSegIdRef.current = firstVisibleSegId;
  }, [book.id, firstVisibleSegId]);

  useEffect(() => {
    // Suppress echo-back when the change was driven by an incoming activeVerse prop.
    if (jumpTargetRef.current === focusPhraseIndex) {
      jumpTargetRef.current = undefined;
      return;
    }

    jumpTargetRef.current = undefined;
    const focusedGroup = phraseGroupsRef.current[focusPhraseIndex];
    /* v8 ignore next -- focusPhraseIndex is always within phraseGroups bounds when state changes */
    if (!focusedGroup) return;

    const seg = tokenSegmentRef.current[focusedGroup.firstIndex];
    if (!seg || seg.id === lastReportedSegIdRef.current) return;

    lastReportedSegIdRef.current = seg.id;
    const verse = {
      book: seg.startRef.book,
      chapter: seg.startRef.chapter,
      verse: seg.startRef.verse,
    };
    lastInternalVerseRef.current = verse;
    onVerseChange(verse);
    // onVerseChange and tokenSegmentRef are intentionally excluded — callers must stabilize the
    // reference (useCallback) and tokenSegmentRef is a ref so changes are always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPhraseIndex]);

  /** Ref mirror of `onFocusedTokenRefChange` so callbacks never need it as a dep. */
  const onFocusedTokenRefChangeRef = useRef(onFocusedTokenRefChange);
  onFocusedTokenRefChangeRef.current = onFocusedTokenRefChange;

  // Notify the parent of the lazily-initialized focused token on mount so the segment list scrolls
  // the active verse into view on first render. Subsequent focus changes already flow through
  // focusedTokenRef directly — this is just the mount handshake.
  useEffect(() => {
    const initialGroup = phraseGroupsRef.current[focusPhraseIndex];
    const initialRef = initialGroup?.tokens[0]?.ref;
    if (initialRef !== undefined && focusedTokenRef === undefined) {
      onFocusedTokenRefChangeRef.current(initialRef);
    }
    // Intentionally runs only on mount; do not add deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** DOM ref array indexed by group index; used to scroll the focused phrase box into view. */
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

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
   * Advances the focused phrase by `delta` positions, clamping to valid bounds. Updates both the
   * local scroll position (for smooth scroll) and the parent's `focusedTokenRef` (so link-button
   * direction stays consistent with the centered phrase).
   *
   * @param delta - Number of phrases to move (positive = forward, negative = backward).
   */
  /** Ref mirror of `focusPhraseIndex` so `step` can read the current value without being a dep. */
  const focusPhraseIndexRef = useRef(focusPhraseIndex);
  focusPhraseIndexRef.current = focusPhraseIndex;

  const step = useCallback((delta: number) => {
    const groups = phraseGroupsRef.current;
    if (groups.length === 0) return;
    const { current } = focusPhraseIndexRef;
    const nextIndex = current + delta;
    /* v8 ignore next -- disabled buttons prevent under/overflow */
    const clamped = nextIndex < 0 ? 0 : Math.min(nextIndex, groups.length - 1);
    if (clamped === current) return;
    const nextRef = groups[clamped]?.tokens[0]?.ref;
    if (nextRef !== undefined) {
      // Mark this token as an internal arrow-nav update so the focusedTokenRef effect skips its
      // fade-jump; the smooth scroll triggered by the focusPhraseIndex change handles motion.
      internalFocusedTokenRefRef.current = nextRef;
      onFocusedTokenRefChangeRef.current(nextRef);
    }
    setFocusPhraseIndex(clamped);
  }, []);

  /** Moves focus one phrase backward. */
  const stepPrev = useCallback(() => step(-1), [step]);

  /** Moves focus one phrase forward. */
  const stepNext = useCallback(() => step(1), [step]);

  /**
   * Sets the focused phrase to `index` when provided, ignoring calls with no argument. Mirrors
   * `step` — updates both the local scroll position and the parent's `focusedTokenRef` so the
   * highlight + slot logic stays consistent with any click-driven focus change.
   *
   * @param index - Zero-based phrase index to focus, or `undefined` to do nothing.
   */
  const handlePhraseSelect = useCallback((index?: number) => {
    if (index === undefined) return;
    const groups = phraseGroupsRef.current;
    if (index === focusPhraseIndexRef.current) return;
    const nextRef = groups[index]?.tokens[0]?.ref;
    if (nextRef !== undefined) {
      internalFocusedTokenRefRef.current = nextRef;
      onFocusedTokenRefChangeRef.current(nextRef);
    }
    setFocusPhraseIndex(index);
  }, []);

  /**
   * Splits a discontiguous phrase at the boundary encoded in an arc path. Resolves the phrase from
   * the committed link map and delegates the actual split to {@link splitPhraseAtBoundary}.
   *
   * @param phraseId - ID of the phrase to split.
   * @param splitAfterTokenRef - Ref of the last token in the earlier fragment; the split occurs
   *   immediately after this token.
   */
  const handleArcSplit = useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = [...committedPhraseLinkByRef.values()].find(
        (l) => l.analysisId === phraseId,
      );
      if (!phraseLink) return;
      splitPhraseAtBoundary(phraseLink, splitAfterTokenRef, {
        createPhrase,
        updatePhrase,
        deletePhrase,
      });
    },
    [committedPhraseLinkByRef, createPhrase, updatePhrase, deletePhrase],
  );

  useEffect(() => {
    const isExternalJump = isExternalJumpInProgressRef.current;
    const isInitialLoad = isInitialLoadInProgressRef.current;
    const shouldJumpInstantly = isExternalJump || isInitialLoad;
    phraseRefs.current[focusPhraseIndex]?.scrollIntoView({
      behavior: shouldJumpInstantly ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });

    if (!isExternalJump && !isInitialLoad) return undefined;

    // Clear the flags now — scrollIntoView has already been called above.  Clearing here
    // (rather than inside the RAF callback) keeps subsequent scroll behavior deterministic
    // regardless of whether the RAF fires before the next focusPhraseIndex change.
    if (isExternalJump) isExternalJumpInProgressRef.current = false;
    if (isInitialLoad) isInitialLoadInProgressRef.current = false;

    // Defer the fade-in until after the browser applies the instant scroll position.
    const rafId = requestAnimationFrame(() => setIsVisible(true));

    return () => {
      cancelAnimationFrame(rafId);
      // Only reveal the strip on cleanup if no new external jump is about to take over.
      // When a second click arrives before this RAF fires, isExternalJumpInProgressRef is already
      // true for the new jump — revealing here would make the strip visible before it has scrolled.
      if (!isExternalJumpInProgressRef.current) setIsVisible(true);
    };
  }, [focusPhraseIndex]);

  // When entering edit or confirm-unlink mode, focus and smooth-scroll to the first group of the
  // active phrase so it is centred in the strip.
  useEffect(() => {
    if (phraseMode.kind === 'view') return;
    const targetPhraseId = phraseMode.phraseId;
    const groupIndex = phraseGroupsRef.current.findIndex(
      (g) => g.phraseLink?.analysisId === targetPhraseId,
    );
    if (groupIndex < 0) return;
    setFocusPhraseIndex(groupIndex);
    phraseRefs.current[groupIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
    // phraseGroupsRef and phraseRefs are refs — always current without needing to be deps.
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

  /** SVG arc path strings keyed by phraseId, drawn above the strip for discontiguous phrases. */
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);

  /** Nesting level per phraseId; used to compute controls pill offset so it aligns with the arc top. */
  const [arcLevelByPhraseId, setArcLevelByPhraseId] = useState<Map<string, number>>(new Map());

  /** The phraseId whose arc is currently highlighted due to a phrase box being hovered. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  /** The group index of the phrase box currently being hovered; drives controls placement. */
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | undefined>();

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
      setSplitHoveredArc(arc);
      setSplitFreeTokenRefs(freeTokenRefs);
    },
    [],
  );

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

  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  const [maxArcLevel, setMaxArcLevel] = useState(0);

  /** True when any committed phrase exists in the visible window. */
  const hasRealPhraseInWindow = windowGroups.some((g) => g.phraseLink !== undefined);

  const stripTopPadding = computeStripTopPadding(
    arcPaths.length > 0,
    maxArcLevel,
    hasRealPhraseInWindow,
  );

  /**
   * After each render, find all discontiguous phrase groups (same phraseId appearing on multiple
   * `[data-phrase-box]` elements in the strip) and compute a cubic Bézier arc between consecutive
   * runs. Same-row runs get an upward arc; cross-row runs get a downward arc. Only updates state
   * when the serialized path strings actually change to avoid infinite loops.
   */
  useLayoutEffect(() => {
    const container = arcContainerRef.current;
    /* v8 ignore next -- ref is always populated when useLayoutEffect fires after DOM commit */
    if (!container) return;
    const { paths, levelByPhraseId, maxLevel } = computeAllArcPaths(container);
    setArcPaths((prev) => {
      const prevKey = prev.map((p) => p.d).join('|');
      const nextKey = paths.map((p) => p.d).join('|');
      return prevKey === nextKey ? prev : paths;
    });
    setArcLevelByPhraseId((prev) => {
      const changed = [...levelByPhraseId.entries()].some(([id, level]) => prev.get(id) !== level);
      return changed || prev.size !== levelByPhraseId.size ? new Map(levelByPhraseId) : prev;
    });
    setMaxArcLevel((prev) => (prev === maxLevel ? prev : maxLevel));
    // stripTopPadding is intentionally a dep: its applied value affects the DOM layout that we
    // measure arcs against. Without it, going from 0→1 arcs (or other padding transitions) leaves
    // the arc paths measured at the old-padding layout while the boxes shift to the new-padding
    // position, drawing the arcs at the wrong y until an unrelated state change re-runs the effect.
    // The loop stabilizes after one extra pass because arc count doesn't change between passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowGroups, phraseMode, stripTopPadding]);

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
    type SlotUnit = {
      kind: 'slot';
      slot: LinkSlot;
      prevGroupIndex: number | undefined;
      nextGroupIndex: number | undefined;
    };
    type GroupUnit = { kind: 'group'; group: TokenGroup; groupIndex: number };
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
          groupIndexByGroup.get(unit.group) ?? windowGroups.indexOf(unit.group) + groupIndexOffset;
        result.push({ kind: 'group', group: unit.group, groupIndex });
      }
    });
    return result;
  }, [allTokens, windowGroups, windowStartTokenIndex, windowEndTokenIndex, windowStart]);

  /**
   * Token refs of phrases adjacent to the currently focused free token. When a free token is in
   * focus, highlights the neighboring phrase boxes statically (without requiring hover), mirroring
   * what the link icon hover would show.
   */

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
                  const { prevGroup, nextGroup, punctuation } = item.slot;
                  if (!prevGroup && !nextGroup && punctuation.length === 0) return undefined;
                  const prevToken = prevGroup?.tokens[prevGroup.tokens.length - 1];
                  const nextToken = nextGroup?.tokens[0];
                  const prevPhraseId = prevGroup?.phraseLink?.analysisId;
                  const nextPhraseId = nextGroup?.phraseLink?.analysisId;
                  const phraseRevealed =
                    prevPhraseId !== undefined &&
                    prevPhraseId === nextPhraseId &&
                    (prevPhraseId === hoveredPhraseId || prevPhraseId === focus.focusedPhraseId);
                  // focusedSideIsPrev: derived from the focused token's actual group index (not the
                  // scroll-position state) so it always agrees with focus.focusedFreeToken /
                  // focus.focusedPhraseLink. The link button's direction and target therefore can
                  // never disagree.
                  const focusedSideIsPrev =
                    focusedGroupIndex !== undefined &&
                    item.prevGroupIndex !== undefined &&
                    item.nextGroupIndex !== undefined
                      ? focusedGroupIndex <= item.prevGroupIndex
                      : undefined;
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
                  const slotFocus = resolveSlotFocus(
                    prevSegId,
                    nextSegId,
                    focus.focusedSegmentId,
                    focusedSideIsPrev,
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
                        onHoverCandidatePhrase={setHoveredPhraseId}
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
                const { group, groupIndex } = item;
                const groupKey = group.tokens[0].ref;
                const isFocused = groupIndex === focusPhraseIndex;
                const editPhraseTokens =
                  phraseMode.kind === 'edit'
                    ? [...committedPhraseLinkByRef.values()].find(
                        (l) => l.analysisId === phraseMode.phraseId,
                      )?.tokens
                    : undefined;
                const phraseId = group.phraseLink?.analysisId;
                const showGlossInput = phraseId === undefined || !seenPhraseIds.has(phraseId);
                if (phraseId !== undefined) seenPhraseIds.add(phraseId);
                const showControls =
                  phraseMode.kind === 'view' &&
                  phraseId !== undefined &&
                  groupIndex === hoveredGroupIndex;
                const arcLevel =
                  phraseId !== undefined ? (arcLevelByPhraseId.get(phraseId) ?? 0) : 0;
                const arcOffsetPx =
                  arcLevel > 0
                    ? ARC_BASE_STEM + arcLevel * ARC_LEVEL_STEP + ARC_CORNER_RADIUS
                    : CONTROLS_HALF_HEIGHT_PX;
                return (
                  <span
                    key={groupKey}
                    ref={(el) => {
                      phraseRefs.current[groupIndex] = el;
                    }}
                    onMouseEnter={
                      phraseId !== undefined
                        ? () => {
                            setHoveredPhraseId(phraseId);
                            setHoveredGroupIndex(groupIndex);
                          }
                        : undefined
                    }
                    onMouseLeave={
                      phraseId !== undefined
                        ? () => {
                            setHoveredPhraseId(undefined);
                            setHoveredGroupIndex(undefined);
                          }
                        : undefined
                    }
                  >
                    <MemoizedPhraseBox
                      arcOffsetPx={arcOffsetPx}
                      editPhraseTokens={editPhraseTokens}
                      index={groupIndex}
                      isFocused={isFocused}
                      isHighlighted={
                        phraseId !== undefined
                          ? phraseId === hoveredPhraseId ||
                            phraseId === focus.focusedPhraseId ||
                            group.tokens.some((t) => candidateTokenRefs.has(t.ref))
                          : group.tokens.some((t) => candidateTokenRefs.has(t.ref))
                      }
                      isSplitFree={group.tokens.some((t) => splitFreeTokenRefs.has(t.ref))}
                      onFocusPhrase={handlePhraseSelect}
                      phraseLink={group.phraseLink}
                      phraseMode={phraseMode}
                      setPhraseMode={setPhraseMode}
                      showControls={showControls}
                      showGlossInput={showGlossInput}
                      tokens={group.tokens}
                    />
                  </span>
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
