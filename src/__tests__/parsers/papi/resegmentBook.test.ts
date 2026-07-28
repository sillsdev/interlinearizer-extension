/// <reference types="jest" />

import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';

/**
 * Builds a verse-tokenized GEN book from the given verses. Each verse's rendered `number` defaults
 * to the verse portion of its sid when not given.
 */
function makeBook(verses: { sid: string; text: string; number?: string }[]): Book {
  return tokenizeBook({
    bookCode: 'GEN',
    writingSystem: 'en',
    contentHash: 'h',
    verses: verses.map(({ sid, text, number }) => ({
      sid,
      text,
      number: number ?? sid.slice(sid.lastIndexOf(':') + 1),
    })),
  });
}

const BOOK = makeBook([
  { sid: 'GEN 1:1', text: 'Alpha beta.' },
  { sid: 'GEN 1:2', text: 'Gamma delta.' },
  { sid: 'GEN 1:3', text: 'Epsilon.' },
]);

/** Asserts the segment-baseline/offset invariant for every token of every segment. */
function expectInvariant(book: Book): void {
  book.segments.forEach((seg) => {
    seg.tokens.forEach((t) => {
      expect(seg.baselineText.slice(t.charStart, t.charEnd)).toBe(t.surfaceText);
    });
  });
}

describe('resegmentBook', () => {
  it('returns the same book reference for an undefined delta', () => {
    expect(resegmentBook(BOOK, undefined)).toBe(BOOK);
  });

  it('returns the same book reference for an empty delta', () => {
    expect(resegmentBook(BOOK, { removedVerseStarts: [], addedStarts: [] })).toBe(BOOK);
  });

  it('reuses untouched verse Segment objects by reference when a delta is active elsewhere', () => {
    // Merge verses 1+2; verse 3 is untouched and should be the same object.
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
    expect(result.segments[1]).toBe(BOOK.segments[2]);
  });

  it('merges two verses into one segment with concatenated baseline and shifted offsets', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
    expect(result.segments).toHaveLength(2);
    const merged = result.segments[0];
    expect(merged.baselineText).toBe('Alpha beta. Gamma delta.');
    // Token refs are preserved unchanged across the merge.
    expect(merged.tokens.map((t) => t.ref)).toEqual([
      'GEN 1:1:0',
      'GEN 1:1:6',
      'GEN 1:1:10',
      'GEN 1:2:0',
      'GEN 1:2:6',
      'GEN 1:2:11',
    ]);
    expectInvariant(result);
  });

  it('records one verse start per absorbed verse, at its offset in the merged baseline', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
    // 'Alpha beta.' is 11 chars; the merge separator adds 1, so verse 2 begins at offset 12.
    expect(result.segments[0].verseStarts).toEqual([
      { charStart: 0, number: '1', chapter: 1 },
      { charStart: 12, number: '2', chapter: 1 },
    ]);
  });

  it('keeps the leading verse SID as the merged segment id', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
    expect(result.segments[0].id).toBe('GEN 1:1');
  });

  it('spans the merged range in startRef/endRef', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] });
    expect(result.segments[0].startRef).toEqual({ book: 'GEN', chapter: 1, verse: 1 });
    expect(result.segments[0].endRef).toEqual({ book: 'GEN', chapter: 1, verse: 2 });
  });

  it('splits a verse before a mid-verse token', () => {
    // Split verse 1 before "beta" (charStart 6).
    const result = resegmentBook(BOOK, { removedVerseStarts: [], addedStarts: ['GEN 1:1:6'] });
    expect(result.segments).toHaveLength(4);
    const [firstHalf, secondHalf] = result.segments;
    expect(firstHalf.id).toBe('GEN 1:1');
    expect(firstHalf.tokens.map((t) => t.ref)).toEqual(['GEN 1:1:0']);
    // The second half begins mid-verse, so it takes its first token's ref as a fresh id.
    expect(secondHalf.id).toBe('GEN 1:1:6');
    expect(secondHalf.tokens.map((t) => t.ref)).toEqual(['GEN 1:1:6', 'GEN 1:1:10']);
    expectInvariant(result);
  });

  it('gives each split piece a single verse start at offset 0 for its verse', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: [], addedStarts: ['GEN 1:1:6'] });
    const [firstHalf, secondHalf] = result.segments;
    // The first piece begins the verse (no continuation flag); the second piece continues it
    // mid-verse, so its verse start is flagged as a continuation and renders no superscript.
    expect(firstHalf.verseStarts).toEqual([{ charStart: 0, number: '1', chapter: 1 }]);
    expect(secondHalf.verseStarts).toEqual([
      { charStart: 0, number: '1', chapter: 1, isContinuation: true },
    ]);
  });

  it('carries a sub-verse charIndex on a split piece that begins mid-verse', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: [], addedStarts: ['GEN 1:1:6'] });
    expect(result.segments[1].startRef).toEqual({
      book: 'GEN',
      chapter: 1,
      verse: 1,
      charIndex: 6,
    });
  });

  it('ignores a drifted (nonexistent) anchor and yields the default grouping', () => {
    const result = resegmentBook(BOOK, { removedVerseStarts: ['GEN 9:9:9'], addedStarts: [] });
    expect(result.segments.map((s) => s.id)).toEqual(['GEN 1:1', 'GEN 1:2', 'GEN 1:3']);
  });
});
