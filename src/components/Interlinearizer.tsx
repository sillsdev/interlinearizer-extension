import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, TextAnalysis } from 'interlinearizer';
import { LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisStoreProvider } from './AnalysisStore';
import ContinuousView from './ContinuousView';
import MemoizedSegmentView from './SegmentView';

/** Props for {@link Interlinearizer}. */
type InterlinearizerProps = Readonly<{
  /** Tokenized book whose segments are rendered. */
  book: Book;
  /** Segments belonging to the current chapter, filtered by the caller. */
  chapterSegments: Segment[];
  /** When true, the horizontal token strip is shown above the segment list. */
  continuousScroll: boolean;
  /** Current scripture reference used to highlight the active verse. */
  scrRef: SerializedVerseRef;
  /** Called when the user navigates to a different verse. */
  setScrRef: (newScrRef: SerializedVerseRef) => void;
  /**
   * BCP 47 tag for reading and writing gloss values. Defaults to `analysisLanguages[0]` of the
   * active project (supplied by the caller).
   */
  analysisLanguage: string;
  /** Initial analysis data seeded into the store; not reactive after mount. */
  initialAnalysis?: TextAnalysis;
  /** Called after each gloss write with the updated `TextAnalysis` so the caller can persist it. */
  onSaveAnalysis?: (analysis: TextAnalysis) => void;
}>;

/**
 * Inner component that renders the segment list and continuous view. Separated from
 * {@link Interlinearizer} so it can consume the `AnalysisStoreProvider` context that wraps it.
 *
 * @param props - Component props
 * @param props.book - Tokenized book whose segments are rendered.
 * @param props.chapterSegments - Segments belonging to the current chapter, filtered by the caller.
 * @param props.continuousScroll - When true, the horizontal token strip is shown above the segment
 *   list.
 * @param props.scrRef - Current scripture reference used to highlight the active verse.
 * @param props.setScrRef - Called when the user navigates to a different verse.
 * @returns The interlinearizer layout without the provider wrapper.
 */
function InterlinearizerInner({
  book,
  chapterSegments,
  continuousScroll,
  scrRef,
  setScrRef,
}: Omit<InterlinearizerProps, 'initialAnalysis' | 'analysisLanguage' | 'onSaveAnalysis'>) {
  const [focusedTokenRef, setFocusedTokenRef] = useState<string | undefined>(undefined);

  // Clear stale focused token when the book changes so focusedTokenRef never refers to a token
  // in a different book.
  useEffect(() => {
    setFocusedTokenRef(undefined);
  }, [book]);

  /** All word tokens in book order — index into this array is the phrase index. */
  const wordTokens = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens).filter((token) => token.type === 'word'),
    [book.segments],
  );

  /** Maps each word token id to its phrase index across the full book. */
  const phraseIndexByTokenRef = useMemo(
    () =>
      wordTokens.reduce((map, token, idx) => {
        map.set(token.ref, idx);
        return map;
      }, new Map<string, number>()),
    [wordTokens],
  );

  // activePhraseIndex is intentionally not updated by ContinuousView arrow navigation — only token
  // clicks via handleSegmentSelect change focusedTokenRef. Arrow navigation updates
  // continuousViewPhraseIndex instead (via handleFocusPhraseIndexChange), and the mode-switch
  // effect reads continuousViewPhraseIndexRef to recover the strip position when returning to
  // segment view. The stale activePhraseIndex during arrow navigation is safe because ContinuousView
  // manages its own focusPhraseIndex state and the unchanged prop doesn't re-trigger its effect.
  const activePhraseIndex =
    focusedTokenRef === undefined ? undefined : phraseIndexByTokenRef.get(focusedTokenRef);

  /**
   * Tracks the continuous strip's current phrase index as reported by ContinuousView. Read inside
   * the mode-switch effect to recover the strip position when returning to segment view.
   */
  const continuousViewPhraseIndexRef = useRef<number | undefined>(undefined);

  /**
   * Keeps `continuousViewPhraseIndexRef` in sync with the strip's current position.
   *
   * @param index - The phrase index now focused inside `ContinuousView`.
   */
  const handleFocusPhraseIndexChange = useCallback((index: number) => {
    continuousViewPhraseIndexRef.current = index;
  }, []);

  /**
   * Previous value of `continuousScroll`; lets the mode-switch effect detect the transition
   * direction.
   */
  const prevContinuousScrollRef = useRef<boolean>(continuousScroll);

  const scrollContainerRef = useRef<HTMLDivElement | undefined>(undefined);

  /**
   * Ref callback that stores the scroll container element so imperative scroll calls can target it.
   *
   * @param el - The mounted div, or `null` on unmount.
   */
  const setScrollContainer = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el ?? undefined;
  }, []);

  /**
   * Scrolls the element marked `aria-current="true"` inside the scroll container into view at the
   * top of the list.
   */
  const snapToActive = useCallback(() => {
    const container = scrollContainerRef.current;
    const active = container?.querySelector('[aria-current="true"]');
    /* v8 ignore next -- active is always found when a verse is rendered; guard for empty lists */
    active?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);

  // When switching from continuous to segment view, carry over the focused phrase from the strip.
  // Only acts on the continuous→segment transition; leaving segment view does not overwrite focus.
  useEffect(() => {
    const wasOn = prevContinuousScrollRef.current;
    prevContinuousScrollRef.current = continuousScroll;

    if (!wasOn || continuousScroll) return;

    // Transitioning continuous → segment: prefer the strip's last known position.
    const idx = continuousViewPhraseIndexRef.current;
    const token = idx === undefined ? undefined : wordTokens[idx];
    if (token) {
      setFocusedTokenRef(token.ref);
      return;
    }

    // Fallback: only move to first word of the active segment if nothing is focused yet.
    setFocusedTokenRef((current) => {
      if (current !== undefined) return current;
      const activeSeg = chapterSegments.find((seg) => seg.startRef.verse === scrRef.verseNum);
      return activeSeg?.tokens.find((t) => t.type === 'word')?.ref ?? current;
    });
    // Only re-run when the mode switches; refs and stable arrays don't need to be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  // Snap the segment list to the active verse when switching modes.
  useEffect(() => {
    snapToActive();
    // snapToActive is stable (useCallback with no changing deps), so this only re-runs on mode switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  /**
   * Updates the active scripture reference and, when a specific token was clicked, focuses that
   * token.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenRef - The token that was clicked; omitted when the whole segment was selected.
   */
  const handleSegmentSelect = useCallback(
    (ref: ScriptureRef, tokenRef?: string) => {
      setScrRef({ book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse });
      if (tokenRef) setFocusedTokenRef(tokenRef);
    },
    [setScrRef],
  );

  /**
   * Updates the active scripture reference when ContinuousView reports a verse change via arrow
   * navigation. A separate wrapper from `handleSegmentSelect` because verse changes from the strip
   * never carry a token id.
   *
   * @param ref - The new verse coordinate reported by the strip.
   */
  const handleVerseChange = useCallback(
    (ref: ScriptureRef) => {
      handleSegmentSelect(ref);
    },
    [handleSegmentSelect],
  );

  return (
    <div className="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
      {continuousScroll && (
        <div className="tw:shrink-0 tw:border-b tw:border-border tw:bg-background tw:py-2">
          <ContinuousView
            activePhraseIndex={activePhraseIndex}
            activeVerse={{
              book: scrRef.book,
              chapter: scrRef.chapterNum,
              verse: scrRef.verseNum,
            }}
            book={book}
            onFocusPhraseIndexChange={handleFocusPhraseIndexChange}
            onVerseChange={handleVerseChange}
          />
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:relative tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
      >
        {chapterSegments.length === 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            No verse data for {scrRef.book} {scrRef.chapterNum}.
          </p>
        )}

        {chapterSegments.length > 0 && (
          <>
            <div className="tw:sticky tw:top-0 tw:z-10 tw:flex tw:justify-end tw:pointer-events-none">
              <button
                aria-label="Scroll to active verse"
                className="tw:rounded tw:p-1 tw:text-foreground tw:hover:bg-muted/50 tw:pointer-events-auto"
                onClick={snapToActive}
                type="button"
              >
                <LocateFixed className="tw:h-4 tw:w-4" />
              </button>
            </div>

            <div className="tw:flex tw:flex-col tw:gap-2">
              {chapterSegments.map((seg) => (
                <MemoizedSegmentView
                  key={seg.id}
                  displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                  focusedTokenRef={continuousScroll ? undefined : focusedTokenRef}
                  isActive={seg.startRef.verse === scrRef.verseNum}
                  onSelect={handleSegmentSelect}
                  segment={seg}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Main component for the Interlinearizer. Renders a sticky toolbar and continuous view at the top,
 * followed by segmented views. Wraps the layout in an {@link AnalysisStoreProvider} so all
 * descendant components can read and write analysis data without prop drilling.
 *
 * @param props - Component props
 * @param props.book - Book data used by the continuous view
 * @param props.chapterSegments - Segments to render as individual verse views
 * @param props.continuousScroll - Whether the continuous scroll view is shown
 * @param props.scrRef - Current scripture reference
 * @param props.setScrRef - Callback to update the scripture reference
 * @param props.initialAnalysis - Seed analysis data for the store; not reactive after mount
 * @param props.analysisLanguage - BCP 47 tag for gloss read/write
 * @param props.onSaveAnalysis - Called after each gloss write with the updated `TextAnalysis`
 * @returns The full interlinearizer layout with optional continuous strip and segment list
 */
export default function Interlinearizer({
  initialAnalysis,
  analysisLanguage,
  onSaveAnalysis,
  ...innerProps
}: InterlinearizerProps) {
  return (
    <AnalysisStoreProvider
      initialAnalysis={initialAnalysis}
      analysisLanguage={analysisLanguage}
      onSave={onSaveAnalysis}
    >
      <InterlinearizerInner {...innerProps} />
    </AnalysisStoreProvider>
  );
}
