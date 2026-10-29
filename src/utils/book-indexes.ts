import type { Segment, Token } from 'interlinearizer';
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
   * tokens fall in the same relative order in both maps. Values from the two maps are not
   * comparable.
   */
  fullTokenOrder: ReadonlyMap<string, number>;
  /**
   * Maps each word token ref to the baseline text separating it from the previous word token of its
   * segment — the punctuation and whitespace between the two, verbatim, and empty in a script
   * written without spaces. A segment's first word has no entry: token offsets are relative to
   * their own segment's baseline, so no slice spans a boundary.
   */
  gapTextByWordRef: ReadonlyMap<string, string>;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Maps every word token ref to the token; the input for resolving focus context. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * Every word token ref in document order — the inverse of {@link BookIndexes.tokenDocOrder}
   * (`wordRefByOrder[tokenDocOrder.get(ref)] === ref`). Used to enumerate the word refs inside a
   * document-order interval, e.g. the boundary anchors a phrase straddles.
   */
  wordRefByOrder: readonly string[];
}

/** The writable token lookups of {@link BookIndexes}, filled while segments are indexed. */
export type TokenIndexes = {
  tokenDocOrder: Map<string, number>;
  fullTokenOrder: Map<string, number>;
  gapTextByWordRef: Map<string, string>;
  tokenSegmentMap: Map<string, string>;
  wordTokenByRef: Map<string, Token & { type: 'word' }>;
};

/**
 * Records a segment's tokens in `indexes`, numbering its word tokens from `firstWord` and all its
 * tokens from `firstToken`. Calls `onWord` with each word token's ref and its place among the
 * book's word tokens. Returns the places where the next segment's word numbering and token
 * numbering start.
 */
export function indexSegmentTokens(
  segment: Segment,
  indexes: TokenIndexes,
  firstWord: number,
  firstToken: number,
  onWord?: (ref: string, wordOrder: number) => void,
): { nextWord: number; nextToken: number } {
  let wordOrder = firstWord;
  let tokenOrder = firstToken;
  let previousWord: Token | undefined;
  segment.tokens.forEach((token) => {
    indexes.tokenSegmentMap.set(token.ref, segment.id);
    indexes.fullTokenOrder.set(token.ref, tokenOrder);
    tokenOrder += 1;
    if (!isWordToken(token)) return;
    indexes.tokenDocOrder.set(token.ref, wordOrder);
    onWord?.(token.ref, wordOrder);
    wordOrder += 1;
    indexes.wordTokenByRef.set(token.ref, token);
    if (previousWord)
      indexes.gapTextByWordRef.set(
        token.ref,
        segment.baselineText.slice(previousWord.charEnd, token.charStart),
      );
    previousWord = token;
  });
  return { nextWord: wordOrder, nextToken: tokenOrder };
}

/**
 * Builds the book-wide lookup indexes over a book's `segments`. Every segmentation of one text
 * gives the same token orders; custom boundaries regroup a book's tokens without reordering them.
 */
export function buildBookIndexes(segments: readonly Segment[]): BookIndexes {
  const segmentById = new Map<string, Segment>();
  const segmentOrder = new Map<string, number>();
  const indexes: TokenIndexes = {
    tokenDocOrder: new Map(),
    fullTokenOrder: new Map(),
    gapTextByWordRef: new Map(),
    tokenSegmentMap: new Map(),
    wordTokenByRef: new Map(),
  };
  const wordRefByOrder: string[] = [];
  let next = { nextWord: 0, nextToken: 0 };
  segments.forEach((segment, index) => {
    segmentById.set(segment.id, segment);
    segmentOrder.set(segment.id, index);
    next = indexSegmentTokens(segment, indexes, next.nextWord, next.nextToken, (ref) =>
      wordRefByOrder.push(ref),
    );
  });
  return { segmentById, segmentOrder, ...indexes, wordRefByOrder };
}

const bookIndexesCache = new WeakMap<readonly Segment[], BookIndexes>();

/**
 * The book-wide lookup indexes over `segments`, built once per array and shared by every caller.
 * The array must not change once indexed.
 */
export function bookIndexesOf(segments: readonly Segment[]): BookIndexes {
  const cached = bookIndexesCache.get(segments);
  if (cached) return cached;
  const indexes = buildBookIndexes(segments);
  bookIndexesCache.set(segments, indexes);
  return indexes;
}
