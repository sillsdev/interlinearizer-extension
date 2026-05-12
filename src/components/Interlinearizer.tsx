import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment } from 'interlinearizer';
import { useCallback } from 'react';
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
  const handleVerseChange = useCallback(
    (v: ScriptureRef) => {
      setScrRef({ book: v.book, chapterNum: v.chapter, verseNum: v.verse });
    },
    [setScrRef],
  );

  return (
    <div className="tw-flex tw-flex-col tw-flex-1 tw-min-h-0">
      {continuousScroll && (
        <div className="tw-shrink-0 tw-border-b tw-border-border tw-bg-background tw-py-2">
          <ContinuousView
            activeVerse={{
              book: scrRef.book,
              chapter: scrRef.chapterNum,
              verse: scrRef.verseNum,
            }}
            book={book}
            onVerseChange={handleVerseChange}
          />
        </div>
      )}

      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto tw-flex tw-flex-col tw-gap-4 tw-p-4">
        {bookSegments.length === 0 && (
          <p className="tw-text-sm tw-text-muted-foreground">
            No verse data for {scrRef.book} {scrRef.chapterNum}.
          </p>
        )}

        {bookSegments.length > 0 && (
          <div className="tw-flex tw-flex-col tw-gap-2">
            {bookSegments.map((seg) => (
              <MemoizedSegmentView
                key={seg.id}
                segment={seg}
                isActive={seg.startRef.verse === scrRef.verseNum}
                displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                onClick={handleVerseChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
