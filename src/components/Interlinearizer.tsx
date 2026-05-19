import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ContinuousView from './ContinuousView';
import MemoizedSegmentView from './SegmentView';

/**
 * Main component for the Interlinearizer. Renders a sticky toolbar and continuous view at the top,
 * followed by segmented views.
 *
 * @param props - Component props
 * @param props.book - Book data used by the continuous view
 * @param props.bookSegments - Segments to render as individual verse views
 * @param props.continuousScroll - Whether the continuous scroll view is shown
 * @param props.scrRef - Current scripture reference
 * @param props.setScrRef - Callback to update the scripture reference
 * @returns The full interlinearizer layout with optional continuous strip and segment list
 */
export default function Interlinearizer({
  book,
  bookSegments,
  continuousScroll,
  scrRef,
  setScrRef,
}: Readonly<{
  book: Book;
  bookSegments: Segment[];
  continuousScroll: boolean;
  scrRef: SerializedVerseRef;
  setScrRef: (newScrRef: SerializedVerseRef) => void;
}>) {
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [focusedTokenId, setFocusedTokenId] = useState<string | undefined>(undefined);

  /** All word tokens in book order — index into this array is the phrase index. */
  const wordTokens = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens).filter((token) => token.type === 'word'),
    [book.segments],
  );

  /** Maps each word token id to its phrase index across the full book. */
  const phraseIndexByTokenId = useMemo(
    () =>
      wordTokens.reduce((map, token, idx) => {
        map.set(token.id, idx);
        return map;
      }, new Map<string, number>()),
    [wordTokens],
  );

  const activePhraseIndex =
    focusedTokenId === undefined ? undefined : phraseIndexByTokenId.get(focusedTokenId);

  /** The scrollable segment list div; targeted by `scrollActiveSegmentIntoView`. */
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
   * Tracks the continuous strip's current phrase index as reported by ContinuousView, so we know
   * exactly where it is when the user switches to segment view and so the active segment scrolls
   * into view when the focused phrase changes.
   */
  const [continuousViewPhraseIndex, setContinuousViewPhraseIndex] = useState<number | undefined>(
    undefined,
  );

  /**
   * Ref mirror of `continuousViewPhraseIndex`. Read inside the mode-switch effect (which omits the
   * state variable as a dep) so it always sees the latest value without causing a re-run.
   */
  const continuousViewPhraseIndexRef = useRef<number | undefined>(undefined);

  /**
   * Keeps `continuousViewPhraseIndex` state in sync with the strip's current position so the
   * segment list can scroll the right verse into view when the focused phrase changes.
   *
   * @param index - The phrase index now focused inside `ContinuousView`.
   */
  const handleFocusPhraseIndexChange = useCallback((index: number) => {
    continuousViewPhraseIndexRef.current = index;
    setContinuousViewPhraseIndex(index);
  }, []);

  /**
   * Previous value of `continuousScroll`; lets the mode-switch effect detect the transition
   * direction.
   */
  const prevContinuousScrollRef = useRef<boolean>(continuousScroll);

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
      setFocusedTokenId(token.id);
      return;
    }

    // Fallback: only move to first word of the active segment if nothing is focused yet.
    setFocusedTokenId((current) => {
      if (current !== undefined) return current;
      const activeSeg = bookSegments.find((seg) => seg.startRef.verse === scrRef.verseNum);
      return activeSeg?.tokens.find((t) => t.type === 'word')?.id ?? current;
    });
    // Only re-run when the mode switches; refs and stable arrays don't need to be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

  /**
   * Scrolls the element marked `aria-current="true"` inside the segment scroll container into view
   * at the top of the list, so the active verse is always visible after a mode switch or focus
   * change.
   */
  const scrollActiveSegmentIntoView = useCallback(() => {
    const container = scrollContainerRef.current;
    const active = container?.querySelector('[aria-current="true"]');
    /* v8 ignore next -- active is always found when a verse is rendered; guard for empty lists */
    active?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);

  // Scroll the active segment into view on mode switch and whenever the focused phrase changes
  // while in continuous mode (ContinuousView is only mounted when continuousScroll is true, so
  // continuousViewPhraseIndex only changes in that context).
  useEffect(() => {
    scrollActiveSegmentIntoView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll, continuousViewPhraseIndex]);

  /**
   * Merges an updated gloss value into the shared gloss map.
   *
   * @param tokenId - The id of the token whose gloss changed.
   * @param value - The new gloss string entered by the user.
   */
  const handleGlossChange = useCallback((tokenId: string, value: string) => {
    setGlosses((prev) => ({ ...prev, [tokenId]: value }));
  }, []);

  /**
   * Updates the active scripture reference and, when a specific token was clicked, focuses that
   * token.
   *
   * @param ref - The verse coordinate that was selected.
   * @param tokenId - The token that was clicked; omitted when the whole segment was selected.
   */
  const handleSegmentSelect = useCallback(
    (ref: ScriptureRef, tokenId?: string) => {
      setScrRef({ book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse });
      if (tokenId) setFocusedTokenId(tokenId);
    },
    [setScrRef],
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
            glosses={glosses}
            onFocusPhraseIndexChange={handleFocusPhraseIndexChange}
            onGlossChange={handleGlossChange}
            onVerseChange={handleSegmentSelect}
          />
        </div>
      )}

      <div
        ref={setScrollContainer}
        className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-4 tw:p-4"
      >
        {bookSegments.length === 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            No verse data for {scrRef.book} {scrRef.chapterNum}.
          </p>
        )}

        {bookSegments.length > 0 && (
          <div className="tw:flex tw:flex-col tw:gap-2">
            {bookSegments.map((seg) => (
              <MemoizedSegmentView
                key={seg.id}
                segment={seg}
                isActive={seg.startRef.verse === scrRef.verseNum}
                displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                focusedTokenId={continuousScroll ? undefined : focusedTokenId}
                glosses={glosses}
                onGlossChange={handleGlossChange}
                onSelect={handleSegmentSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
