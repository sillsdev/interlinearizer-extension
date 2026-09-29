/// <reference types="jest" />

import { resegmentBook } from '../../parsers/papi/resegmentBook';
import {
  adoptedStaleTranslation,
  placeStaleFreeTranslations,
  type StaleFreeTranslation,
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

/** The analysis ids filed under each segment, keyed by segment id. */
function placed(
  translations: readonly StaleFreeTranslation[],
  book = verseBook,
): Record<string, string[]> {
  return Object.fromEntries(
    [...placeStaleFreeTranslations(translations, book)].map(([segmentId, list]) => [
      segmentId,
      list.map((t) => t.analysisId),
    ]),
  );
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

  it('shows a translation of a heading whose verse the book no longer holds nowhere', () => {
    expect(placed([stale('GEN 1:9/s1')])).toEqual({});
  });

  it('shows a translation of a verse the book no longer holds nowhere', () => {
    expect(placed([stale('GEN 1:9')])).toEqual({});
  });

  it('shows a translation of another book nowhere', () => {
    expect(placed([stale('EXO 1:1')])).toEqual({});
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
