import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment } from 'interlinearizer';
import { type ReactNode, useCallback } from 'react';
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
 * @param props.toolbar - Toolbar content rendered at the top of the sticky header
 */
export default function Interlinearizer({
  book,
  bookSegments,
  continuousScroll,
  scrRef,
  setScrRef,
  toolbar,
}: {
  book: Book;
  bookSegments: Segment[];
  continuousScroll: boolean;
  scrRef: SerializedVerseRef;
  setScrRef: (newScrRef: SerializedVerseRef) => void;
  toolbar: ReactNode;
}) {
  const handleVerseChange = useCallback(
    (v: ScriptureRef) => {
      setScrRef({ book: v.book, chapterNum: v.chapter, verseNum: v.verse });
    },
    [setScrRef],
  );

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-sticky tw-top-0 tw-z-10 tw-bg-background">
        {toolbar}
        {continuousScroll && (
          <div className="tw-border-b tw-border-border tw-bg-background tw-py-2">
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
      </div>

      <div className="tw-p-4">
        <div className="tw-flex tw-flex-col tw-gap-4">
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
    </div>
  );
}
