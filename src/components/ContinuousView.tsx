/** @file Continuous horizontal token-strip viewer for a full book. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Token } from 'interlinearizer';
import TokenChip from './TokenChip';

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
 * When `activeVerse` changes the strip jumps to the first token of the matching segment. When arrow
 * navigation crosses a verse boundary `onVerseChange` is called with the new verse coordinate.
 *
 * @param props - Component props
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @param props.activeVerse - Optional verse coordinate; when it changes the strip scrolls to the
 *   first token of the matching segment
 * @param props.onVerseChange - Called when arrow navigation moves the focus into a new verse
 * @returns A horizontal token strip with left/right navigation arrows and edge-fade overlays
 */
export default function ContinuousView({
  book,
  activeVerse,
  onVerseChange,
}: Readonly<{
  book: Book;
  activeVerse?: VerseCoordinate;
  onVerseChange?: (verse: VerseCoordinate) => void;
}>) {
  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  /** Maps each segment id to the index of its first token in `allTokens`. */
  const segmentStartIndex = useMemo(() => {
    const { map } = book.segments.reduce(
      (acc, seg) => {
        acc.map.set(seg.id, acc.offset);
        return { map: acc.map, offset: acc.offset + seg.tokens.length };
      },
      { map: new Map<string, number>(), offset: 0 },
    );
    return map;
  }, [book.segments]);

  /**
   * Maps a flat token index to the segment that owns it. Stored in a ref so that a new book object
   * reference (same content) does not cause the verse-change effect to re-fire.
   */
  const tokenSegment = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens.map(() => seg)),
    [book.segments],
  );
  const tokenSegmentRef = useRef(tokenSegment);
  tokenSegmentRef.current = tokenSegment;

  const [focusIndex, setFocusIndex] = useState(0);

  // Reset strip position whenever the book identity changes.
  const prevBookIdRef = useRef(book.id);
  useEffect(() => {
    if (prevBookIdRef.current !== book.id) {
      prevBookIdRef.current = book.id;
      setFocusIndex(0);
    }
  }, [book.id]);

  /**
   * When activeVerse triggers a programmatic jump we record the target index here. The verse-change
   * effect checks this before firing `onVerseChange` so the jump is not echoed back. Using the
   * target index (rather than a boolean) avoids a race where the flag gets consumed by an unrelated
   * tokenSegment reference change before the focusIndex state update arrives.
   */
  const jumpTargetRef = useRef<number | undefined>(undefined);

  // Jump to the first token of the matching segment when the active verse changes.
  useEffect(() => {
    if (!activeVerse) return;
    const seg = book.segments.find(
      (s) =>
        s.startRef.book === activeVerse.book &&
        s.startRef.chapter === activeVerse.chapter &&
        s.startRef.verse === activeVerse.verse,
    );
    if (!seg) return;
    const idx = segmentStartIndex.get(seg.id);
    if (idx !== undefined) {
      jumpTargetRef.current = idx;
      setFocusIndex(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerse?.book, activeVerse?.chapter, activeVerse?.verse]);

  // Fire onVerseChange when arrow navigation crosses into a new verse.
  // Initialise to the first segment so the initial render does not trigger the callback.
  const lastReportedSegIdRef = useRef<string | undefined>(
    book.segments.length > 0 ? book.segments[0].id : undefined,
  );
  useEffect(() => {
    // Suppress echo-back when the change was driven by an incoming activeVerse prop.
    if (jumpTargetRef.current === focusIndex) {
      jumpTargetRef.current = undefined;
      return;
    }
    jumpTargetRef.current = undefined;
    const seg = tokenSegmentRef.current[focusIndex];
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
  }, [focusIndex]);

  // One ref slot per token so we can call scrollIntoView on the focused one.
  const tokenRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const atStart = focusIndex === 0;
  const atEnd = allTokens.length === 0 || focusIndex >= allTokens.length - 1;

  const goLeft = useCallback(() => {
    if (!atStart) setFocusIndex((i) => i - 1);
  }, [atStart]);

  const goRight = useCallback(() => {
    if (!atEnd) setFocusIndex((i) => i + 1);
  }, [atEnd]);

  useEffect(() => {
    tokenRefs.current[focusIndex]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [focusIndex]);

  return (
    <div className="tw-relative tw-flex tw-items-center tw-gap-1">
      {/* Left navigation arrow */}
      <button
        type="button"
        aria-label="Previous token"
        disabled={atStart}
        onClick={goLeft}
        className="tw-z-10 tw-flex-shrink-0 tw-rounded tw-p-1 tw-text-foreground disabled:tw-opacity-30 hover:tw-bg-muted/50"
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
          {allTokens.map((token, index) => (
            <span
              key={token.id}
              ref={(el) => {
                tokenRefs.current[index] = el;
              }}
            >
              <TokenChip token={token} />
            </span>
          ))}
        </div>
      </div>

      {/* Right navigation arrow */}
      <button
        type="button"
        aria-label="Next token"
        disabled={atEnd}
        onClick={goRight}
        className="tw-z-10 tw-flex-shrink-0 tw-rounded tw-p-1 tw-text-foreground disabled:tw-opacity-30 hover:tw-bg-muted/50"
      >
        &#8594;
      </button>
    </div>
  );
}
