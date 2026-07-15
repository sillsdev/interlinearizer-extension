/** @file Unit tests for utils/verse-ref.ts. */
/// <reference types="jest" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Segment } from 'interlinearizer';
import { firstVerseNumber, segmentContainsVerse } from '../../utils/verse-ref';

/**
 * Builds a minimal token-less {@link Segment} covering the given verses. Containment reads the
 * segment's `verseStarts`, so `covered` enumerates each covered verse as a `[chapter, verse]` pair,
 * mirroring how a merged segment carries one verse start per absorbed verse. `startRef` / `endRef`
 * are taken from the first and last covered verse.
 *
 * @param covered - The verses the segment covers, in document order, as `[chapter, verse]` pairs.
 * @returns The assembled segment.
 */
function makeSegment(covered: [number, number][]): Segment {
  const [startChapter, startVerse] = covered[0];
  const [endChapter, endVerse] = covered[covered.length - 1];
  return {
    id: 'seg',
    startRef: { book: 'GEN', chapter: startChapter, verse: startVerse },
    endRef: { book: 'GEN', chapter: endChapter, verse: endVerse },
    baselineText: '',
    tokens: [],
    verseStarts: covered.map(([chapter, verse]) => ({
      charStart: 0,
      number: String(verse),
      chapter,
    })),
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
    expect(segmentContainsVerse(makeSegment([[1, 2]]), makeRef(1, 2))).toBe(true);
  });

  it('does not contain a different verse of the same chapter', () => {
    expect(segmentContainsVerse(makeSegment([[1, 2]]), makeRef(1, 3))).toBe(false);
  });

  it('contains an interior verse of a merged multi-verse segment', () => {
    const seg = makeSegment([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 2))).toBe(true);
  });

  it('contains both end verses of a multi-verse segment inclusively', () => {
    const seg = makeSegment([
      [1, 2],
      [1, 3],
      [1, 4],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 2))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(1, 4))).toBe(true);
  });

  it('does not contain verses outside the range', () => {
    const seg = makeSegment([
      [1, 2],
      [1, 3],
      [1, 4],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 1))).toBe(false);
    expect(segmentContainsVerse(seg, makeRef(1, 5))).toBe(false);
  });

  it('contains verses across a chapter-crossing range', () => {
    const seg = makeSegment([
      [1, 29],
      [1, 30],
      [2, 1],
      [2, 2],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 30))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(2, 1))).toBe(true);
  });

  it('does not contain verses beyond a chapter-crossing range', () => {
    const seg = makeSegment([
      [1, 29],
      [1, 30],
      [2, 1],
      [2, 2],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 28))).toBe(false);
    expect(segmentContainsVerse(seg, makeRef(2, 3))).toBe(false);
  });

  it('does not over-claim a phantom verse past the start chapter of a cross-chapter merge', () => {
    // A merge folds chapter 1's tail into chapter 2's opening, so the segment covers 1:2 and 2:1
    // but no verse between. The host's next-verse button can over-shoot chapter 1's real end to a
    // phantom verse (1:99); a lexicographic startRef..endRef interval would wrongly claim it.
    const seg = makeSegment([
      [1, 2],
      [2, 1],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 99))).toBe(false);
    expect(segmentContainsVerse(seg, makeRef(1, 2))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(2, 1))).toBe(true);
  });

  it('contains a verse named by a verse-start range label', () => {
    const seg: Segment = {
      id: 'seg',
      startRef: { book: 'GEN', chapter: 1, verse: 3 },
      endRef: { book: 'GEN', chapter: 1, verse: 4 },
      baselineText: '',
      tokens: [],
      verseStarts: [{ charStart: 0, number: '3-4', chapter: 1 }],
    };
    expect(segmentContainsVerse(seg, makeRef(1, 3))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(1, 4))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(1, 5))).toBe(false);
  });

  it('contains the later verse of a range label written with a non-ASCII (en-dash) separator', () => {
    const seg: Segment = {
      id: 'seg',
      startRef: { book: 'GEN', chapter: 1, verse: 3 },
      endRef: { book: 'GEN', chapter: 1, verse: 4 },
      baselineText: '',
      tokens: [],
      verseStarts: [{ charStart: 0, number: '3–4', chapter: 1 }],
    };
    expect(segmentContainsVerse(seg, makeRef(1, 4))).toBe(true);
    expect(segmentContainsVerse(seg, makeRef(1, 5))).toBe(false);
  });

  it('does not match a verse start whose label has no digits', () => {
    const seg: Segment = {
      id: 'seg',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: '',
      tokens: [],
      verseStarts: [{ charStart: 0, number: '', chapter: 1 }],
    };
    expect(segmentContainsVerse(seg, makeRef(1, 1))).toBe(false);
  });

  it('never contains a verse from another book', () => {
    const seg = makeSegment([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(segmentContainsVerse(seg, makeRef(1, 2, 'EXO'))).toBe(false);
  });
});

describe('firstVerseNumber', () => {
  it('returns the number of a plain verse label', () => {
    expect(firstVerseNumber('7')).toBe(7);
  });

  it('returns the first endpoint of a hyphenated range label', () => {
    expect(firstVerseNumber('3-4')).toBe(3);
  });

  it('returns the first endpoint of a range label written with an en-dash', () => {
    expect(firstVerseNumber('3–4')).toBe(3);
  });

  it('returns undefined for a label that begins with no digits', () => {
    expect(firstVerseNumber('')).toBeUndefined();
  });
});
