import type { Book, Segment, Token } from 'interlinearizer';
import { useMemo } from 'react';
import { isWordToken } from '../types/type-guards';

/** Book-wide lookup indexes derived from a book's flat segment list. */
export interface BookIndexes {
  /** Maps every segment id to the segment; used to resolve a focused token's verse. */
  segmentById: ReadonlyMap<string, Segment>;
  /**
   * Maps every word token ref to its flat book-level index; used to sort phrase tokens in document
   * order.
   */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to the token; used by views to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
}

/**
 * Builds the book-wide lookup indexes the interlinear views share, in a single pass over
 * `book.segments`. The indexes always travel together through the view prop plumbing, so deriving
 * them in one memo keeps them in lockstep (one traversal, one identity change per book change)
 * instead of four separate memos each walking the segment list.
 *
 * @param book - The tokenized book to index.
 * @returns The lookup indexes; stable identities until `book.segments` changes.
 */
export default function useBookIndexes(book: Book): BookIndexes {
  return useMemo(() => {
    const segmentById = new Map<string, Segment>();
    const tokenDocOrder = new Map<string, number>();
    const tokenSegmentMap = new Map<string, string>();
    const wordTokenByRef = new Map<string, Token & { type: 'word' }>();
    let wordIndex = 0;
    book.segments.forEach((seg) => {
      segmentById.set(seg.id, seg);
      seg.tokens.forEach((token) => {
        tokenSegmentMap.set(token.ref, seg.id);
        if (isWordToken(token)) {
          tokenDocOrder.set(token.ref, wordIndex);
          wordIndex += 1;
          wordTokenByRef.set(token.ref, token);
        }
      });
    });
    return { segmentById, tokenDocOrder, tokenSegmentMap, wordTokenByRef };
  }, [book.segments]);
}
