/// <reference types="jest" />

import type { OutlineSegment } from '../../types/segment-pages';
import { STRIP_MARGIN_WORDS, loadedRun, stripTarget } from '../../utils/strip-range';

/** An outline of `count` segments holding `words` words apiece. */
function outlineOf(count: number, words: number): OutlineSegment[] {
  return Array.from({ length: count }, (_unused, i) => ({
    id: `GEN 1:${i + 1}`,
    startRef: { book: 'GEN', chapter: 1, verse: i + 1 },
    verseStarts: [],
    tokenCount: words,
    wordTokenCount: words,
    textLength: words * 5,
  }));
}

describe('stripTarget', () => {
  it('holds enough segments each side for the margin of words', () => {
    const outline = outlineOf(100, STRIP_MARGIN_WORDS / 4);

    expect(stripTarget(outline, 50, 52)).toEqual({ start: 46, end: 57 });
  });

  it('holds one segment each side when one holds the margin of words', () => {
    const outline = outlineOf(100, STRIP_MARGIN_WORDS);

    expect(stripTarget(outline, 50, 50)).toEqual({ start: 49, end: 52 });
  });

  it('reaches past segments without words', () => {
    const outline = outlineOf(100, 0);
    outline[47] = { ...outline[47], wordTokenCount: STRIP_MARGIN_WORDS };

    expect(stripTarget(outline, 50, 50).start).toBe(47);
  });

  it('stops at the start of the book', () => {
    expect(stripTarget(outlineOf(100, 1), 2, 2).start).toBe(0);
  });

  it('stops at the end of the book', () => {
    expect(stripTarget(outlineOf(100, 1), 97, 97).end).toBe(100);
  });

  it('holds nothing of an empty book', () => {
    expect(stripTarget([], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('loadedRun', () => {
  const loadedFrom = (start: number, end: number) => (index: number) =>
    index >= start && index < end;

  it('runs as far as the target each side while segments have loaded', () => {
    expect(loadedRun(loadedFrom(0, 100), 50, { start: 40, end: 60 })).toEqual({
      start: 40,
      end: 60,
    });
  });

  it('stops before a segment that has not loaded', () => {
    expect(loadedRun(loadedFrom(45, 55), 50, { start: 40, end: 60 })).toEqual({
      start: 45,
      end: 55,
    });
  });

  it('is empty at an anchor that has not loaded', () => {
    expect(loadedRun(loadedFrom(0, 10), 50, { start: 40, end: 60 })).toEqual({
      start: 50,
      end: 50,
    });
  });
});
