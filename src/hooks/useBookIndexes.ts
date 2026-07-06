import type { Book, Segment, Token } from 'interlinearizer';
import { useMemo } from 'react';
import { isWordToken } from '../types/type-guards';

/** Book-wide lookup indexes derived from a book's flat segment list. */
export interface BookIndexes {
  /** Maps every segment id to the segment; used to resolve a focused token's verse. */
  segmentById: ReadonlyMap<string, Segment>;
  /** Maps every segment id to its index in document order; used to test segment adjacency. */
  segmentOrder: ReadonlyMap<string, number>;
  /**
   * Maps every word token ref to its flat book-level index; used to sort phrase tokens in document
   * order.
   */
  tokenDocOrder: ReadonlyMap<string, number>;
  /**
   * Maps every token ref — words and punctuation — to its flat book-level index. The canonical
   * document order for boundary refs, which can name punctuation tokens (e.g. the move target of a
   * cross-segment pull) that the word-only {@link BookIndexes.tokenDocOrder} cannot resolve. Word
   * tokens rank consistently in both maps (both are ascending document positions), so comparing a
   * word-only order against this map's values is safe.
   */
  fullTokenOrder: ReadonlyMap<string, number>;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to the token; used by views to resolve focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * Every word token ref in document order — the inverse of {@link BookIndexes.tokenDocOrder}
   * (`wordRefByOrder[tokenDocOrder.get(ref)] === ref`). Used to enumerate the word refs inside a
   * document-order interval, e.g. the boundary anchors a phrase straddles.
   */
  wordRefByOrder: readonly string[];
}

/**
 * Builds the book-wide lookup indexes the interlinear views share, in a single pass over
 * `book.segments`. The indexes always travel together through the view prop plumbing, so deriving
 * them in one memo keeps them in lockstep (one traversal, one identity change per book change)
 * instead of separate memos each walking the segment list.
 *
 * @param book - The tokenized book to index.
 * @returns The lookup indexes; stable identities until `book.segments` changes.
 */
export default function useBookIndexes(book: Book): BookIndexes {
  return useMemo(() => {
    const segmentById = new Map<string, Segment>();
    const segmentOrder = new Map<string, number>();
    const tokenDocOrder = new Map<string, number>();
    const fullTokenOrder = new Map<string, number>();
    const tokenSegmentMap = new Map<string, string>();
    const wordTokenByRef = new Map<string, Token & { type: 'word' }>();
    const wordRefByOrder: string[] = [];
    let tokenIndex = 0;
    book.segments.forEach((seg, segIndex) => {
      segmentById.set(seg.id, seg);
      segmentOrder.set(seg.id, segIndex);
      seg.tokens.forEach((token) => {
        tokenSegmentMap.set(token.ref, seg.id);
        fullTokenOrder.set(token.ref, tokenIndex);
        tokenIndex += 1;
        if (isWordToken(token)) {
          tokenDocOrder.set(token.ref, wordRefByOrder.length);
          wordRefByOrder.push(token.ref);
          wordTokenByRef.set(token.ref, token);
        }
      });
    });
    return {
      segmentById,
      segmentOrder,
      tokenDocOrder,
      fullTokenOrder,
      tokenSegmentMap,
      wordTokenByRef,
      wordRefByOrder,
    };
  }, [book.segments]);
}
