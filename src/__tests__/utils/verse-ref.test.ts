/** @file Unit tests for utils/verse-ref.ts. */
/// <reference types="jest" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Segment } from 'interlinearizer';
import { segmentContainsVerse } from '../../utils/verse-ref';

/**
 * Builds a minimal token-less {@link Segment} spanning the given verse coordinates. Containment only
 * reads `startRef` and `endRef`, so tokens and baseline text stay empty.
 *
 * @param startChapter - Chapter of the segment's start.
 * @param startVerse - Verse of the segment's start.
 * @param endChapter - Chapter of the segment's end; defaults to `startChapter`.
 * @param endVerse - Verse of the segment's end; defaults to `startVerse`.
 * @returns The assembled segment.
 */
function makeSegment(
  startChapter: number,
  startVerse: number,
  endChapter: number = startChapter,
  endVerse: number = startVerse,
): Segment {
  return {
    id: 'seg',
    startRef: { book: 'GEN', chapter: startChapter, verse: startVerse },
    endRef: { book: 'GEN', chapter: endChapter, verse: endVerse },
    baselineText: '',
    tokens: [],
  };
}

/**
 * Builds a `SerializedVerseRef` in the test book.
 *
 * @param chapterNum - The chapter number.
 * @param verseNum - The verse number.
 * @param book - The book id; defaults to the segments' book.
 * @returns The assembled reference.
 */
function makeRef(chapterNum: number, verseNum: number, book: string = 'GEN'): SerializedVerseRef {
  return { book, chapterNum, verseNum };
}

describe('segmentContainsVerse', () => {
  it('contains the verse a single-verse segment names', () => {
    expect(segmentContainsVerse(makeSegment(1, 2), makeRef(1, 2))).toBe(true);
  });

  it('does not contain a different verse of the same chapter', () => {
    expect(segmentContainsVerse(makeSegment(1, 2), makeRef(1, 3))).toBe(false);
  });

  it('contains an interior verse of a merged multi-verse segment', () => {
    expect(segmentContainsVerse(makeSegment(1, 1, 1, 3), makeRef(1, 2))).toBe(true);
  });

  it('contains both end verses of a multi-verse segment inclusively', () => {
    const seg = makeSegment(1, 2, 1, 4);
    expect(segmentContainsVerse(seg, makeRef(1, 2))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(1, 4))).toBe(true);
  });

  it('does not contain verses outside the range', () => {
    const seg = makeSegment(1, 2, 1, 4);
    expect(segmentContainsVerse(seg, makeRef(1, 1))).toBe(false);
    expect(segmentContainsVerse(seg, makeRef(1, 5))).toBe(false);
  });

  it('contains verses across a chapter-crossing range', () => {
    const seg = makeSegment(1, 29, 2, 2);
    expect(segmentContainsVerse(seg, makeRef(1, 30))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(2, 1))).toBe(true);
  });

  it('does not contain verses beyond a chapter-crossing range', () => {
    const seg = makeSegment(1, 29, 2, 2);
    expect(segmentContainsVerse(seg, makeRef(1, 28))).toBe(false);
    expect(segmentContainsVerse(seg, makeRef(2, 3))).toBe(false);
  });

  it('never contains a verse from another book', () => {
    expect(segmentContainsVerse(makeSegment(1, 1, 1, 3), makeRef(1, 2, 'EXO'))).toBe(false);
  });
});
