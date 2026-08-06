/// <reference types="jest" />

import type { Book, Token } from 'interlinearizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import type { LinkSlot, TokenGroup } from '../../types/token-layout';
import { buildVerseStartLabels, slotVerseLabel } from '../../utils/verse-superscripts';
import { makeVerseBook, makeWordToken } from '../test-helpers';

/** Reads the superscript labels for a segment by id, failing the test when absent. */
function labelsFor(book: Book, segmentId: string): string[] {
  const labels = buildVerseStartLabels(book.segments).get(segmentId);
  if (!labels) throw new Error(`no labels for ${segmentId}`);
  return labels;
}

describe('buildVerseStartLabels', () => {
  it('qualifies the first verse of a chapter with its chapter number', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 1:2', text: 'Beta.' },
    ]);
    expect(labelsFor(book, 'GEN 1:1')).toEqual(['1:1']);
    expect(labelsFor(book, 'GEN 1:2')).toEqual(['2']);
  });

  it('qualifies the first verse of a later chapter', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.' },
    ]);
    expect(labelsFor(book, 'GEN 2:1')).toEqual(['2:1']);
  });

  it('qualifies an absorbed chapter start inside a merged mid-chapter segment', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.' },
    ]);
    // Merge GEN 2:1 into GEN 1:1: the merged segment starts in chapter 1 but contains chapter 2's
    // first token, so that verse start is still chapter-qualified.
    const merged = resegmentBook(book, { removedVerseStarts: ['GEN 2:1:0'], addedStarts: [] });
    expect(labelsFor(merged, 'GEN 1:1')).toEqual(['1:1', '2:1']);
  });

  it('prepends the chapter verbatim to a range number at a chapter transition', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: 'Gamma.', number: '1-2' },
    ]);
    expect(labelsFor(book, 'GEN 2:1')).toEqual(['2:1-2']);
  });

  it('qualifies and advances the chapter for an empty verse opening a chapter', () => {
    // An empty verse tokenizes to no tokens, but its chapter comes from VerseStart.chapter, so a
    // chapter-opening empty verse is still qualified and still advances the running max — the
    // following non-empty verse in the same chapter renders bare.
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'Alpha.' },
      { sid: 'GEN 2:1', text: '' },
      { sid: 'GEN 2:2', text: 'Gamma.' },
    ]);
    expect(labelsFor(book, 'GEN 2:1')).toEqual(['2:1']);
    expect(labelsFor(book, 'GEN 2:2')).toEqual(['2']);
  });

  it('qualifies a verse-0 superscription at a chapter transition', () => {
    const book = makeVerseBook([
      { sid: 'PSA 3:0', text: 'A song.', number: '0' },
      { sid: 'PSA 3:1', text: 'Yahweh.' },
    ]);
    expect(labelsFor(book, 'PSA 3:0')).toEqual(['3:0']);
    expect(labelsFor(book, 'PSA 3:1')).toEqual(['1']);
  });
});

describe('slotVerseLabel', () => {
  /** Builds a token group from the given word tokens. */
  function group(tokens: (Token & { type: 'word' })[]): TokenGroup {
    return {
      tokens,
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: tokens.map(() => []),
    };
  }

  /** Builds a between-group slot with the given next group and gap punctuation. */
  function slot(nextGroup: TokenGroup | undefined, punctuation: Token[] = []): LinkSlot {
    return { prevGroup: undefined, nextGroup, punctuation };
  }

  it('returns the label when the next group’s first token is a verse start', () => {
    const labels = new Map([['GEN 1:2:0', '2']]);
    expect(slotVerseLabel(slot(group([makeWordToken('GEN 1:2:0')])), labels)).toBe('2');
  });

  it('returns the label when a gap-punctuation token is the verse start', () => {
    const labels = new Map([['GEN 1:2:0', '2']]);
    const punct = makeWordToken('GEN 1:2:0');
    expect(slotVerseLabel(slot(group([makeWordToken('GEN 1:2:3')]), [punct]), labels)).toBe('2');
  });

  it('returns the label when the verse start is buried mid-group (phrase fused across a merged verse boundary)', () => {
    // A phrase link fusing verse 1's last word with verse 2's first word puts the verse-2 start as a
    // non-first token of the group.
    const labels = new Map([['GEN 1:2:0', '2']]);
    const fused = group([makeWordToken('GEN 1:1:5'), makeWordToken('GEN 1:2:0')]);
    expect(slotVerseLabel(slot(fused), labels)).toBe('2');
  });

  it('returns undefined when no candidate ref is a verse start', () => {
    const labels = new Map([['GEN 1:2:0', '2']]);
    expect(slotVerseLabel(slot(group([makeWordToken('GEN 1:1:0')])), labels)).toBeUndefined();
  });

  it('returns undefined for a trailing slot with no next group and no punctuation', () => {
    const labels = new Map([['GEN 1:2:0', '2']]);
    expect(slotVerseLabel(slot(undefined), labels)).toBeUndefined();
  });
});
