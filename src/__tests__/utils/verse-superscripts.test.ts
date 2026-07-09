/** @file Unit tests for utils/verse-superscripts.ts. */
/// <reference types="jest" />

import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { buildVerseStartLabels } from '../../utils/verse-superscripts';

/**
 * Builds a verse-tokenized book from the given verses. Each verse's rendered `number` defaults to
 * the verse portion of its sid.
 *
 * @param verses - Verse SID + text pairs (optional number).
 * @returns The tokenized book.
 */
function makeBook(verses: { sid: string; text: string; number?: string }[]): Book {
  return tokenizeBook({
    bookCode: verses[0]?.sid.split(' ')[0] ?? 'GEN',
    writingSystem: 'en',
    contentHash: 'h',
    verses: verses.map(({ sid, text, number }) => ({
      sid,
      text,
      number: number ?? sid.slice(sid.lastIndexOf(':') + 1),
    })),
  });
}

/**
 * Reads the superscript labels for a segment by id, failing the test when absent.
 *
 * @param book - The book to label.
 * @param segmentId - Segment id to look up.
 * @returns The segment's parallel-by-index verse-start labels.
 */
function labelsFor(book: Book, segmentId: string): string[] {
  const labels = buildVerseStartLabels(book.segments).get(segmentId);
  if (!labels) throw new Error(`no labels for ${segmentId}`);
  return labels;
}

describe('buildVerseStartLabels', () => {
  it('qualifies the first verse of a chapter with its chapter number', () => {
    const book = makeBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 1:2', text: 'Beta.' },
    ]);
    expect(labelsFor(book, 'GEN 1:1')).toEqual(['1:1']);
    expect(labelsFor(book, 'GEN 1:2')).toEqual(['2']);
  });

  it('qualifies the first verse of a later chapter', () => {
    const book = makeBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.' },
    ]);
    expect(labelsFor(book, 'GEN 2:1')).toEqual(['2:1']);
  });

  it('qualifies an absorbed chapter start inside a merged mid-chapter segment', () => {
    const book = makeBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.' },
    ]);
    // Merge GEN 2:1 into GEN 1:1: the merged segment starts in chapter 1 but contains chapter 2's
    // first token, so that verse start is still chapter-qualified.
    const merged = resegmentBook(book, { removedVerseStarts: ['GEN 2:1:0'], addedStarts: [] });
    expect(labelsFor(merged, 'GEN 1:1')).toEqual(['1:1', '2:1']);
  });

  it('prepends the chapter verbatim to a range number at a chapter transition', () => {
    const book = makeBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.', number: '1-2' },
    ]);
    expect(labelsFor(book, 'GEN 2:1')).toEqual(['2:1-2']);
  });

  it('renders a bare number for a verse start with no anchoring token', () => {
    // An empty verse tokenizes to no tokens, so its verse start has no token to read a chapter
    // from: the label falls back to the bare number rather than being chapter-qualified.
    const book = makeBook([{ sid: 'GEN 1:1', text: '' }]);
    expect(labelsFor(book, 'GEN 1:1')).toEqual(['1']);
  });

  it('qualifies a verse-0 superscription at a chapter transition', () => {
    const book = makeBook([
      { sid: 'PSA 3:0', text: 'A song.', number: '0' },
      { sid: 'PSA 3:1', text: 'Yahweh.' },
    ]);
    expect(labelsFor(book, 'PSA 3:0')).toEqual(['3:0']);
    expect(labelsFor(book, 'PSA 3:1')).toEqual(['1']);
  });
});
