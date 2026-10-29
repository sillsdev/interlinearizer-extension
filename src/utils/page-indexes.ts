import type { PhraseAnalysisLink, Segment, SegmentRange, Token } from 'interlinearizer';
import type { OutlineSegment, SegmentPage } from '../types/segment-pages';
import { indexSegmentTokens, type TokenIndexes } from './book-indexes';
import { straddledRefs } from './phrase-arc';
import { positionOf } from './verse-ref';

/**
 * The lookups a view reads tokens and segments through, built from the pages it holds and the
 * phrase spans they carry rather than from the whole book. Each holds what the whole book's lookups
 * hold for the tokens it covers.
 */
export type PageIndexes = Readonly<{
  /** Every segment of the outline, by id. */
  outlineSegmentById: ReadonlyMap<string, OutlineSegment>;
  /** The outline index of every segment, by id. */
  segmentOrder: ReadonlyMap<string, number>;
  /** The segments of the pages held, by id. */
  segmentById: ReadonlyMap<string, Segment>;
  /** Each word token held, or spanned by a phrase, to its place among the book's word tokens. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Each token held, punctuation included, to its place among the book's tokens. */
  fullTokenOrder: ReadonlyMap<string, number>;
  /**
   * Each word token held, or spanned by a phrase, to the baseline text separating it from the
   * previous word token of its segment. A segment's first word token has no entry.
   */
  gapTextByWordRef: ReadonlyMap<string, string>;
  /** Each token held, or spanned by a phrase, to the id of its segment. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Each word token held, or spanned by a phrase, by ref. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  /**
   * The refs of held word tokens before which a segment boundary would cut a phrase that the pages
   * name. For each such phrase, those are the held word tokens after its first, up to and including
   * its last, including those in the gaps of a discontiguous phrase.
   */
  straddledBoundaryRefs: ReadonlySet<string>;
}>;

/**
 * Builds a view's lookups from the pages that it holds.
 *
 * @param outline - The outline of the book that the pages belong to.
 * @param pages - The pages held, each cut from the same text and boundaries as `outline`.
 */
export function buildPageIndexes(
  outline: readonly OutlineSegment[],
  pages: readonly SegmentPage[],
): PageIndexes {
  const outlineSegmentById = new Map<string, OutlineSegment>();
  const segmentOrder = new Map<string, number>();
  const firstWordAt: number[] = [];
  const firstTokenAt: number[] = [];
  let words = 0;
  let tokens = 0;
  outline.forEach((segment, index) => {
    outlineSegmentById.set(segment.id, segment);
    segmentOrder.set(segment.id, index);
    firstWordAt.push(words);
    firstTokenAt.push(tokens);
    words += segment.wordTokenCount;
    tokens += segment.tokenCount;
  });

  const segmentById = new Map<string, Segment>();
  const indexes: TokenIndexes = {
    tokenDocOrder: new Map(),
    fullTokenOrder: new Map(),
    gapTextByWordRef: new Map(),
    tokenSegmentMap: new Map(),
    wordTokenByRef: new Map(),
  };
  const heldWordByOrder = new Map<number, string>();
  const phraseLinks = new Map<string, PhraseAnalysisLink>();
  pages.forEach(({ start, segments, analysis }) => {
    segments.forEach((segment, offset) => {
      segmentById.set(segment.id, segment);
      indexSegmentTokens(
        segment,
        indexes,
        firstWordAt[start + offset],
        firstTokenAt[start + offset],
        (ref, wordOrder) => heldWordByOrder.set(wordOrder, ref),
      );
    });
    Object.values(analysis?.phraseSpans ?? {})
      .flat()
      .forEach(({ token, segmentId, docOrder, gapText }) => {
        indexes.tokenSegmentMap.set(token.ref, segmentId);
        indexes.tokenDocOrder.set(token.ref, docOrder);
        indexes.wordTokenByRef.set(token.ref, token);
        if (gapText !== undefined) indexes.gapTextByWordRef.set(token.ref, gapText);
      });
    analysis?.phraseAnalysisLinks.forEach((link) => phraseLinks.set(link.id, link));
  });

  return {
    outlineSegmentById,
    segmentOrder,
    segmentById,
    ...indexes,
    straddledBoundaryRefs: straddledRefs(phraseLinks.values(), indexes.tokenDocOrder, (order) =>
      heldWordByOrder.get(order),
    ),
  };
}

/**
 * The outline range to read for the segment id or token ref `ref` before its page has loaded;
 * `undefined` when the outline holds no such segment or verse.
 */
export function outlineRangeOf(
  outline: readonly OutlineSegment[],
  ref: string,
): SegmentRange | undefined {
  const { verse, offset } = positionOf(ref);
  const chapterAndVerse = verse.slice(verse.indexOf(' ') + 1);
  const holds = (segment: OutlineSegment) => {
    if (segment.id === ref || segment.id === verse) return true;
    if (segment.heading) return false;
    if (segment.id.startsWith(`${verse}:`))
      return Number(segment.id.slice(verse.length + 1)) <= offset;
    return segment.verseStarts.some(
      ({ chapter, number, isContinuation }) =>
        !isContinuation && `${chapter}:${number}` === chapterAndVerse,
    );
  };
  const index = outline.findIndex((segment) => segment.id === ref);
  const found = index === -1 ? outline.findLastIndex(holds) : index;
  return found === -1 ? undefined : { start: found, end: found + 1 };
}
