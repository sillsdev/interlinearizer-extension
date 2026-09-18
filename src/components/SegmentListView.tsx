import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon, type SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment, Token } from 'interlinearizer';
import { LocateFixed, Merge } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useHydrationRange from '../hooks/useHydrationRange';
import useSegmentHeights from '../hooks/useSegmentHeights';
import useSegmentWindow from '../hooks/useSegmentWindow';
import type { HeightConfig } from '../utils/segment-heights';
import { offsetOfSegment, segmentIndexAtOffset } from '../utils/segment-heights';
import useLatestRef from '../hooks/useLatestRef';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../utils/localized-strings';
import { altKeyHint } from './alt-key-hint';
import { buildSegmentLabels } from '../utils/segment-labels';
import { segmentContainsVerse } from '../utils/verse-ref';
import { buildVerseStartLabels } from '../utils/verse-superscripts';
import { useAltHeldValue } from './AltHeldContext';
import { useAnalysisReadOnly, useFreeTranslationsBySegment } from './AnalysisStore';
import { useFocus, useFocusActions } from './FocusStore';
import { useSegmentation } from './SegmentationStore';
import MemoizedSegmentView, { SEGMENT_STRING_KEYS, type SegmentDisplayMode } from './SegmentView';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/** The list's own row spacing between one rendered segment and the next, in pixels. */
const SEGMENT_ROW_GAP_PX = 8;

/**
 * Resolves a predicted height-table index to the segment whose laid-out box touches the container's
 * top edge, since predicted and real heights can name different segments near a chapter boundary. A
 * guess from outside the mounted range settles against the nearest mounted segment.
 *
 * @returns The `guess` unchanged only where no laid-out box can settle it: when the mounted run
 *   reports zero height.
 */
function correctIndexAgainstLayout(
  container: HTMLElement,
  guess: number,
  range: { start: number; end: number },
): number {
  const start = Math.max(guess, range.start);
  const clampedGuess = Math.min(start, range.end - 1);
  const containerTop = container.getBoundingClientRect().top;
  // Mounted segments sit in book order, so the element at position `i` is book index
  // `range.start + i`.
  const els = container.querySelectorAll('[data-segment-id]');

  const rectOf = (index: number) => els[index - range.start]?.getBoundingClientRect();

  // An unlaid-out run reports every box at zero, which would read as every segment touching the top
  // edge and collapse the walk onto the first mounted one.
  const guessRect = rectOf(clampedGuess);
  /* v8 ignore next -- every index inside the mounted range has its element in the DOM */
  if (!guessRect || guessRect.height === 0) return guess;

  // `>=` (not `>`) so a segment flush against the top edge counts as the top segment; a segment
  // fully scrolled above has its bottom strictly less than the container top.
  const touchesTop = (index: number) => {
    const rect = rectOf(index);
    /* v8 ignore next -- the walk stays inside the mounted range, where every element is present */
    return rect ? rect.bottom >= containerTop : true;
  };

  if (guessRect.bottom >= containerTop) {
    let index = clampedGuess;
    while (index > range.start && touchesTop(index - 1)) index -= 1;
    return index;
  }

  // The guess sits entirely above the top edge, so the answer is below it rather than above.
  let index = clampedGuess;
  while (index < range.end - 1 && !touchesTop(index)) index += 1;
  return index;
}

/**
 * Additional vertical space, in pixels, between two segments a merge control sits between. Charged
 * only where that control actually renders, since a gap without one is {@link SEGMENT_ROW_GAP_PX}
 * and no more.
 */
const MERGE_CONTROL_GAP_PX = 24;

/**
 * Localized strings resolved once for the whole list — the chapter band, the empty state, and every
 * mounted segment's and merge control's labels.
 */
const LIST_STRING_KEYS = [
  '%interlinearizer_segmentList_scrollToActiveVerse%',
  '%interlinearizer_segmentList_noVerseData%',
  ...SEGMENT_STRING_KEYS,
] as const satisfies `%${string}%`[];

/** Props for {@link MergeRowButton}. */
type MergeRowButtonProps = Readonly<{
  /** The segment below the gap this button sits in — the one a click joins to its predecessor. */
  segment: Segment;
  /** Resolved {@link LIST_STRING_KEYS}, supplied rather than subscribed to per gap. */
  localizedStrings: LanguageStrings;
}>;

/**
 * The merge control rendered in the gap between two adjacent segment rows. Clicking its center icon
 * joins the two neighboring segments — the segment-list counterpart of the continuous strip's
 * cross-segment merge control.
 *
 * Always visible and always enabled: merging needs no Alt (splitting stays Alt-gated). The tooltip
 * is stateful — while Alt is not held it carries the Alt-split discoverability hint (the split
 * markers are hidden then), dropping to the concise merge string once Alt is held; the `aria-label`
 * stays the concise merge string in both states.
 *
 * The caller omits this control entirely while a phrase mode is active (a merge could re-segment
 * the phrase the mode UI is operating on), so this component itself has no disabled state.
 *
 * @returns The fixed-height row gap with its rail and always-enabled merge button; `undefined` when
 *   the segment has no tokens.
 */
function MergeRowButton({ segment, localizedStrings }: MergeRowButtonProps) {
  const { dispatch } = useSegmentation();
  const altHeld = useAltHeldValue();
  const secondSegmentStartRef = segment.tokens[0]?.ref;
  /* v8 ignore next -- a rendered segment always has at least one token */
  if (secondSegmentStartRef === undefined) return undefined;
  // Only the tooltip is resolved-or-empty: an unresolved `%…%` localize key would otherwise be
  // visible hover text. The `aria-label` below keeps the raw value — emptying it would leave the
  // button with no accessible name at all.
  const mergeTooltip = tooltipContentOrUndefined(
    altHeld
      ? resolvedOrEmpty(localizedStrings['%interlinearizer_boundaryControl_merge%'])
      : altKeyHint(
          resolvedOrEmpty(localizedStrings['%interlinearizer_boundaryControl_mergeAltHint%']),
        ),
  );
  return (
    <div className="tw:relative tw:flex tw:h-4 tw:w-full tw:items-center">
      {/* Only the icon is clickable, because a clickable rail would invite accidental merges. The
          handle precedes the rail so the rail can `peer-hover` to darken with the handle; absolute
          positioning keeps it centered on the rail regardless. */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A solid rounded handle riding the rail: a real theme surface (`bg-muted`) so it reads
              coherently over the line. Rotated 90° so the Y-join arms straddle the rail (the upper
              and lower rows merging together). */}
          <Button
            aria-label={localizedStrings['%interlinearizer_boundaryControl_merge%']}
            className="tw:peer/merge tw:absolute tw:left-1/2 tw:top-1/2 tw:inline-flex tw:h-auto tw:-translate-x-1/2 tw:-translate-y-1/2 tw:items-center tw:justify-center tw:rounded tw:bg-muted tw:p-1 tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground"
            data-testid="segment-merge-btn"
            onClick={() => dispatch.merge(secondSegmentStartRef)}
            tabIndex={-1}
            type="button"
            variant="ghost"
          >
            <Merge className="tw:size-3 tw:rotate-90" />
          </Button>
        </TooltipTrigger>
        {mergeTooltip !== undefined && <TooltipContent>{mergeTooltip}</TooltipContent>}
      </Tooltip>
      <div
        aria-hidden="true"
        className="tw:w-full tw:border-t tw:border-muted-foreground/50 tw:peer-hover/merge:border-muted-foreground"
        data-testid="segment-merge-indicator"
      />
    </div>
  );
}

/** Props for {@link SegmentListView}. */
type SegmentListViewProps = Readonly<{
  /** Tokenized book whose segments are windowed and rendered. */
  book: Book;
  /** Current scripture reference; its verse is the recenter anchor and active-verse highlight. */
  scrRef: SerializedVerseRef;
  /**
   * Monotonic counter bumped on every boundary edit, so that when the segments identity changes a
   * boundary edit (redraw in place) can be told apart from a re-tokenization of the loaded book
   * (recenter with a fade).
   */
  segmentationVersion: number;
  /** When true, the horizontal token strip is shown above this list (changes display mode). */
  continuousScroll: boolean;
  /**
   * Continuous-scroll mode the segments actually render. Owned by the parent and updated through
   * {@link SegmentListViewProps.onDisplayContinuousScrollChange} at the recenter midpoint, so the
   * parent's strip and this list's display mode swap in the same React commit, behind the fade.
   */
  displayContinuousScroll: boolean;
  /**
   * Reports the gated continuous-scroll value — the mode that should actually be rendered, which a
   * toggle defers to the recenter midpoint (behind the fade). Called inside the midpoint state
   * batch, so the parent's strip mounts/unmounts in the same commit as this list's window rebuild.
   */
  onDisplayContinuousScrollChange: (displayContinuousScroll: boolean) => void;
  /**
   * Consumes the internal-navigation classification for a reference so the window can suppress its
   * recenter fade for navigation that originated within the views.
   */
  consumeInternalNav: (ref: SerializedVerseRef) => boolean;
  /** Reports that the window has settled on the current book; lifts the cross-book curtain. */
  reportSettled: () => void;
  /** Current phrase-interaction mode; passed through to each {@link SegmentView}. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; passed down so child components can transition modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Bundled display toggles forwarded unchanged to each {@link SegmentView}. */
  viewOptions: ViewOptions;
  /** PhraseId currently hovered anywhere in the interlinearizer; shared across all SegmentViews. */
  hoveredPhraseId: string | undefined;
  /** Sets the hovered phraseId when the pointer enters or leaves a phrase box. */
  setHoveredPhraseId: (phraseId: string | undefined) => void;
  /** Segment id that contains the phrase currently being edited, or `undefined`. */
  editPhraseSegmentId: string | undefined;
  /** Word token ref → the verbatim baseline text separating it from the previous word. */
  gapTextByWordRef: ReadonlyMap<string, string>;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to its flat book-level index; used to sort phrase tokens. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Maps every word token ref to the token; the input for resolving focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
}>;

/**
 * Renders the scroll-anchored, infinitely-scrolling list of segments for the active book. Owns the
 * scroll container, the mounted window into the book's segments, the LocateFixed "scroll to active
 * verse" button, the recenter fade wrapper, and the top/bottom infinite-scroll sentinels. Keeps the
 * list — which carries the bulk of the scroll/fade/window machinery — in one focused component.
 */
export default function SegmentListView({
  book,
  scrRef,
  segmentationVersion,
  continuousScroll,
  displayContinuousScroll,
  onDisplayContinuousScrollChange,
  consumeInternalNav,
  reportSettled,
  phraseMode,
  setPhraseMode,
  viewOptions,
  hoveredPhraseId,
  setHoveredPhraseId,
  editPhraseSegmentId,
  gapTextByWordRef,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
}: SegmentListViewProps) {
  const { tokenRef: focusedTokenRef } = useFocus();
  const { selectSegment } = useFocusActions();
  const readOnly = useAnalysisReadOnly();

  const [localizedStrings] = useLocalizedStrings(LIST_STRING_KEYS);
  const recenterTooltip = tooltipContentOrUndefined(
    resolvedOrEmpty(localizedStrings['%interlinearizer_segmentList_scrollToActiveVerse%']),
  );
  /**
   * Inline verse-superscript labels for every segment (chapter-qualified where a verse start opens
   * a new chapter), keyed by segment id. Computed over the whole `book.segments` list (not just the
   * mounted window) so the qualification is stable regardless of which slice happens to be
   * mounted.
   */
  const verseStartLabelsBySegmentId = useMemo(
    () => buildVerseStartLabels(book.segments),
    [book.segments],
  );

  /**
   * Verse-range gutter label for every segment (`5`, `2–3`, `29–2:1`), keyed by segment id.
   * Computed over the whole `book.segments` list (not just the mounted window) so cross-chapter
   * ranges resolve the same regardless of which slice is mounted.
   */
  const gutterLabelsBySegmentId = useMemo(() => buildSegmentLabels(book.segments), [book.segments]);

  // English book name for the sticky chapter header, e.g. "John" (USJ verse markers carry no book
  // name; a platform-localized name would need PAPI wiring this view does not yet have).
  const bookName = useMemo(() => Canon.bookIdToEnglishName(book.bookRef), [book.bookRef]);

  /** Chapter each segment starts in, index-aligned with the book, for the pinned header. */
  const chapterByIndex = useMemo(
    () => book.segments.map((seg) => seg.startRef.chapter),
    [book.segments],
  );
  const chapterByIndexRef = useLatestRef(chapterByIndex);

  /**
   * Segments whose merge-into-predecessor would actually take effect: those with a token-bearing
   * segment immediately before them in the full book. A token-less predecessor (an empty verse
   * marker) forces its own boundary that a merge cannot cross, so removing this segment's start
   * would leave the segments unchanged; offering the merge there would be a silent no-op that still
   * persists a dead boundary in the delta. Keyed both by id and by book index.
   */
  const { mergeableSegmentIds, mergeableSegmentIndexes } = useMemo(() => {
    const ids = new Set<string>();
    const indexes = new Set<number>();
    book.segments.forEach((seg, i) => {
      if (i > 0 && book.segments[i - 1].tokens.length > 0) {
        ids.add(seg.id);
        indexes.add(i);
      }
    });
    return { mergeableSegmentIds: ids, mergeableSegmentIndexes: indexes };
  }, [book.segments]);

  const scrollContainerRef = useRef<HTMLDivElement | undefined>(undefined);

  /**
   * Ref callback that stores the scroll container element so imperative scroll calls can target it.
   *
   * @param el - The mounted div, or `null` on unmount.
   */
  const setScrollContainer = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el ?? undefined;
  }, []);

  /** Whether the current state offers merge controls at all, before per-segment eligibility. */
  const showsMergeControls = phraseMode.kind === 'view' && !readOnly;

  /** Extra gap above a segment, charged only where the merge control actually renders. */
  const extraGapPx = useCallback(
    (index: number) =>
      showsMergeControls && mergeableSegmentIndexes.has(index) ? MERGE_CONTROL_GAP_PX : 0,
    [showsMergeControls, mergeableSegmentIndexes],
  );

  const freeTranslationsBySegment = useFreeTranslationsBySegment();

  /**
   * The free translation a segment renders as wrapping text, which only the read-only view does:
   * the editable view renders a one-line input for every segment whatever it holds.
   */
  const freeTranslationText = useCallback(
    (index: number) => freeTranslationsBySegment.get(book.segments[index].id),
    [freeTranslationsBySegment, book.segments],
  );

  /**
   * Which segment renders as chips, so the height model can charge it a chip row where every other
   * segment is charged plain text. Follows the focused token's segment, which is what the rendered
   * highlight follows: every portion of a verse split mid-verse contains that verse, so matching on
   * the verse alone would always resolve the first portion and model the wrong one. Falls back to
   * the verse for a focus that names no segment.
   */
  const activeSegmentIndex = useMemo(() => {
    const focusedSegmentId = focusedTokenRef ? tokenSegmentMap.get(focusedTokenRef) : undefined;
    const focusedIndex = focusedSegmentId
      ? book.segments.findIndex((seg) => seg.id === focusedSegmentId)
      : -1;
    if (focusedIndex !== -1) return focusedIndex;
    return book.segments.findIndex((seg) => segmentContainsVerse(seg, scrRef));
  }, [book.segments, scrRef, focusedTokenRef, tokenSegmentMap]);

  // Heights model the settled layout — every segment at its chip height — never the transient
  // hydration state. Charging an unhydrated segment its plain-text height instead would move the
  // scrollbar and every thumb-drag target as segments hydrate.
  const heightConfig = useMemo<HeightConfig>(
    () => ({
      displayMode: displayContinuousScroll ? 'baseline-text' : 'token-chip',
      showMorphology: viewOptions.showMorphology,
      showFreeTranslation: viewOptions.showFreeTranslation,
      freeTranslationText: readOnly ? freeTranslationText : undefined,
      segmentGapPx: SEGMENT_ROW_GAP_PX,
      extraGapPx,
    }),
    [
      displayContinuousScroll,
      viewOptions.showMorphology,
      viewOptions.showFreeTranslation,
      readOnly,
      freeTranslationText,
      extraGapPx,
    ],
  );

  const heightTable = useSegmentHeights({
    book,
    config: heightConfig,
    containerRef: scrollContainerRef,
    // The gutter narrows the wrap box without resizing the container, so no resize announces it.
    wrapWidthTrigger: viewOptions.showVerseGutter,
  });
  const heightTableRef = useLatestRef(heightTable);

  // Scroll-anchored window into the full book's segment list. Spans chapters, grows/culls at the
  // scrolled edge, and recenters (with a fade) on the active verse when navigation arrives from
  // outside the list.
  const {
    windowSegments,
    range,
    isFaded,
    isSkimmingRef,
    displayScrRef,
    displayFocusedTokenRef,
    topSentinelRef,
    bottomSentinelRef,
    contentRef,
    recenterOnActive,
  } = useSegmentWindow({
    book,
    scrRef,
    segmentationVersion,
    focusedTokenRef,
    continuousScroll,
    scrollContainerRef,
    consumeInternalNav,
    onDisplayContinuousScrollChange,
    heightTable,
    onSettled: reportSettled,
  });

  const { hydrated } = useHydrationRange({
    table: heightTable,
    scrollContainerRef,
    isSkimmingRef,
    activeIndex: activeSegmentIndex === -1 ? undefined : activeSegmentIndex,
  });

  /**
   * What a segment renders as: continuous-scroll mode shows every segment as baseline text, and an
   * unhydrated segment stands in with plain text until its chips are mounted.
   */
  const segmentDisplayMode = useCallback(
    (index: number): SegmentDisplayMode =>
      displayContinuousScroll || !hydrated(index) ? 'baseline-text' : 'token-chip',
    [displayContinuousScroll, hydrated],
  );

  const rangeRef = useLatestRef(range);

  /** Height of the segments above the mounted window. */
  const leadingSpacerPx = offsetOfSegment(heightTable, range.start);

  /** Height of the segments below the mounted window. */
  const trailingSpacerPx = heightTable.total - offsetOfSegment(heightTable, range.end);

  // Recenter the segment list on the active verse when switching between continuous and segment
  // modes. Skips the initial mount: the window is already built centered on the anchor there, so a
  // recenter would needlessly fade. Only an actual mode toggle should fade-and-recenter.
  // `recenterOnActive` has a stable identity, so listing it as a dep doesn't re-fire this.
  const didMountModeSwitchRef = useRef(false);
  useEffect(() => {
    if (!didMountModeSwitchRef.current) {
      didMountModeSwitchRef.current = true;
      return;
    }
    recenterOnActive();
  }, [continuousScroll, recenterOnActive]);

  // Segment that wears the active highlight. Follows the focused token's segment so the highlight
  // lands on the segment whose token is focused — including a verse-0 superscription — and falls
  // back to the active verse when nothing is focused (e.g. the active verse has no word token).
  const activeSegmentId = displayFocusedTokenRef
    ? tokenSegmentMap.get(displayFocusedTokenRef)
    : undefined;

  /**
   * Chapter shown in the pinned header: the chapter of the topmost segment still touching the
   * container's top edge. A single always-mounted overlay rather than a per-segment sticky element,
   * so it survives the window culling its segments as they scroll off.
   */
  const [pinnedChapter, setPinnedChapter] = useState<number | undefined>(undefined);

  // Track the topmost visible segment's chapter from scroll position (plus resize/content changes),
  // updating state only when the chapter actually changes so scrolling within a chapter causes no
  // re-render. Read-only — it never touches scrollTop, so it cannot interfere with the
  // recenter/compensation machinery.
  useEffect(() => {
    const container = scrollContainerRef.current;
    /* v8 ignore next -- the effect only runs while the list (and so the container) is mounted */
    if (!container) return undefined;

    // The table covers the whole book at no layout cost but only predicts heights, so its answer is
    // a guess the mounted rects then settle. Measuring from the guess keeps a scrollbar drag off the
    // per-segment rect scan a rect-only reading would run on every frame.
    const readTopChapter = () => {
      const guess = segmentIndexAtOffset(heightTableRef.current, container.scrollTop);
      const index = correctIndexAgainstLayout(container, guess, rangeRef.current);
      setPinnedChapter(chapterByIndexRef.current[index]);
    };

    // Coalesce scroll-driven reads to at most one per animation frame: scroll events fire more often
    // than paints during a fling, and the pinned chapter can only change once per painted frame.
    let rafId: number | undefined;
    const onScroll = () => {
      if (rafId !== undefined) return;
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        readTopChapter();
      });
    };

    readTopChapter();
    container.addEventListener('scroll', onScroll, { passive: true });
    // The resize/content-change path reads synchronously: these fire far less often than scroll and
    // must settle the pinned chapter in the same frame the layout changed, without a frame of lag.
    const resizeObserver = new ResizeObserver(readTopChapter);
    resizeObserver.observe(container);
    return () => {
      // Cancel a scroll-scheduled frame still pending at cleanup so it can't run readTopChapter after
      // the container is detached or the effect re-runs.
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      container.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
    };
  }, [scrollContainerRef, chapterByIndexRef, heightTableRef, rangeRef]);

  return (
    <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
      {/* Chapter header band — a real row above the scroll area, not an overlay inside it, so
          scrolled content can never render behind it. The recenter button shares this row. Kept as
          one always-mounted band (not per-segment) so it survives the window culling its segments as
          they scroll off, its label following the chapter of the topmost visible segment. */}
      {windowSegments.length > 0 && (
        <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-border tw:bg-background tw:px-4 tw:py-2">
          <span className="tw:text-sm tw:font-semibold tw:text-foreground">
            {pinnedChapter !== undefined ? `${bookName} ${pinnedChapter}` : ''}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={localizedStrings['%interlinearizer_segmentList_scrollToActiveVerse%']}
                onClick={recenterOnActive}
                tabIndex={-1}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <LocateFixed className="tw:size-4" />
              </Button>
            </TooltipTrigger>
            {recenterTooltip !== undefined && <TooltipContent>{recenterTooltip}</TooltipContent>}
          </Tooltip>
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
        // The window hook owns scroll-position corrections (extend anchoring, above-viewport
        // compensation, recenter snaps); the browser's native scroll anchoring would apply its own
        // heuristic adjustments on top of them and double-correct, so it is disabled here.
        style={{ overflowAnchor: 'none' }}
      >
        {windowSegments.length === 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            {formatReplacementString(
              localizedStrings['%interlinearizer_segmentList_noVerseData%'],
              { book: bookName, chapter: scrRef.chapterNum },
            )}
          </p>
        )}

        {windowSegments.length > 0 && (
          <div
            ref={contentRef}
            className="tw:flex tw:flex-col tw:gap-2 tw:transition-opacity"
            style={{ opacity: isFaded ? 0 : 1, ...RECENTER_FADE_TRANSITION_STYLE }}
          >
            {/* Paired with the trailing spacer below, these stand in for the unmounted segments so
                the container scrolls the whole book rather than the mounted slice. The negative
                margins cancel the column gap beside each spacer, which the height table does not
                model. */}
            <div
              aria-hidden="true"
              className="tw:-mb-2"
              data-leading-spacer
              style={{ height: `${leadingSpacerPx}px`, flex: 'none' }}
            />
            {/* The negative margin cancels the sentinel's own height and the column gap below it,
                neither of which the height table models. */}
            <div
              ref={topSentinelRef}
              aria-hidden="true"
              data-sentinel="top"
              className="tw:-mb-[calc(0.5rem+1px)] tw:h-px tw:w-full"
            />
            {windowSegments.map((seg, windowIndex) => {
              /** Index of this segment in the full book, which hydration and heights are keyed on. */
              const bookIndex = range.start + windowIndex;
              /* v8 ignore next 2 -- the ?? arm is a defensive fallback for the Map.get type: every
                 windowed segment comes from book.segments, so the lookup always resolves */
              const verseStartLabels = verseStartLabelsBySegmentId.get(seg.id) ?? [];
              // Merge control renders above every segment whose merge would take effect (see
              // mergeableSegmentIds). Eligibility is computed over the FULL book, not the mounted
              // window: merge dispatches against the delta, not the DOM, so the topmost windowed
              // segment's boundary with a culled predecessor is still editable.
              const canMerge = mergeableSegmentIds.has(seg.id);
              // Omit the merge control while a phrase mode is active (a merge could re-segment the
              // phrase the mode UI is operating on) and for a read-only analysis, which offers no
              // boundary editing at all.
              const showMergeControl = canMerge && showsMergeControls;
              const isActive =
                activeSegmentId !== undefined
                  ? seg.id === activeSegmentId
                  : segmentContainsVerse(seg, displayScrRef);
              const displayMode = segmentDisplayMode(bookIndex);
              // A stand-in holds the height its chips will occupy so hydrating shifts nothing below
              // it; a segment rendering as baseline text in its own right takes its natural height.
              // The table folds the gap above a segment into its height, leaving none above the
              // first; the reserved height is the segment's own box, so that gap comes back off.
              const gapAbovePx = bookIndex === 0 ? 0 : SEGMENT_ROW_GAP_PX + extraGapPx(bookIndex);
              const placeholderHeightPx =
                displayMode === 'baseline-text' && !displayContinuousScroll
                  ? heightTable.heights[bookIndex] - gapAbovePx
                  : undefined;
              return (
                <Fragment key={seg.id}>
                  {showMergeControl && (
                    <MergeRowButton segment={seg} localizedStrings={localizedStrings} />
                  )}
                  <MemoizedSegmentView
                    displayMode={displayMode}
                    placeholderHeightPx={placeholderHeightPx}
                    editPhraseSegmentId={editPhraseSegmentId}
                    focusedTokenRef={
                      displayMode === 'baseline-text' ? undefined : displayFocusedTokenRef
                    }
                    gapTextByWordRef={gapTextByWordRef}
                    localizedStrings={localizedStrings}
                    gutterLabel={gutterLabelsBySegmentId.get(seg.id)}
                    hoveredPhraseId={hoveredPhraseId}
                    isActive={isActive}
                    onHoverPhrase={setHoveredPhraseId}
                    onSelect={selectSegment}
                    phraseMode={phraseMode}
                    setPhraseMode={setPhraseMode}
                    segment={seg}
                    verseStartLabels={verseStartLabels}
                    tokenSegmentMap={tokenSegmentMap}
                    tokenDocOrder={tokenDocOrder}
                    wordTokenByRef={wordTokenByRef}
                    viewOptions={viewOptions}
                  />
                </Fragment>
              );
            })}
            <div
              ref={bottomSentinelRef}
              aria-hidden="true"
              data-sentinel="bottom"
              className="tw:-mt-[calc(0.5rem+1px)] tw:h-px tw:w-full"
            />
            <div
              aria-hidden="true"
              className="tw:-mt-2"
              data-trailing-spacer
              style={{ height: `${trailingSpacerPx}px`, flex: 'none' }}
            />
          </div>
        )}
        <div data-snap-spacer aria-hidden="true" />
      </div>
    </div>
  );
}
