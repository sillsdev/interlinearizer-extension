/// <reference types="jest" />

import type { PageFailure } from '../../types/segment-pages';
import { failedRunsIn, runVerses } from '../../utils/page-failures';
import { makeSegment, outlineOf } from '../test-helpers';

const FAILED: PageFailure = { cause: 'app', isRetrying: false, failedAgain: false };

/** Reports the segments at `failed` as failed, and every other segment as not. */
const failingAt =
  (...failed: number[]) =>
  (index: number) =>
    failed.includes(index) ? FAILED : undefined;

describe('failedRunsIn', () => {
  it('finds no run when nothing in the range failed', () => {
    expect(failedRunsIn(failingAt(8), 10, 0, 5)).toStrictEqual([]);
  });

  it('finds a run inside the range', () => {
    expect(failedRunsIn(failingAt(2, 3), 10, 0, 5)).toStrictEqual([{ start: 2, end: 4 }]);
  });

  it('reports a run that reaches past both edges of the range at its full length', () => {
    expect(failedRunsIn(failingAt(1, 2, 3, 4, 5), 10, 2, 4)).toStrictEqual([{ start: 1, end: 6 }]);
  });

  it('stops a run at the end of the book', () => {
    expect(failedRunsIn(failingAt(8, 9), 10, 8, 9)).toStrictEqual([{ start: 8, end: 10 }]);
  });

  it('finds each run apart', () => {
    expect(failedRunsIn(failingAt(1, 3, 4), 10, 0, 5)).toStrictEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});

describe('runVerses', () => {
  const outline = outlineOf([
    makeSegment('JOS 13:18', 'one', []),
    makeSegment('JOS 13:19', 'two', []),
    makeSegment('JOS 14:1', 'three', []),
  ]);

  it('names the verse of a run of one segment', () => {
    expect(runVerses(outline, { start: 0, end: 1 })).toBe('13:18');
  });

  it('names the first and last verse of a run within a chapter', () => {
    expect(runVerses(outline, { start: 0, end: 2 })).toBe('13:18–19');
  });

  it('names the chapter of the last verse of a run that crosses into another chapter', () => {
    expect(runVerses(outline, { start: 0, end: 3 })).toBe('13:18–14:1');
  });

  it('ends a run at the last verse that its last segment starts', () => {
    const merged = makeSegment('JOS 13:18', 'one two', []);
    const withMerge = outlineOf([
      {
        ...merged,
        verseStarts: [...merged.verseStarts, { charStart: 4, number: '19', chapter: 13 }],
      },
    ]);

    expect(runVerses(withMerge, { start: 0, end: 1 })).toBe('13:18–19');
  });

  it('ends a run on a heading at the verse that the heading is filed under', () => {
    const withHeading = outlineOf([
      makeSegment('JOS 13:18', 'one', []),
      { ...makeSegment('JOS 13:19', 'Heading', []), verseStarts: [] },
    ]);

    expect(runVerses(withHeading, { start: 0, end: 2 })).toBe('13:18–19');
  });
});
