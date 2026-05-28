import type { Book, ScriptureRef, Token } from 'interlinearizer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseLinkMap } from './AnalysisStore';
import { isWordToken } from './component-types';
import MemoizedPhraseBox from './PhraseBox';
import { DRAFT_PHRASE_ID, type PhraseMode } from './phrase-mode';
import { MemoizedInertTokenChip } from './TokenChip';
import {
  ARC_BASE_STEM,
  ARC_CORNER_RADIUS,
  ARC_LEVEL_STEP,
  CONTROLS_HALF_HEIGHT_PX,
  buildEffectiveLinkMap,
  computeAllArcPaths,
  groupTokens,
  type ArcPath,
  type TokenGroup,
} from '../utils/phrase-arc';

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
  /**
   * When set, the strip jumps to the group that contains this word-token index. Used to carry over
   * a focused token when switching from segment view.
   */
  activePhraseIndex: number | undefined;
  /** Verse coordinate; when it changes the strip scrolls to the first token of that segment. */
  activeVerse: ScriptureRef;
  /** The full tokenized book whose tokens are streamed into the strip. */
  book: Book;
  /** Called whenever the focused phrase index changes so the parent can mirror the strip position. */
  onFocusPhraseIndexChange: (index: number) => void;
  /** Called when arrow navigation moves the focus into a new verse. */
  onVerseChange: (verse: ScriptureRef) => void;
  /** Current phrase-interaction mode; controls token click behaviour in the strip. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed to phrase boxes so they can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
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
 * @param props.activePhraseIndex - When set, the strip jumps to the group containing this flat
 *   word-token index; used to carry over a focused token when switching from segment view
 * @param props.activeVerse - Verse coordinate; when it changes the strip scrolls to the first
 *   phrase of the matching segment
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.onFocusPhraseIndexChange - Called whenever the focused phrase index changes so the
 *   parent can mirror the strip position
 * @param props.onVerseChange - Called when arrow navigation moves the focus into a new verse
 * @returns A horizontal phrase strip with previous/next navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  activePhraseIndex,
  activeVerse,
  book,
  onFocusPhraseIndexChange,
  onVerseChange,
  phraseMode,
  setPhraseMode,
}: ContinuousViewProps) {
  const isRtl = document.documentElement.dir === 'rtl';

  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  const committedPhraseLinkByRef = usePhraseLinkMap();

  const effectiveLinkMap = useMemo(
    () => buildEffectiveLinkMap(committedPhraseLinkByRef, phraseMode),
    [committedPhraseLinkByRef, phraseMode],
  );

  /** Phrase groups built from the flat token list, respecting the effective phrase-link map. */
  const phraseGroups = useMemo(
    () => groupTokens(allTokens, effectiveLinkMap),
    [allTokens, effectiveLinkMap],
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

  /**
   * Maps each word-token-only index (counting only word tokens, as the parent does) to the group
   * index that contains it. Used to resolve `activePhraseIndex` from the parent to a group index.
   */
  const groupIndexByWordTokenIndex = useMemo(() => {
    // Build ref → word-token-only index from allTokens, matching how Interlinearizer computes
    // activePhraseIndex (filtered to word tokens only, indexed separately from punctuation).
    const wordTokenOnlyIndex = new Map<string, number>();
    let wordIdx = 0;
    allTokens.forEach((t) => {
      if (isWordToken(t)) {
        wordTokenOnlyIndex.set(t.ref, wordIdx);
        wordIdx += 1;
      }
    });

    const map = new Map<number, number>();
    phraseGroups.forEach((g, gi) => {
      g.tokens.forEach((t) => {
        const wi = wordTokenOnlyIndex.get(t.ref);
        if (wi !== undefined) map.set(wi, gi);
      });
    });
    return map;
  }, [phraseGroups, allTokens]);

  /**
   * Ref mirror of `phraseGroups`. Read inside effects and callbacks that need the latest list
   * without declaring it as a dependency.
   */
  const phraseGroupsRef = useRef(phraseGroups);
  phraseGroupsRef.current = phraseGroups;

  /**
   * Ref mirror of `groupIndexByWordTokenIndex`. Read inside the `activePhraseIndex` effect so it
   * never needs to be listed as a dependency (which would cause spurious re-runs whenever phrase
   * membership changes without the parent's `activePhraseIndex` changing).
   */
  const groupIndexByWordTokenIndexRef = useRef(groupIndexByWordTokenIndex);
  groupIndexByWordTokenIndexRef.current = groupIndexByWordTokenIndex;

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
  // correctly before the initial-load fade-in fires. Prefer activePhraseIndex (e.g. a focused token
  // carried over from segment view) so there is no flash to the verse-start position on mount.
  const [focusPhraseIndex, setFocusPhraseIndex] = useState<number>(() => {
    if (activePhraseIndex !== undefined) {
      const gi = groupIndexByWordTokenIndex.get(activePhraseIndex);
      if (gi !== undefined) return clampIndex(gi, phraseGroups.length);
      return clampIndex(activePhraseIndex, phraseGroups.length);
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
   * True when the lazy `useState` initializer already positioned the strip at `activePhraseIndex`,
   * so the first run of the `activePhraseIndex` effect should be skipped to avoid a redundant
   * jump.
   */
  const activePhraseIndexAppliedRef = useRef(activePhraseIndex !== undefined);

  /**
   * Records the verse most recently reported via `onVerseChange`. When the parent echoes that verse
   * back as `activeVerse` we skip the jump — the change originated here, not externally.
   * Initialized to `activeVerse` so the initial mount position (set by the lazy `useState`
   * initializer) is treated as already handled, preventing a spurious jump on first render.
   */
  const lastInternalVerseRef = useRef<ScriptureRef | undefined>(activeVerse);

  // These two effects (activePhraseIndex and activeVerse) could theoretically race: if both props
  // changed in one render, the activeVerse effect would overwrite the activePhraseIndex jump,
  // scrolling to verse-start rather than the exact token. This is safe because Interlinearizer
  // only passes activePhraseIndex when continuousScroll is false (segment mode), where ContinuousView
  // is unmounted. When continuousScroll is true, SegmentView renders in baseline-text mode and
  // onSelect is called without a tokenId, so activePhraseIndex is never set from within continuous
  // mode. Any future change that adds token-level clicks in continuous mode must revisit this.

  // Jump to a specific group index when activePhraseIndex changes.
  useEffect(() => {
    if (activePhraseIndex === undefined) return;

    // Skip the first run when the lazy initializer already positioned the strip here.
    if (activePhraseIndexAppliedRef.current) {
      activePhraseIndexAppliedRef.current = false;
      return;
    }

    // Resolve the flat word-token index from the parent to a group index. The map covers every
    // word token (both first and non-first members of each group), so the lookup always succeeds.
    // Read via ref so this effect only re-runs when activePhraseIndex itself changes.
    const gi = groupIndexByWordTokenIndexRef.current.get(activePhraseIndex);
    /* v8 ignore next -- gi is undefined only if activePhraseIndex is out of range; fallback clamps it */
    const clamped = clampIndex(gi ?? activePhraseIndex, phraseGroupsRef.current.length);
    jumpTargetRef.current = clamped;
    isExternalJumpInProgressRef.current = true;
    setIsVisible(false);
    setPendingExternalJumpPhraseIndex(clamped);
    // groupIndexByWordTokenIndexRef is intentionally excluded — it is a ref so changes are always
    // current without needing to be declared as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhraseIndex]);

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

  /** Ref mirror of `onFocusPhraseIndexChange` so the notification effect never needs it as a dep. */
  const onFocusPhraseIndexChangeRef = useRef(onFocusPhraseIndexChange);
  onFocusPhraseIndexChangeRef.current = onFocusPhraseIndexChange;
  // Intentionally fires on mount with the lazy-initialized focusPhraseIndex. This notifies the
  // parent of the initial strip position so the segment list scrolls the active verse into view
  // on first render. The coupling is load-bearing — do not add an early-return guard here.
  useEffect(() => {
    onFocusPhraseIndexChangeRef.current(focusPhraseIndex);
  }, [focusPhraseIndex]);

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
   * Advances the focused phrase by `delta` positions, clamping to valid bounds.
   *
   * @param delta - Number of phrases to move (positive = forward, negative = backward).
   */
  const step = useCallback((delta: number) => {
    setFocusPhraseIndex((i) => {
      const nextIndex = i + delta;
      /* v8 ignore next -- disabled buttons prevent underflow */
      if (nextIndex < 0) return 0;
      /* v8 ignore next -- disabled buttons prevent overflow */
      if (nextIndex >= phraseGroupsRef.current.length) return phraseGroupsRef.current.length - 1;
      return nextIndex;
    });
  }, []);

  /** Moves focus one phrase backward. */
  const stepPrev = useCallback(() => step(-1), [step]);

  /** Moves focus one phrase forward. */
  const stepNext = useCallback(() => step(1), [step]);

  /**
   * Sets the focused phrase to `index` when provided, ignoring calls with no argument.
   *
   * @param index - Zero-based phrase index to focus, or `undefined` to do nothing.
   */
  const handlePhraseSelect = useCallback((index?: number) => {
    if (index !== undefined) {
      setFocusPhraseIndex((prev) => (prev === index ? prev : index));
    }
  }, []);

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

  /** Ref to the token-strip row so we can measure phrase-box positions for arc drawing. */
  // eslint-disable-next-line no-null/no-null
  const stripRowRef = useRef<HTMLDivElement | null>(null);

  /** SVG arc path strings keyed by phraseId, drawn above the strip for discontiguous phrases. */
  const [arcPaths, setArcPaths] = useState<ArcPath[]>([]);

  /** Nesting level per phraseId; used to compute controls pill offset so it aligns with the arc top. */
  const [arcLevelByPhraseId, setArcLevelByPhraseId] = useState<Map<string, number>>(new Map());

  /** The phraseId whose arc is currently highlighted due to a phrase box being hovered. */
  const [hoveredPhraseId, setHoveredPhraseId] = useState<string | undefined>();

  /** The group index of the phrase box currently being hovered; drives controls placement. */
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | undefined>();

  /** The phraseId of the currently focused phrase group; highlights its arc. */
  const focusPhraseId = phraseGroups[focusPhraseIndex]?.phraseLink?.analysisId;

  /** Maximum nesting level across all visible arcs; drives dynamic top padding. */
  const [maxArcLevel, setMaxArcLevel] = useState(0);

  /** True when any committed (non-draft) phrase exists in the visible window. */
  const hasRealPhraseInWindow = windowGroups.some(
    (g) => g.phraseLink !== undefined && g.phraseLink.analysisId !== DRAFT_PHRASE_ID,
  );

  /**
   * Top padding for the token strip in pixels, sized to fit both arcs and floating phrase controls.
   * BASE_STEM (6) + arc corner radius (5) + breathing room (4) = 15px minimum when any arc exists;
   * each additional nesting level adds LEVEL_STEP (8) pixels. When phrases are visible, the
   * controls pill is centred on the arc top line (or on the box top when no arc), so only its upper
   * half needs extra headroom above the arc padding. A minimum of 8px is kept when neither is
   * present.
   */
  const arcPadding = arcPaths.length > 0 ? 15 + maxArcLevel * 8 : 0;
  const controlsHeadroom = hasRealPhraseInWindow ? CONTROLS_HALF_HEIGHT_PX : 0;
  const stripTopPadding = Math.max(8, arcPadding + controlsHeadroom);

  /**
   * After each render, find all discontiguous phrase groups (same phraseId appearing on multiple
   * `[data-phrase-box]` elements in the strip) and compute a cubic Bézier arc between consecutive
   * runs. Same-row runs get an upward arc; cross-row runs get a downward arc. Only updates state
   * when the serialized path strings actually change to avoid infinite loops.
   */
  useLayoutEffect(() => {
    const row = stripRowRef.current;
    /* v8 ignore next -- ref is always populated when useLayoutEffect fires after DOM commit */
    if (!row) return;
    const { paths, levelByPhraseId, maxLevel } = computeAllArcPaths(row);
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
  }, [windowGroups, phraseMode]);

  /**
   * Interleaved render units in document order across the window: each entry is either a
   * punctuation token or a phrase group. Built by walking `allTokens` in the window range and
   * emitting the appropriate render unit for each position.
   */
  const renderItems = useMemo(() => {
    // Build a set of all non-first word-token refs in window groups so we can skip them.
    const nonFirstRefs = new Set(windowGroups.flatMap((g) => g.tokens.slice(1).map((t) => t.ref)));
    // Map from first-token-ref to the group, for quick lookup.
    const groupByFirstRef = new Map(windowGroups.map((g) => [g.tokens[0].ref, g]));
    // Group index is relative to phraseGroups (not windowGroups), so we need offset.
    const groupIndexOffset = windowStart;

    return allTokens
      .slice(windowStartTokenIndex, windowEndTokenIndex)
      .reduce<
        Array<
          { kind: 'punct'; token: Token } | { kind: 'group'; group: TokenGroup; groupIndex: number }
        >
      >((items, token) => {
        if (!isWordToken(token)) {
          items.push({ kind: 'punct', token });
        } else if (!nonFirstRefs.has(token.ref)) {
          const group = groupByFirstRef.get(token.ref);
          if (group) {
            const groupIndex = windowGroups.indexOf(group) + groupIndexOffset;
            items.push({ kind: 'group', group, groupIndex });
          }
        }
        // Non-first word members are rendered inside their group's PhraseBox above.
        return items;
      }, []);
  }, [allTokens, windowGroups, windowStartTokenIndex, windowEndTokenIndex, windowStart]);

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
          className={`tw:relative tw:overflow-visible tw:transition-opacity ${stripOpacityClass}`}
          style={{
            transitionDuration: `${STRIP_FADE_MS}ms`,
            transitionTimingFunction: STRIP_FADE_EASING,
          }}
        >
          {arcPaths.length > 0 && (
            <svg
              aria-hidden="true"
              className="tw:pointer-events-none tw:absolute tw:inset-0"
              style={{ height: '100%', overflow: 'visible', width: '100%' }}
            >
              {arcPaths.map(({ phraseId, d }) => {
                const isHighlighted = hoveredPhraseId === phraseId || focusPhraseId === phraseId;
                return (
                  <path
                    key={`${phraseId}-${d}`}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={isHighlighted ? 1 : 0.5}
                    strokeWidth={isHighlighted ? 2 : 1.5}
                  />
                );
              })}
            </svg>
          )}
          <div
            data-testid="token-strip"
            className="tw:no-scrollbar tw:flex tw:w-max tw:items-start tw:gap-1 tw:overflow-x-scroll tw:pb-2"
            ref={stripRowRef}
            style={{ paddingTop: `${stripTopPadding}px` }}
          >
            {(() => {
              const seenPhraseIds = new Set<string>();
              return renderItems.map((item) => {
                if (item.kind === 'punct') {
                  return <MemoizedInertTokenChip key={item.token.ref} token={item.token} />;
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
                        phraseId !== undefined &&
                        (phraseId === hoveredPhraseId || phraseId === focusPhraseId)
                      }
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
