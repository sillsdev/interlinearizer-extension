/// <reference types="jest" />

import type { Book } from 'interlinearizer';
import { buildBookOutline, outlineSegment } from '../../utils/book-outline';
import { makePunctToken, makeSegment, makeWordToken } from '../test-helpers';

describe('outlineSegment', () => {
  it('keeps where the segment falls', () => {
    const segment = makeSegment('GEN 1:1', 'In the beginning', [makeWordToken('GEN 1:1:0', 'In')]);

    expect(outlineSegment(segment)).toMatchObject({
      id: 'GEN 1:1',
      startRef: segment.startRef,
      verseStarts: segment.verseStarts,
    });
  });

  it('counts every token, and words apart, without carrying them', () => {
    const outline = outlineSegment(
      makeSegment('GEN 1:1', 'a, b.', [
        makeWordToken('GEN 1:1:0', 'a'),
        makePunctToken('GEN 1:1:1', ','),
        makeWordToken('GEN 1:1:3', 'b', 3),
        makePunctToken('GEN 1:1:4', '.'),
      ]),
    );

    expect(outline).toMatchObject({ tokenCount: 4, wordTokenCount: 2, textLength: 5 });
    expect(outline).not.toHaveProperty('tokens');
    expect(outline).not.toHaveProperty('baselineText');
  });

  it("keeps a heading's marker", () => {
    const heading = { marker: 's1', verseId: 'GEN 1:0', verseNumber: '0' };
    const segment = { ...makeSegment('GEN 1:0', '', []), id: 'GEN 1:0/s1', heading };

    expect(outlineSegment(segment).heading).toBe(heading);
  });

  it('leaves a verse without a heading', () => {
    expect(outlineSegment(makeSegment('GEN 1:1', '', []))).not.toHaveProperty('heading');
  });
});

describe('buildBookOutline', () => {
  it('outlines the segments given, under the book and its text version', () => {
    const segments = [makeSegment('GEN 1:1', 'a', [makeWordToken('GEN 1:1:0', 'a')])];
    const book: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [],
      duplicateVerseIds: [],
    };

    expect(buildBookOutline(book, segments)).toEqual({
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: segments.map(outlineSegment),
    });
  });
});
