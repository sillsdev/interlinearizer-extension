/// <reference types="jest" />

import { bookIndexesOf, buildBookIndexes } from '../../utils/book-indexes';
import { makeVerseBook } from '../test-helpers';

const BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning.' },
  { sid: 'GEN 1:2', text: 'And the earth' },
]);

describe('buildBookIndexes', () => {
  it('orders word tokens across the book, skipping punctuation', () => {
    const { tokenDocOrder, wordRefByOrder } = buildBookIndexes(BOOK.segments);

    expect(wordRefByOrder).toStrictEqual([
      'GEN 1:1:0',
      'GEN 1:1:3',
      'GEN 1:1:7',
      'GEN 1:2:0',
      'GEN 1:2:4',
      'GEN 1:2:8',
    ]);
    expect(tokenDocOrder.get('GEN 1:2:0')).toBe(3);
  });

  it('orders every token across the book, punctuation included', () => {
    const { fullTokenOrder } = buildBookIndexes(BOOK.segments);

    expect(fullTokenOrder.get('GEN 1:1:16')).toBe(3);
    expect(fullTokenOrder.get('GEN 1:2:0')).toBe(4);
  });

  it('maps each token to the segment holding it', () => {
    const { tokenSegmentMap } = buildBookIndexes(BOOK.segments);

    expect(tokenSegmentMap.get('GEN 1:1:16')).toBe('GEN 1:1');
    expect(tokenSegmentMap.get('GEN 1:2:8')).toBe('GEN 1:2');
  });

  it("keeps the text between a word and its segment's previous word", () => {
    const { gapTextByWordRef } = buildBookIndexes(BOOK.segments);

    expect(gapTextByWordRef.get('GEN 1:1:3')).toBe(' ');
    expect(gapTextByWordRef.has('GEN 1:2:0')).toBe(false);
  });
});

describe('bookIndexesOf', () => {
  it('serves the same indexes for the same segments', () => {
    expect(bookIndexesOf(BOOK.segments)).toBe(bookIndexesOf(BOOK.segments));
  });

  it('builds indexes afresh for other segments', () => {
    const indexes = bookIndexesOf(BOOK.segments);

    expect(bookIndexesOf([...BOOK.segments])).not.toBe(indexes);
    expect(bookIndexesOf([...BOOK.segments])).toStrictEqual(indexes);
  });
});
