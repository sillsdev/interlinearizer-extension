/** @file Continuous horizontal token-strip viewer for a full book. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Token } from 'interlinearizer';
import TokenChip from './TokenChip';

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
 * @param props - Component props
 * @param props.book - The full tokenized book whose tokens should be streamed
 * @returns A horizontal token strip with left/right navigation arrows and edge-fade overlays
 */
export default function ContinuousView({ book }: Readonly<{ book: Book }>) {
  const allTokens: Token[] = useMemo(
    () => book.segments.flatMap((seg) => seg.tokens),
    [book.segments],
  );

  const [focusIndex, setFocusIndex] = useState(0);

  // Reset strip position whenever the book identity changes.
  const prevBookIdRef = useRef(book.id);
  useEffect(() => {
    if (prevBookIdRef.current !== book.id) {
      prevBookIdRef.current = book.id;
      setFocusIndex(0);
    }
  }, [book.id]);

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

        {/* Inner flex row — overflow-x scroll */}
        <div className="tw-flex tw-items-center tw-gap-1 tw-overflow-x-scroll tw-py-2">
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
