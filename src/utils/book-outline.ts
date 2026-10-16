import type { Book, Segment } from 'interlinearizer';
import { isWordToken } from '../types/type-guards';
import type { BookOutline, OutlineSegment } from '../types/segment-pages';

/** Lists a segment as an outline does, without its text. */
export function outlineSegment({
  id,
  startRef,
  verseStarts,
  heading,
  tokens,
  baselineText,
}: Segment): OutlineSegment {
  return {
    id,
    startRef,
    verseStarts,
    ...(heading && { heading }),
    tokenCount: tokens.length,
    wordTokenCount: tokens.filter(isWordToken).length,
    textLength: baselineText.length,
  };
}

/** Outlines `segments`, segmented from `book`. */
export function buildBookOutline(book: Book, segments: readonly Segment[]): BookOutline {
  return {
    bookRef: book.bookRef,
    textVersion: book.textVersion,
    segments: segments.map(outlineSegment),
  };
}
