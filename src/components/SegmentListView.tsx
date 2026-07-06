import { useLocalizedStrings } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, Token } from 'interlinearizer';
import { FoldVertical, LocateFixed } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseMode } from '../types/phrase-mode';
import type { ViewOptions } from '../types/view-options';
import { useSegmentation } from './SegmentationStore';
import MemoizedSegmentView from './SegmentView';
import useSegmentWindow from '../hooks/useSegmentWindow';
import { buildSegmentLabels } from '../utils/segment-labels';
import { isSameVerse } from '../utils/verse-ref';
import { RECENTER_FADE_TRANSITION_STYLE } from './recenter-fade';

/** Localized label for the between-rows merge control; hoisted so the array reference is stable. */
const MERGE_STRING_KEYS = [
  '%interlinearizer_boundaryControl_merge%',
] as const satisfies `%${string}%`[];

/** Props for {@link MergeRowButton}. */
type MergeRowButtonProps = Readonly<{
  /** The segment below the gap this button sits in — the one a click merges into its predecessor. */
  segment: Segment;
  /**
   * When `true` the control renders inert. Set while a phrase mode (edit / confirm-unlink) is
   * active, matching the in-gap boundary controls: a merge mid-mode could re-segment the phrase the
   * mode UI is operating on.
   */
  disabled: boolean;
  /**
   * Reports hover over this button: the segment's id on enter, `undefined` on leave. The list uses
   * it to tint the two rows the merge would join.
   */
  onHoverChange: (segmentId: string | undefined) => void;
}>;

/**
 * The merge control rendered in the gap between two adjacent segment rows. Clicking it merges the
 * lower segment into the one above — the segment-list counterpart of the merge control in the
 * continuous strip's cross-segment slots. Always mounted (not hover-gated) so the row gap is the
 * only boundary affordance in this view, and it doubles as the undo for a split.
 *
 * The button spans the full row width so the whole gap is a click target, with the fold glyph
 * centered in it. Hovering previews the merge two ways: the button itself tints across its full
 * width (a band bridging the gap), and the hover is reported to the list, which outlines and tints
 * the two rows a click would join. The hover is cleared synchronously on click so the preview can't
 * linger over the merged content.
 *
 * @param props - Component props.
 * @param props.segment - The segment below the gap.
 * @param props.disabled - Renders the control inert while a phrase mode is active.
 * @param props.onHoverChange - Reports hover so the list can tint the two affected rows.
 * @returns A full-width merge-boundary button, or `undefined` when the segment has no tokens.
 */
function MergeRowButton({ segment, disabled, onHoverChange }: MergeRowButtonProps) {
  const { dispatch } = useSegmentation();
  const [localizedStrings] = useLocalizedStrings(MERGE_STRING_KEYS);
  const secondSegmentStartRef = segment.tokens[0]?.ref;
  /* v8 ignore next -- a rendered segment always has at least one token */
  if (secondSegmentStartRef === undefined) return undefined;
  const mergeLabel = localizedStrings['%interlinearizer_boundaryControl_merge%'];
  return (
    <button
      aria-label={mergeLabel}
      className="tw:flex tw:w-full tw:items-center tw:justify-center tw:rounded tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-accent-foreground tw:disabled:pointer-events-none tw:disabled:opacity-30"
      data-testid="segment-merge-btn"
      disabled={disabled}
      tabIndex={-1}
      title={mergeLabel}
      type="button"
      onClick={() => {
        onHoverChange(undefined);
        dispatch.merge(secondSegmentStartRef);
      }}
      onMouseEnter={() => onHoverChange(segment.id)}
      onMouseLeave={() => onHoverChange(undefined)}
    >
      <span className="tw:inline-flex tw:items-center tw:justify-center tw:p-0.5">
        <FoldVertical className="tw:h-3 tw:w-3" />
      </span>
    </button>
  );
}

/** Props for {@link SegmentListView}. */
type SegmentListViewProps = Readonly<{
  /** Tokenized book whose segments are windowed and rendered. */
  book: Book;
  /** Current scripture reference; its verse is the recenter anchor and active-verse highlight. */
  scrRef: SerializedVerseRef;
  /**
   * Monotonic counter bumped on every boundary edit. Forwarded to {@link useSegmentWindow} so it can
   * tell a boundary edit (redraw in place) apart from a re-tokenization of the loaded book
   * (recenter with a fade) when the segments identity changes.
   */
  segmentationVersion: number;
  /** Token ref of the currently focused word token, or `undefined` when nothing is focused. */
  focusedTokenRef: string | undefined;
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
  /** Bundled display toggles forwarded unchanged to each {@link SegmentView}. */
  viewOptions: ViewOptions;
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
 * @param props.segmentationVersion - Monotonic boundary-edit counter forwarded to the window.
 * @param props.focusedTokenRef - Token ref of the currently focused word token, or `undefined`.
 * @param props.continuousScroll - When true, the horizontal token strip is shown above this list.
 * @param props.displayContinuousScroll - Continuous-scroll mode the segments actually render; owned
 *   by the parent and updated at the recenter midpoint.
 * @param props.onDisplayContinuousScrollChange - Reports the gated continuous-scroll value
 *   (deferred to the recenter midpoint) so the parent mounts/unmounts the strip in lockstep with
 *   this list.
 * @param props.consumeInternalNav - Consumes the internal-nav classification to suppress the fade.
 * @param props.reportSettled - Reports the window has settled; lifts the cross-book curtain.
 * @param props.phraseMode - Current phrase-interaction mode passed down for rendering.
 * @param props.setPhraseMode - Setter for `phraseMode`.
 * @param props.viewOptions - Bundled display toggles forwarded unchanged to each segment.
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
  segmentationVersion,
  focusedTokenRef,
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
  onSelect,
  tokenSegmentMap,
  tokenDocOrder,
  wordTokenByRef,
}: SegmentListViewProps) {
  // Read directly here for the inline chapter headers; the rest of `viewOptions` is forwarded
  // unchanged to each SegmentView.
  const { chapterLabelInVerse } = viewOptions;

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

  /**
   * Display label of every segment (per-chapter segment number + contained verse range), keyed by
   * segment id. Computed over the whole `book.segments` list (not just the mounted window) so the
   * numbering is stable regardless of which slice happens to be mounted.
   */
  const segmentLabels = useMemo(() => buildSegmentLabels(book.segments), [book.segments]);

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

  // Segment that wears the active highlight. It follows the focused token's segment so the highlight
  // lands on the segment whose token is focused — including a verse-0 superscription. Normal
  // navigation keeps the focused token inside the active verse, so this resolves to the same segment
  // as the `displayScrRef` verse; it can diverge briefly when a focus move and the host echo it
  // triggers are not yet reconciled. Falls back to the active verse when nothing is focused (e.g. the
  // active verse has no word token).
  const activeSegmentId = displayFocusedTokenRef
    ? tokenSegmentMap.get(displayFocusedTokenRef)
    : undefined;

  /**
   * Id of the lower segment of the row gap whose merge button is hovered, or `undefined` when none
   * is. The hovered gap's two adjacent rows (this segment and its predecessor) render outlined and
   * tinted so it is visible which rows a click would join.
   */
  const [mergeHoverSegmentId, setMergeHoverSegmentId] = useState<string | undefined>(undefined);

  return (
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
            ref={contentRef}
            className="tw:flex tw:flex-col tw:gap-2 tw:transition-opacity"
            style={{ opacity: isFaded ? 0 : 1, ...RECENTER_FADE_TRANSITION_STYLE }}
          >
            <div ref={topSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
            {windowSegments.map((seg, segIndex) => {
              /* v8 ignore next 2 -- the ?? arm is a defensive fallback for the Map.get type: every
                 windowed segment comes from book.segments, so the lookup always resolves */
              const label = segmentLabels.get(seg.id) ?? { ordinal: 0, verseRange: '' };
              return (
                <Fragment key={seg.id}>
                  {segIndex > 0 && (
                    <MergeRowButton
                      segment={seg}
                      disabled={phraseMode.kind !== 'view'}
                      onHoverChange={setMergeHoverSegmentId}
                    />
                  )}
                  {!chapterLabelInVerse && chapterStartIds.has(seg.id) && (
                    <span className="tw:block tw:border-b tw:border-border tw:pb-1 tw:text-sm tw:font-semibold tw:text-foreground">
                      {`Chapter ${seg.startRef.chapter}`}
                    </span>
                  )}
                  <div
                    // Merge preview: outline and tint the two rows the hovered gap's merge button
                    // would join — this segment when its own gap is hovered, and the row above the
                    // hovered gap.
                    className={`tw:rounded-md tw:transition-colors ${
                      mergeHoverSegmentId !== undefined &&
                      (seg.id === mergeHoverSegmentId ||
                        windowSegments[segIndex + 1]?.id === mergeHoverSegmentId)
                        ? 'tw:bg-accent tw:ring-1 tw:ring-ring/60'
                        : ''
                    }`}
                  >
                    <MemoizedSegmentView
                      displayMode={displayContinuousScroll ? 'baseline-text' : 'token-chip'}
                      editPhraseSegmentId={editPhraseSegmentId}
                      focusedTokenRef={displayContinuousScroll ? undefined : displayFocusedTokenRef}
                      hoveredPhraseId={hoveredPhraseId}
                      isActive={
                        activeSegmentId !== undefined
                          ? seg.id === activeSegmentId
                          : isSameVerse(seg.startRef, displayScrRef)
                      }
                      onHoverPhrase={setHoveredPhraseId}
                      onSelect={onSelect}
                      phraseMode={phraseMode}
                      setPhraseMode={setPhraseMode}
                      segment={seg}
                      label={label}
                      tokenSegmentMap={tokenSegmentMap}
                      tokenDocOrder={tokenDocOrder}
                      wordTokenByRef={wordTokenByRef}
                      viewOptions={viewOptions}
                    />
                  </div>
                </Fragment>
              );
            })}
            <div ref={bottomSentinelRef} aria-hidden="true" className="tw:h-px tw:w-full" />
          </div>
          <div data-snap-spacer aria-hidden="true" />
        </>
      )}
    </div>
  );
}
