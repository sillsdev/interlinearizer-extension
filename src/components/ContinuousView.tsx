/** @file Continuous horizontal token-strip viewer for a full book. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book, Token } from 'interlinearizer';
import TokenChip from './TokenChip';
import PhraseBox from './PhraseBox';

/**
 * Memoized phrase-level wrapper that isolates each word token's click handler. Avoids re-rendering
 * the entire token strip on navigation. Focus styling is applied imperatively via a `data-focused`
 * attribute on the parent span so it updates synchronously without triggering a React re-render.
 *
 * @param props - Component props
 * @param props.onPhraseClick - Stable callback invoked with this phrase's index when clicked
 * @param props.phraseIndex - Zero-based index of this phrase in the navigable phrase list
 * @param props.token - The word token to render inside the phrase box
 * @returns A memoized {@link PhraseBox} with a stable click handler
 */
const FocusablePhrase = memo(function FocusablePhrase({
  onPhraseClick,
  phraseIndex,
  token,
}: Readonly<{
  onPhraseClick: (index: number) => void;
  phraseIndex: number;
  token: Token;
}>) {
  const handleClick = useCallback(() => onPhraseClick(phraseIndex), [onPhraseClick, phraseIndex]);
  return <PhraseBox onClick={handleClick} tokens={[token]} />;
});

/** A verse coordinate used to drive the strip's scroll position. */
export interface VerseCoordinate {
  book: string;
  chapter: number;
  verse: number;
}

/**
 * Renders all tokens from every segment in the given book as a single flat, horizontally scrollable
 * strip. Arrow buttons advance or retreat the view by one token at a time with smooth scrolling
 * animation. No segment markers, verse labels, or chapter boundaries are shown — the strip is fully
 * continuous.
 *
 * Edge behaviour:
 *
 * - Left arrow is disabled (and left fade suppressed) when the first token is focused.
 * - Right arrow is disabled (and right fade suppressed) when the last token is focused.
 *
 * When `activeVerse` changes the strip scrolls smoothly to the first token of the matching segment.
 * When arrow navigation crosses a verse boundary `onVerseChange` is called with the new verse
 * coordinate.
 *
 * @param props - Component props
 * @param props.activeVerse - Optional verse coordinate; when it changes the strip scrolls to the
 *   first token of the matching segment
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.onVerseChange - Called when arrow navigation moves the focus into a new verse
 * @returns A horizontal token strip with left/right navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  activeVerse,
  book,
  onVerseChange,
}: Readonly<{
  activeVerse?: VerseCoordinate;
  book: Book;
  onVerseChange?: (verse: VerseCoordinate) => void;
}>) {
  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  /** Maps each segment id to the index of its first word token in `allTokens`. */
  const segmentStartIndex = useMemo(() => {
    const { map } = book.segments.reduce(
      (acc, seg) => {
        const firstWordIndex = seg.tokens.findIndex((t) => t.type === 'word');
        if (firstWordIndex >= 0) acc.map.set(seg.id, acc.offset + firstWordIndex);
        return { map: acc.map, offset: acc.offset + seg.tokens.length };
      },
      { map: new Map<string, number>(), offset: 0 },
    );
    return map;
  }, [book.segments]);

  /** The navigable phrase entries (currently one per word token). */
  const phraseEntries = useMemo(
    () =>
      allTokens
        .map((token, tokenIndex) => ({ token, tokenIndex }))
        .filter((entry) => entry.token.type === 'word'),
    [allTokens],
  );
  const phraseEntriesRef = useRef(phraseEntries);
  phraseEntriesRef.current = phraseEntries;

  const focusPhraseIndexRef = useRef(0);

  /** Flat token index -> phrase index lookup for focused rendering. */
  const phraseIndexByTokenIndex = useMemo(
    () =>
      phraseEntries.reduce((acc, entry, phraseIndex) => {
        acc.set(entry.tokenIndex, phraseIndex);
        return acc;
      }, new Map<number, number>()),
    [phraseEntries],
  );

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

  const getPhraseIndexForVerse = useCallback(
    (verse: VerseCoordinate): number | undefined => {
      const seg = book.segments.find(
        (s) =>
          s.startRef.book === verse.book &&
          s.startRef.chapter === verse.chapter &&
          s.startRef.verse === verse.verse,
      );
      if (!seg) return undefined;

      const tokenIndex = segmentStartIndex.get(seg.id);
      if (tokenIndex === undefined) return undefined;

      return phraseIndexByTokenIndex.get(tokenIndex);
    },
    [book.segments, segmentStartIndex, phraseIndexByTokenIndex],
  );

  // Lazy-initialize to the target verse so the strip is already positioned correctly on first
  // render, before the initial scroll effect fires.
  const [focusPhraseIndex, setFocusPhraseIndex] = useState<number>(() => {
    if (!activeVerse) return 0;
    return getPhraseIndexForVerse(activeVerse) ?? 0;
  });

  /**
   * When activeVerse triggers a programmatic jump we record the target index here. The verse-change
   * effect checks this before firing `onVerseChange` so the jump is not echoed back. Using the
   * target index (rather than a boolean) avoids a race where the flag gets consumed by an unrelated
   * tokenSegment reference change before the focusIndex state update arrives.
   */
  focusPhraseIndexRef.current = focusPhraseIndex;

  const jumpTargetRef = useRef<number | undefined>(undefined);
  const isInitialLoadRef = useRef(true);

  // Scroll to the first token of the matching segment when the active verse changes.
  useEffect(() => {
    if (!activeVerse) return;

    // Preserve current phrase focus when it is already inside the target verse.
    const currentlyFocusedPhrase = phraseEntriesRef.current[focusPhraseIndexRef.current];
    if (currentlyFocusedPhrase) {
      const focusedSeg = tokenSegmentRef.current[currentlyFocusedPhrase.tokenIndex];
      if (
        focusedSeg?.startRef.book === activeVerse.book &&
        focusedSeg.startRef.chapter === activeVerse.chapter &&
        focusedSeg.startRef.verse === activeVerse.verse
      ) {
        return;
      }
    }

    const phraseIndex = getPhraseIndexForVerse(activeVerse);
    if (phraseIndex === undefined) return;

    jumpTargetRef.current = phraseIndex;
    setFocusPhraseIndex(phraseIndex);
    // focusPhraseIndexRef is a ref so it is always current without being a dependency.
    // Listing focusPhraseIndex here would re-run the effect on every arrow press, causing the
    // strip to jump back to the old verse before activeVerse has been updated by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerse?.book, activeVerse?.chapter, activeVerse?.verse, getPhraseIndexForVerse]);

  // Fire onVerseChange when arrow navigation crosses into a new verse.
  // Initialise to the first segment so the initial render does not trigger the callback.
  const firstVisibleSegId =
    phraseEntries.length > 0 ? tokenSegment[phraseEntries[0].tokenIndex]?.id : undefined;
  const lastReportedSegIdRef = useRef<string | undefined>(firstVisibleSegId);

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
    const focusedPhrase = phraseEntriesRef.current[focusPhraseIndex];
    if (!focusedPhrase) return;

    const seg = tokenSegmentRef.current[focusedPhrase.tokenIndex];
    if (!seg || seg.id === lastReportedSegIdRef.current) return;

    lastReportedSegIdRef.current = seg.id;
    onVerseChange?.({
      book: seg.startRef.book,
      chapter: seg.startRef.chapter,
      verse: seg.startRef.verse,
    });
    // onVerseChange and tokenSegmentRef are intentionally excluded — callers must stabilize the
    // reference (useCallback) and tokenSegmentRef is a ref so changes are always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPhraseIndex]);

  // One ref slot per phrase so we can call scrollIntoView on the focused one.
  const phraseRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const atStart = phraseEntries.length === 0 || focusPhraseIndex === 0;
  const atEnd = phraseEntries.length === 0 || focusPhraseIndex >= phraseEntries.length - 1;

  /**
   * Imperatively transfers the focused visual state and scroll position to the given phrase index.
   * Runs synchronously so the style update is visible before React re-renders, masking the ~167ms
   * platform render latency in the Electron WebView.
   */
  const moveFocus = useCallback((next: number, behavior: ScrollBehavior) => {
    phraseRefs.current[focusPhraseIndexRef.current]?.removeAttribute('data-focused');
    const el = phraseRefs.current[next];
    el?.setAttribute('data-focused', 'true');
    el?.scrollIntoView({ behavior, block: 'nearest', inline: 'center' });
  }, []);

  const goLeft = useCallback(() => {
    setFocusPhraseIndex((i) => {
      const next = i - 1;
      moveFocus(next, 'smooth');
      return next;
    });
  }, [moveFocus]);

  const goRight = useCallback(() => {
    setFocusPhraseIndex((i) => {
      const next = i + 1;
      moveFocus(next, 'smooth');
      return next;
    });
  }, [moveFocus]);

  const handlePhraseClick = useCallback(
    (index: number) => {
      if (index === focusPhraseIndexRef.current) return;
      moveFocus(index, 'smooth');
      setFocusPhraseIndex(index);
    },
    [moveFocus],
  );

  // For activeVerse-driven jumps the scroll and data-focused update happen here after React renders.
  useLayoutEffect(() => {
    const isInitialLoad = isInitialLoadRef.current;
    phraseRefs.current[focusPhraseIndex]?.setAttribute('data-focused', 'true');
    phraseRefs.current[focusPhraseIndex]?.scrollIntoView({
      behavior: isInitialLoad ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
    if (isInitialLoad) isInitialLoadRef.current = false;
  }, [focusPhraseIndex]);

  return (
    <div className="tw-relative tw-flex tw-items-center tw-gap-1">
      {/* Left navigation arrow */}
      <button
        aria-label="Previous token"
        className="tw-z-10 tw-flex-shrink-0 tw-rounded tw-p-1 tw-text-foreground disabled:tw-opacity-30 hover:tw-bg-muted/50"
        disabled={atStart}
        onClick={goLeft}
        type="button"
      >
        &#8592;
      </button>

      {/* Scrollable token strip */}
      <div className="tw-relative tw-flex-1 tw-overflow-hidden">
        {/* Left fade overlay — only rendered when the left arrow is enabled */}
        {!atStart && (
          <div
            aria-hidden="true"
            className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-left-0 tw-z-10 tw-w-8 tw-bg-gradient-to-r tw-from-background tw-to-transparent"
          />
        )}

        {/* Right fade overlay — only rendered when the right arrow is enabled */}
        {!atEnd && (
          <div
            aria-hidden="true"
            className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-z-10 tw-w-8 tw-bg-gradient-to-l tw-from-background tw-to-transparent"
          />
        )}

        {/* Inner flex row */}
        <div className="no-scrollbar tw-flex tw-items-center tw-gap-1 tw-overflow-x-scroll tw-py-2">
          {allTokens.map((token, tokenIndex) => {
            if (token.type !== 'word') return <TokenChip key={token.id} token={token} />;

            const phraseIndex = phraseIndexByTokenIndex.get(tokenIndex);
            return (
              <span
                key={token.id}
                ref={(el) => {
                  if (phraseIndex !== undefined) phraseRefs.current[phraseIndex] = el;
                }}
              >
                {phraseIndex !== undefined && (
                  <FocusablePhrase
                    onPhraseClick={handlePhraseClick}
                    phraseIndex={phraseIndex}
                    token={token}
                  />
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Right navigation arrow */}
      <button
        aria-label="Next token"
        className="tw-z-10 tw-flex-shrink-0 tw-rounded tw-p-1 tw-text-foreground disabled:tw-opacity-30 hover:tw-bg-muted/50"
        disabled={atEnd}
        onClick={goRight}
        type="button"
      >
        &#8594;
      </button>
    </div>
  );
}
