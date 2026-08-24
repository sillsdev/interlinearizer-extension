import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon, type SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment, Token } from 'interlinearizer';
import { LocateFixed, Merge } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import useSegmentWindow from '../hooks/useSegmentWindow';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../utils/localized-strings';
import { altKeyHint } from './alt-key-hint';
import { buildSegmentLabels } from '../utils/segment-labels';
import { segmentContainsVerse } from '../utils/verse-ref';
import { buildVerseStartLabels } from '../utils/verse-superscripts';
import { useAltHeldValue } from './AltHeldContext';
import { useFocus, useFocusActions } from './FocusStore';
import { useSegmentation } from './SegmentationStore';
import MemoizedSegmentView from './SegmentView';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/** Localized labels for the between-rows merge control; hoisted so the array reference is stable. */
const MERGE_STRING_KEYS = [
  '%interlinearizer_boundaryControl_merge%',
  '%interlinearizer_boundaryControl_mergeAltHint%',
] as const satisfies `%${string}%`[];

/**
 * Localized strings for the sticky chapter band and the empty state; hoisted so the array reference
 * is stable.
 */
const HEADER_STRING_KEYS = [
  '%interlinearizer_segmentList_scrollToActiveVerse%',
  '%interlinearizer_segmentList_noVerseData%',
] as const satisfies `%${string}%`[];

/** Props for {@link MergeRowButton}. */
type MergeRowButtonProps = Readonly<{
  /** The segment below the gap this button sits in — the one a click joins to its predecessor. */
  segment: Segment;
}>;

/**
 * The merge control rendered in the gap between two adjacent segment rows. Clicking it joins the
 * two neighboring segments — the segment-list counterpart of the continuous strip's cross-segment
 * merge control.
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
function MergeRowButton({ segment }: MergeRowButtonProps) {
  const { dispatch } = useSegmentation();
  const altHeld = useAltHeldValue();
  const [localizedStrings] = useLocalizedStrings(MERGE_STRING_KEYS);
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
    <div className="tw:group/merge tw:relative tw:flex tw:h-4 tw:w-full tw:items-center">
      {/* The solid rail is always present. Hover darkens it (the button never paints an opaque band
          over it), so the line stays continuous through the hover state. */}
      <div
        aria-hidden="true"
        className="tw:w-full tw:border-t tw:border-muted-foreground/50 tw:group-hover/merge:border-muted-foreground"
        data-testid="segment-merge-indicator"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Full-area hit strip: the layout classes (absolute inset-0, h-auto, no padding) override
              the Button size box so it fills the gap, and hover:bg-transparent suppresses the ghost
              variant's hover band — this control deliberately never paints over the rail (see the
              handle's group-hover styling below). */}
          <Button
            aria-label={localizedStrings['%interlinearizer_boundaryControl_merge%']}
            className="tw:absolute tw:inset-0 tw:flex tw:h-auto tw:items-center tw:justify-center tw:rounded tw:p-0 tw:hover:bg-transparent"
            data-testid="segment-merge-btn"
            onClick={() => dispatch.merge(secondSegmentStartRef)}
            tabIndex={-1}
            type="button"
            variant="ghost"
          >
            {/* A solid rounded "handle" riding the rail: a real theme surface (`bg-muted`) so it
                reads coherently over the line, brightening to the accent on hover. Rotated 90° so
                the Y-join points along this view's vertical merge axis (the lower row folds up into
                the one above), unlike the horizontal continuous-strip merge. */}
            <span className="tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:bg-muted tw:p-1 tw:text-muted-foreground tw:group-hover/merge:bg-accent tw:group-hover/merge:text-accent-foreground">
              <Merge className="tw:size-3 tw:rotate-90" />
            </span>
          </Button>
        </TooltipTrigger>
        {mergeTooltip !== undefined && <TooltipContent>{mergeTooltip}</TooltipContent>}
      </Tooltip>
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
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
}: SegmentListViewProps) {
  const { tokenRef: focusedTokenRef } = useFocus();
  const { selectSegment } = useFocusActions();

  const [localizedStrings] = useLocalizedStrings(HEADER_STRING_KEYS);
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

  /** Segment id → the chapter it starts in, for resolving the topmost visible segment's chapter. */
  const chapterBySegmentId = useMemo(() => {
    const map = new Map<string, number>();
    book.segments.forEach((seg) => map.set(seg.id, seg.startRef.chapter));
    return map;
  }, [book.segments]);

  /**
   * Segment ids whose merge-into-predecessor would actually take effect: those with a token-bearing
   * segment immediately before them in the full book. A token-less predecessor (an empty verse
   * marker) forces its own boundary that a merge cannot cross, so removing this segment's start
   * would leave the segments unchanged; offering the merge there would be a silent no-op that still
   * persists a dead boundary in the delta.
   */
  const mergeableSegmentIds = useMemo(() => {
    const ids = new Set<string>();
    book.segments.forEach((seg, i) => {
      if (i > 0 && book.segments[i - 1].tokens.length > 0) ids.add(seg.id);
    });
    return ids;
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

  // Scroll-anchored window into the full book's segment list. Spans chapters, grows/culls at the
  // scrolled edge, and recenters (with a fade) on the active verse when navigation arrives from
  // outside the list.
  const {
    windowSegments,
    isFaded,
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
    onSettled: reportSettled,
  });

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

    const readTopChapter = () => {
      const containerTop = container.getBoundingClientRect().top;
      const els = container.querySelectorAll('[data-segment-id]');
      for (let i = 0; i < els.length; i += 1) {
        const el = els[i];
        // `>=` (not `>`) so a segment flush against the top edge counts as the top segment; a
        // segment fully scrolled above has its bottom strictly less than the container top.
        if (el.getBoundingClientRect().bottom >= containerTop) {
          const id = el.getAttribute('data-segment-id');
          /* v8 ignore next -- the [data-segment-id] selector guarantees a present attribute */
          const chapter = id ? chapterBySegmentId.get(id) : undefined;
          setPinnedChapter(chapter);
          return;
        }
      }
      setPinnedChapter(undefined);
    };

    // Coalesce scroll-driven reads to at most one per animation frame: scroll events fire more often
    // than paints during a fling, and each read scans every mounted segment's bounding rect, so an
    // uncoalesced handler would run that scan several times per frame for no benefit.
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
  }, [scrollContainerRef, chapterBySegmentId, windowSegments]);

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
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:no-scrollbar tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
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
            <div ref={topSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
            {windowSegments.map((seg) => {
              /* v8 ignore next 2 -- the ?? arm is a defensive fallback for the Map.get type: every
                 windowed segment comes from book.segments, so the lookup always resolves */
              const verseStartLabels = verseStartLabelsBySegmentId.get(seg.id) ?? [];
              // Merge control renders above every segment whose merge would take effect (see
              // mergeableSegmentIds). Eligibility is computed over the FULL book, not the mounted
              // window: merge dispatches against the delta, not the DOM, so the topmost windowed
              // segment's boundary with a culled predecessor is still editable.
              const canMerge = mergeableSegmentIds.has(seg.id);
              // Omit the merge control while a phrase mode is active: a merge could re-segment the
              // phrase the mode UI is operating on.
              const showMergeControl = canMerge && phraseMode.kind === 'view';
              return (
                <Fragment key={seg.id}>
                  {showMergeControl && <MergeRowButton segment={seg} />}
                  <MemoizedSegmentView
                    displayMode={displayContinuousScroll ? 'baseline-text' : 'token-chip'}
                    editPhraseSegmentId={editPhraseSegmentId}
                    focusedTokenRef={displayContinuousScroll ? undefined : displayFocusedTokenRef}
                    hoveredPhraseId={hoveredPhraseId}
                    isActive={
                      activeSegmentId !== undefined
                        ? seg.id === activeSegmentId
                        : segmentContainsVerse(seg, displayScrRef)
                    }
                    onHoverPhrase={setHoveredPhraseId}
                    onSelect={selectSegment}
                    phraseMode={phraseMode}
                    setPhraseMode={setPhraseMode}
                    segment={seg}
                    verseStartLabels={verseStartLabels}
                    gutterLabel={gutterLabelsBySegmentId.get(seg.id)}
                    tokenSegmentMap={tokenSegmentMap}
                    tokenDocOrder={tokenDocOrder}
                    wordTokenByRef={wordTokenByRef}
                    viewOptions={viewOptions}
                  />
                </Fragment>
              );
            })}
            <div ref={bottomSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
          </div>
        )}
        <div data-snap-spacer aria-hidden="true" />
      </div>
    </div>
  );
}
