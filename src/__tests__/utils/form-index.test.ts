/// <reference types="jest" />

import type { Book } from 'interlinearizer';
import { indexBook } from '../../utils/concordance';
import { FormIndex, formsOfBook } from '../../utils/form-index';
import { makePunctToken, makeSegment, makeWordToken } from '../test-helpers';

const BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1@en',
  duplicateVerseIds: [],
  segments: [
    makeSegment('GEN 1:1', 'In the beginning.', [
      makeWordToken('GEN 1:1:0', 'In'),
      makeWordToken('GEN 1:1:3', 'the'),
      makeWordToken('GEN 1:1:7', 'beginning'),
      makePunctToken('GEN 1:1:16'),
    ]),
    makeSegment('GEN 1:2', 'The earth', [
      makeWordToken('GEN 1:2:0', 'The'),
      makeWordToken('GEN 1:2:4', 'earth'),
    ]),
  ],
};

describe('formsOfBook', () => {
  it("holds each of the book's word forms once, normalized", () => {
    expect([...formsOfBook(BOOK)]).toEqual(['in', 'the', 'beginning', 'earth']);
  });

  it('holds the forms the concordance files occurrences under', () => {
    expect(formsOfBook(BOOK)).toEqual(new Set(indexBook(BOOK).occurrencesByForm.keys()));
  });
});

describe('FormIndex', () => {
  it('holds the forms of every book filed', () => {
    const index = new FormIndex();

    index.setBook('GEN', new Set(['in', 'the']));
    index.setBook('EXO', new Set(['now']));

    expect(['in', 'the', 'now', 'earth'].map((form) => index.has(form))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("drops forms only a refiled book's earlier forms held", () => {
    const index = new FormIndex();
    index.setBook('GEN', new Set(['in', 'the']));

    index.setBook('GEN', new Set(['the', 'earth']));

    expect(['in', 'the', 'earth'].map((form) => index.has(form))).toEqual([false, true, true]);
  });

  it('keeps a form another book still holds once a book is refiled without it', () => {
    const index = new FormIndex();
    index.setBook('GEN', new Set(['the']));
    index.setBook('EXO', new Set(['the']));

    index.setBook('GEN', new Set());

    expect(index.has('the')).toBe(true);
  });
});
