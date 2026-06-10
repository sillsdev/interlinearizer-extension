import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Token } from 'interlinearizer';
import { LocateFixed } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseMode } from '../types/phrase-mode';
import MemoizedSegmentView from './SegmentView';
import useSegmentWindow from '../hooks/useSegmentWindow';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/** Props for {@link SegmentListView}. */
type SegmentListViewProps = Readonly<{
  /** Tokenized book whose segments are windowed and rendered. */
  book: Book;
  /** Current scripture reference; its verse is the recenter anchor and active-verse highlight. */
  scrRef: SerializedVerseRef;
  /** Token ref of the currently focused word token, or `undefined` when nothing is focused. */
  focusedTokenRef: string | undefined;
  /** When true, the horizontal token strip is shown above this list (changes display mode). */
  continuousScroll: boolean;
  /**
   * Reports the gated continuous-scroll value — the mode that should actually be rendered, which a
   * toggle defers to the recenter midpoint (behind the fade). Forwarded straight into
   * {@link useSegmentWindow}, which calls it inside the midpoint state batch so the parent's strip
   * mounts/unmounts in the same commit as this list's window rebuild.
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
  /** When true, link buttons between phrases are hidden in segments other than the active verse. */
  hideInactiveLinkButtons: boolean;
  /** When true, phrase-level controls are hidden on every phrase except the focused one. */
  simplifyPhrases: boolean;
  /**
   * When true, every verse is labeled `chapter:verse` and no inline chapter header is shown; when
   * false, verse labels stay bare verse numbers and an inline chapter header precedes the first
   * verse of each chapter.
   */
  chapterLabelInVerse: boolean;
  /** PhraseId currently hovered anywhere in the interlinearizer; shared across all SegmentViews. */
  hoveredPhraseId: string | undefined;
  /** Sets the hovered phraseId when the pointer enters or leaves a phrase box. */
  setHoveredPhraseId: (phraseId: string | undefined) => void;
  /** Segment id that contains the phrase currently being edited, or `undefined`. */
  editPhraseSegmentId: string | undefined;
  /** Called when a segment or one of its word tokens is selected. */
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to its flat book-level index; used to sort phrase tokens. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Maps every word token ref to the token; used by segments to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
}>;

/**
 * Renders the scroll-anchored, infinitely-scrolling list of segments for the active book. Owns the
 * scroll container, the {@link useSegmentWindow} window into the book's segments, the LocateFixed
 * "scroll to active verse" button, the recenter fade wrapper, and the top/bottom infinite-scroll
 * sentinels. Extracted from {@link Interlinearizer} so the list — which carries the bulk of the
 * scroll/fade/window machinery — lives in one focused component.
 *
 * @param props - Component props
 * @param props.book - Tokenized book whose segments are windowed and rendered.
 * @param props.scrRef - Current scripture reference; its verse is the recenter anchor.
 * @param props.focusedTokenRef - Token ref of the currently focused word token, or `undefined`.
 * @param props.continuousScroll - When true, the horizontal token strip is shown above this list.
 * @param props.onDisplayContinuousScrollChange - Reports the gated continuous-scroll value
 *   (deferred to the recenter midpoint) so the parent mounts/unmounts the strip in lockstep with
 *   this list.
 * @param props.consumeInternalNav - Consumes the internal-nav classification to suppress the fade.
 * @param props.reportSettled - Reports the window has settled; lifts the cross-book curtain.
 * @param props.phraseMode - Current phrase-interaction mode passed down for rendering.
 * @param props.setPhraseMode - Setter for `phraseMode`.
 * @param props.hideInactiveLinkButtons - When true, link buttons are hidden outside the active
 *   verse.
 * @param props.simplifyPhrases - When true, phrase controls are hidden except on the focused
 *   phrase.
 * @param props.chapterLabelInVerse - When true, every verse is labeled `chapter:verse` instead of
 *   showing an inline chapter header.
 * @param props.hoveredPhraseId - PhraseId currently hovered anywhere in the interlinearizer.
 * @param props.setHoveredPhraseId - Sets the hovered phraseId.
 * @param props.editPhraseSegmentId - Segment id containing the phrase being edited, or `undefined`.
 * @param props.onSelect - Called when a segment or one of its word tokens is selected.
 * @param props.tokenSegmentMap - Token ref → segment id lookup.
 * @param props.tokenDocOrder - Word token ref → flat book-level index.
 * @param props.wordTokenByRef - Word token ref → token lookup for the whole book.
 * @returns The scrollable segment list with its fade wrapper, sentinels, and locate button.
 */
export default function SegmentListView({
  book,
  scrRef,
  focusedTokenRef,
  continuousScroll,
  onDisplayContinuousScrollChange,
  consumeInternalNav,
  reportSettled,
  phraseMode,
  setPhraseMode,
  hideInactiveLinkButtons,
  simplifyPhrases,
  chapterLabelInVerse,
  hoveredPhraseId,
  setHoveredPhraseId,
  editPhraseSegmentId,
  onSelect,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
}: SegmentListViewProps) {
  /**
   * Ids of the segments that begin a new chapter — the first segment of the book and every segment
   * whose chapter differs from the immediately preceding segment in book order. Computed over the
   * whole `book.segments` list (not just the mounted window) so a chapter boundary is detected even
   * when the chapter's first segment scrolls in mid-window, and so the marker never depends on
   * which slice happens to be mounted.
   */
  const chapterStartIds = useMemo(() => {
    const ids = new Set<string>();
    let prevChapter: number | undefined;
    book.segments.forEach((seg) => {
      if (seg.startRef.chapter !== prevChapter) ids.add(seg.id);
      prevChapter = seg.startRef.chapter;
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
    displayContinuousScroll,
    topSentinelRef,
    bottomSentinelRef,
    recenterOnActive,
  } = useSegmentWindow({
    book,
    scrRef,
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

  return (
    <div
      ref={setScrollContainer}
      className="tw:no-scrollbar tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
    >
      {windowSegments.length === 0 && (
        <p className="tw:text-sm tw:text-muted-foreground">
          No verse data for {scrRef.book} {scrRef.chapterNum}.
        </p>
      )}

      {windowSegments.length > 0 && (
        <>
          <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:justify-end tw:pointer-events-none">
            <button
              aria-label="Scroll to active verse"
              className="tw:rounded tw:p-1 tw:text-foreground tw:bg-background tw:hover:bg-muted/50 tw:pointer-events-auto"
              tabIndex={-1}
              onClick={recenterOnActive}
              type="button"
            >
              <LocateFixed className="tw:h-4 tw:w-4" />
            </button>
          </div>

          <div
            className="tw:flex tw:flex-col tw:gap-2 tw:transition-opacity"
            style={{ opacity: isFaded ? 0 : 1, ...RECENTER_FADE_TRANSITION_STYLE }}
          >
            <div ref={topSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
            {windowSegments.map((seg) => (
              <Fragment key={seg.id}>
                {!chapterLabelInVerse && chapterStartIds.has(seg.id) && (
                  <span className="tw:block tw:border-b tw:border-border tw:pb-1 tw:text-sm tw:font-semibold tw:text-foreground">
                    {`Chapter ${seg.startRef.chapter}`}
                  </span>
                )}
                <MemoizedSegmentView
                  displayMode={displayContinuousScroll ? 'baseline-text' : 'token-chip'}
                  editPhraseSegmentId={editPhraseSegmentId}
                  focusedTokenRef={displayContinuousScroll ? undefined : displayFocusedTokenRef}
                  hoveredPhraseId={hoveredPhraseId}
                  isActive={
                    seg.startRef.book === displayScrRef.book &&
                    seg.startRef.chapter === displayScrRef.chapterNum &&
                    seg.startRef.verse === displayScrRef.verseNum
                  }
                  onHoverPhrase={setHoveredPhraseId}
                  onSelect={onSelect}
                  phraseMode={phraseMode}
                  setPhraseMode={setPhraseMode}
                  segment={seg}
                  tokenSegmentMap={tokenSegmentMap}
                  tokenDocOrder={tokenDocOrder}
                  wordTokenByRef={wordTokenByRef}
                  hideInactiveLinkButtons={hideInactiveLinkButtons}
                  simplifyPhrases={simplifyPhrases}
                  chapterLabelInVerse={chapterLabelInVerse}
                />
              </Fragment>
            ))}
            <div ref={bottomSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
          </div>
        </>
      )}
    </div>
  );
}
