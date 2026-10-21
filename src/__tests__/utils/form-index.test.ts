/// <reference types="jest" />

import { indexBook } from '../../utils/concordance';
import { FormIndex, formsOfBook } from '../../utils/form-index';
import { makeVerseBook } from '../test-helpers';

const BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning.' },
  { sid: 'GEN 1:2', text: 'The earth' },
]);

describe('formsOfBook', () => {
  it("holds each of the book's word forms once, normalized", () => {
    expect(formsOfBook(BOOK)).toEqual(new Set(['in', 'the', 'beginning', 'earth']));
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

    expect(['in', 'the', 'now'].map((form) => index.has(form))).toEqual([true, true, true]);
  });

  it('misses a form no book filed holds', () => {
    const index = new FormIndex();

    index.setBook('GEN', new Set(['in', 'the']));

    expect(index.has('earth')).toBe(false);
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
