import type { Book } from 'interlinearizer';
import { useMemo } from 'react';
import { buildBookIndexes, type BookIndexes } from '../utils/book-indexes';

/**
 * The book-wide lookup indexes the interlinear views share. All of them change identity together,
 * and only when the book's segments change.
 */
export default function useBookIndexes(book: Book): BookIndexes {
  return useMemo(() => buildBookIndexes(book.segments), [book.segments]);
}
