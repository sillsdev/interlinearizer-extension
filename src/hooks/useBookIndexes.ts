import type { Book } from 'interlinearizer';
import { useMemo } from 'react';
import { buildBookIndexes, type BookIndexes } from '../utils/book-indexes';

/**
 * The book-wide lookup indexes the interlinear views share. The indexes always travel together
 * through the view prop plumbing, so deriving them in one memo keeps them in lockstep: one
 * traversal, one identity change per book change.
 */
export default function useBookIndexes(book: Book): BookIndexes {
  return useMemo(() => buildBookIndexes(book.segments), [book.segments]);
}
