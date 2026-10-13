/// <reference types="jest" />

import { resegmentBook } from '../../parsers/papi/resegmentBook';
import {
  adoptedStaleTranslation,
  nextSegmentAmong,
  placeStaleFreeTranslations,
  type StaleFreeTranslation,
  verseLabelOf,
} from '../../utils/stale-free-translations';
import { makeVerseBook } from '../test-helpers';

/** Builds a stale translation of `segmentId`, its id and text derived from it. */
function stale(segmentId: string): StaleFreeTranslation {
  return { analysisId: `sa ${segmentId}`, segmentId, text: `translation of ${segmentId}` };
}

/** Verses of Genesis 1, each its own segment. */
const verseBook = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning God created' },
  { sid: 'GEN 1:2', text: 'and the earth was void' },
  { sid: 'GEN 1:3', text: 'and God said' },
]);

/** The analysis ids in each list, keyed by segment id. */
function idsBySegment(
  bySegment: ReadonlyMap<string, readonly StaleFreeTranslation[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    [...bySegment].map(([segmentId, list]) => [segmentId, list.map((t) => t.analysisId)]),
  );
}

/** The analysis ids filed under each segment for its own review, keyed by segment id. */
function placed(
  translations: readonly StaleFreeTranslation[],
  book = verseBook,
): Record<string, string[]> {
  return idsBySegment(placeStaleFreeTranslations(translations, book).bySegment);
}

/** The analysis ids orphaned after each segment, keyed by segment id. */
function orphanedAfter(
  translations: readonly StaleFreeTranslation[],
  book = verseBook,
): Record<string, string[]> {
  return idsBySegment(placeStaleFreeTranslations(translations, book).orphanedAfter);
}

/** The analysis ids orphaned ahead of the book's first segment. */
function orphanedAhead(translations: readonly StaleFreeTranslation[], book = verseBook): string[] {
  return placeStaleFreeTranslations(translations, book).orphanedAhead.map((t) => t.analysisId);
}

describe('placeStaleFreeTranslations', () => {
  it('files a translation under the segment it was written for', () => {
    expect(placed([stale('GEN 1:2')])).toEqual({ 'GEN 1:2': ['sa GEN 1:2'] });
  });

  // Merging verse 3 into verse 2 leaves the segment keyed by verse 2 and verse 3's id with none.
  it('files a translation of a merged-away segment under the segment that absorbed it', () => {
    const merged = resegmentBook(verseBook, {
      removedVerseStarts: ['GEN 1:3:0'],
      addedStarts: [],
    });

    expect(placed([stale('GEN 1:3')], merged)).toEqual({ 'GEN 1:2': ['sa GEN 1:3'] });
  });

  // A split piece is keyed by its first token's ref; removing the split leaves that id with none.
  it('files a translation of a vanished split piece under the segment covering where it began', () => {
    expect(placed([stale('GEN 1:1:17')])).toEqual({ 'GEN 1:1': ['sa GEN 1:1:17'] });
  });

  it('files a translation of a split piece that still stands under that piece', () => {
    const split = resegmentBook(verseBook, {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: 'GEN 1:1:17', surfaceText: 'God' }],
    });

    expect(placed([stale('GEN 1:1:17')], split)).toEqual({ 'GEN 1:1:17': ['sa GEN 1:1:17'] });
  });

  // No token of the verse sits at or before offset 0 when the verse opens with a space.
  it('files a translation under the first segment of its verse when it began before every token', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: ' In the beginning' }]);

    expect(placed([stale('GEN 1:1')], book)).toEqual({ 'GEN 1:1': ['sa GEN 1:1'] });
  });

  it('lists the translations a segment shows in the order their positions run', () => {
    const merged = resegmentBook(verseBook, {
      removedVerseStarts: ['GEN 1:3:0'],
      addedStarts: [],
    });

    expect(placed([stale('GEN 1:3'), stale('GEN 1:2')], merged)).toEqual({
      'GEN 1:2': ['sa GEN 1:2', 'sa GEN 1:3'],
    });
  });

  it('files a translation of a verse emptied of its words under that verse', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:2', text: '   ' },
    ]);

    expect(placed([stale('GEN 1:2')], book)).toEqual({ 'GEN 1:2': ['sa GEN 1:2'] });
  });

  // Removing the verse's first s1 heading renumbers the second from `GEN 1:1/s1#2` to `GEN 1:1/s1`.
  it('files a translation of a renumbered-away heading under its verse heading of the same marker', () => {
    const book = makeVerseBook([
      { heading: 's1', verseId: 'GEN 1:1', text: 'New title', charIndex: 0 },
      { sid: 'GEN 1:1', text: 'In the beginning' },
    ]);

    expect(placed([stale('GEN 1:1/s1#2')], book)).toEqual({ 'GEN 1:1/s1': ['sa GEN 1:1/s1#2'] });
  });

  it('files a translation of a deleted heading under the start of its verse', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { heading: 's2', verseId: 'GEN 1:1', text: 'Other title' },
    ]);

    expect(placed([stale('GEN 1:1/s1')], book)).toEqual({ 'GEN 1:1': ['sa GEN 1:1/s1'] });
  });

  it('orphans a translation of a deleted verse after the segment ending the verse before it', () => {
    const book = resegmentBook(
      makeVerseBook([
        { sid: 'GEN 1:1', text: 'In the beginning God created' },
        { sid: 'GEN 1:3', text: 'and God said' },
      ]),
      { removedVerseStarts: [], addedStarts: [{ tokenRef: 'GEN 1:1:17', surfaceText: 'God' }] },
    );

    expect(orphanedAfter([stale('GEN 1:2')], book)).toEqual({ 'GEN 1:1:17': ['sa GEN 1:2'] });
  });

  it('files a translation of a deleted verse under no segment for review', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:3', text: 'and God said' },
    ]);

    expect(placed([stale('GEN 1:2')], book)).toEqual({});
  });

  it('orphans a translation of a deleted verse after the last segment of an earlier chapter', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:3', text: 'and God said' },
      { sid: 'GEN 2:1', text: 'Thus the heavens' },
    ]);

    expect(orphanedAfter([stale('GEN 1:9')], book)).toEqual({ 'GEN 1:3': ['sa GEN 1:9'] });
  });

  it('orphans a translation of a deleted verse ahead of every other ahead of the book', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:2', text: 'and the earth was void' },
      { sid: 'GEN 1:3', text: 'and God said' },
    ]);

    expect(orphanedAhead([stale('GEN 1:1')], book)).toEqual(['sa GEN 1:1']);
  });

  it('orphans nothing ahead of the book when an earlier verse remains', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 1:3', text: 'and God said' },
    ]);

    expect(orphanedAhead([stale('GEN 1:2')], book)).toEqual([]);
  });

  it('orphans a translation of a heading whose verse was deleted after the segment before it', () => {
    expect(orphanedAfter([stale('GEN 1:9/s1')])).toEqual({ 'GEN 1:3': ['sa GEN 1:9/s1'] });
  });

  it('lists the translations orphaned after a segment in the order their verses ran', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 2:1', text: 'Thus the heavens' },
    ]);

    expect(orphanedAfter([stale('GEN 1:3'), stale('GEN 1:2')], book)).toEqual({
      'GEN 1:1': ['sa GEN 1:2', 'sa GEN 1:3'],
    });
  });

  it('lists the translations orphaned in one chapter ahead of those in a later one', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'In the beginning' },
      { sid: 'GEN 3:1', text: 'Now the serpent' },
    ]);

    expect(orphanedAfter([stale('GEN 2:1'), stale('GEN 1:5')], book)).toEqual({
      'GEN 1:1': ['sa GEN 1:5', 'sa GEN 2:1'],
    });
  });

  it('lists the translations orphaned ahead of the book in the order their verses ran', () => {
    const book = makeVerseBook([{ sid: 'GEN 1:3', text: 'and God said' }]);

    expect(orphanedAhead([stale('GEN 1:2'), stale('GEN 1:1')], book)).toEqual([
      'sa GEN 1:1',
      'sa GEN 1:2',
    ]);
  });

  it('shows a translation nowhere in a book holding no text', () => {
    const placedNowhere = placeStaleFreeTranslations([stale('GEN 1:1')], makeVerseBook([]));

    expect(placedNowhere).toEqual({
      bySegment: new Map(),
      orphanedAfter: new Map(),
      orphanedAhead: [],
    });
  });

  it('shows a translation of another book nowhere', () => {
    expect(placed([stale('EXO 1:1')])).toEqual({});
  });
});

describe('verseLabelOf', () => {
  it('names the verse a segment begun at a verse falls in', () => {
    expect(verseLabelOf('GEN 1:5')).toBe('1:5');
  });

  it('names a verse range verbatim', () => {
    expect(verseLabelOf('GEN 1:5-6')).toBe('1:5-6');
  });

  it('names the verse a segment begun mid-verse falls in', () => {
    expect(verseLabelOf('GEN 1:5:12')).toBe('1:5');
  });

  it('names the verse a heading is filed under', () => {
    expect(verseLabelOf('GEN 1:5/s1#2')).toBe('1:5');
  });
});

describe('adoptedStaleTranslation', () => {
  it('adopts the only stale translation of a segment holding no approved one', () => {
    const only = stale('GEN 1:1');
    expect(adoptedStaleTranslation([only], false)).toBe(only);
  });

  it('adopts nothing for a segment holding an approved translation', () => {
    expect(adoptedStaleTranslation([stale('GEN 1:1')], true)).toBeUndefined();
  });

  it('adopts nothing for a segment showing several stale translations', () => {
    expect(adoptedStaleTranslation([stale('GEN 1:1'), stale('GEN 1:2')], false)).toBeUndefined();
  });

  it('adopts nothing from a stale translation with no text in the active language', () => {
    expect(adoptedStaleTranslation([{ ...stale('GEN 1:1'), text: '' }], false)).toBeUndefined();
  });
});

describe('nextSegmentAmong', () => {
  const [verse1, verse2, verse3] = verseBook.segments;
  const atVerse = (verseNum: number) => ({ book: 'GEN', chapterNum: 1, verseNum });

  it('finds the first listed segment after the one holding the focused word', () => {
    const next = nextSegmentAmong(
      verseBook,
      ['GEN 1:1', 'GEN 1:3'],
      verse1.tokens[0].ref,
      atVerse(1),
    );

    expect(next?.id).toBe('GEN 1:3');
  });

  it('wraps around to the book’s first listed segment past the last', () => {
    const next = nextSegmentAmong(verseBook, ['GEN 1:1'], verse3.tokens[0].ref, atVerse(3));

    expect(next?.id).toBe('GEN 1:1');
  });

  it('starts from the segment holding the active verse while no word is focused', () => {
    const next = nextSegmentAmong(verseBook, ['GEN 1:2', 'GEN 1:3'], undefined, atVerse(2));

    expect(next?.id).toBe('GEN 1:3');
  });

  it('starts from the focused word rather than the active verse', () => {
    const next = nextSegmentAmong(
      verseBook,
      ['GEN 1:2', 'GEN 1:3'],
      verse2.tokens[0].ref,
      atVerse(1),
    );

    expect(next?.id).toBe('GEN 1:3');
  });

  it('starts from the segment the last jump landed on rather than the focused word', () => {
    const next = nextSegmentAmong(
      verseBook,
      ['GEN 1:2', 'GEN 1:3'],
      verse1.tokens[0].ref,
      atVerse(1),
      'GEN 1:2',
    );

    expect(next?.id).toBe('GEN 1:3');
  });

  it('starts ahead of the whole book when neither the focus nor the verse is in it', () => {
    const next = nextSegmentAmong(verseBook, ['GEN 1:1', 'GEN 1:3'], undefined, {
      book: 'EXO',
      chapterNum: 1,
      verseNum: 1,
    });

    expect(next?.id).toBe('GEN 1:1');
  });

  it('finds nothing when the book holds none of the segments', () => {
    expect(nextSegmentAmong(verseBook, ['GEN 9:9'], undefined, atVerse(1))).toBeUndefined();
  });
});
