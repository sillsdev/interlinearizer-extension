/// <reference types="jest" />

import type { PageFailure } from '../../types/segment-pages';
import { failedRunsIn, groupRunsByFailure, runVerses } from '../../utils/page-failures';
import { makeSegment, outlineOf } from '../test-helpers';

const FAILED: PageFailure = { cause: 'app', isRetrying: false, failedAgain: false };
const UNREADABLE: PageFailure = { ...FAILED, cause: 'analysis' };

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
    expect(failedRunsIn(failingAt(2, 3), 10, 0, 5)).toStrictEqual([
      { start: 2, end: 4, failure: FAILED },
    ]);
  });

  it('reports a run that reaches past both edges of the range at its full length', () => {
    expect(failedRunsIn(failingAt(1, 2, 3, 4, 5), 10, 2, 4)).toStrictEqual([
      { start: 1, end: 6, failure: FAILED },
    ]);
  });

  it('stops a run at the end of the book', () => {
    expect(failedRunsIn(failingAt(8, 9), 10, 8, 9)).toStrictEqual([
      { start: 8, end: 10, failure: FAILED },
    ]);
  });

  it('finds each run apart', () => {
    expect(failedRunsIn(failingAt(1, 3, 4), 10, 0, 5)).toStrictEqual([
      { start: 1, end: 2, failure: FAILED },
      { start: 3, end: 5, failure: FAILED },
    ]);
  });

  it('ends a run where the next segment failed for another cause', () => {
    const failureAt = (index: number) => [FAILED, FAILED, UNREADABLE][index];

    expect(failedRunsIn(failureAt, 3, 0, 3)).toStrictEqual([
      { start: 0, end: 2, failure: FAILED },
      { start: 2, end: 3, failure: UNREADABLE },
    ]);
  });

  it('ends a run where the next segment is at another stage of retrying', () => {
    const retrying = { ...FAILED, isRetrying: true };
    const failureAt = (index: number) => [FAILED, retrying][index];

    expect(failedRunsIn(failureAt, 2, 0, 2)).toStrictEqual([
      { start: 0, end: 1, failure: FAILED },
      { start: 1, end: 2, failure: retrying },
    ]);
  });

  it('ends a run where the next segment failed again after a retry', () => {
    const again = { ...FAILED, failedAgain: true };
    const failureAt = (index: number) => [FAILED, again][index];

    expect(failedRunsIn(failureAt, 2, 0, 2)).toStrictEqual([
      { start: 0, end: 1, failure: FAILED },
      { start: 1, end: 2, failure: again },
    ]);
  });
});

describe('groupRunsByFailure', () => {
  it('gathers runs that failed alike, in the order their first runs come', () => {
    const first = { start: 0, end: 1, failure: UNREADABLE };
    const second = { start: 2, end: 3, failure: FAILED };
    const third = { start: 4, end: 5, failure: { ...UNREADABLE } };

    expect(groupRunsByFailure([first, second, third])).toStrictEqual([[first, third], [second]]);
  });

  it('finds no group among no runs', () => {
    expect(groupRunsByFailure([])).toStrictEqual([]);
  });
});

describe('runVerses', () => {
  const outline = outlineOf([
    makeSegment('JOS 13:18', 'one', []),
    makeSegment('JOS 13:19', 'two', []),
    makeSegment('JOS 14:1', 'three', []),
  ]);

  it('names the verse of a run of one segment', () => {
    expect(runVerses(outline, { start: 0, end: 1, failure: FAILED })).toBe('13:18');
  });

  it('names the first and last verse of a run within a chapter', () => {
    expect(runVerses(outline, { start: 0, end: 2, failure: FAILED })).toBe('13:18–19');
  });

  it('names the chapter of the last verse of a run that crosses into another chapter', () => {
    expect(runVerses(outline, { start: 0, end: 3, failure: FAILED })).toBe('13:18–14:1');
  });

  it('ends a run at the last verse that its last segment starts', () => {
    const merged = makeSegment('JOS 13:18', 'one two', []);
    const withMerge = outlineOf([
      {
        ...merged,
        verseStarts: [...merged.verseStarts, { charStart: 4, number: '19', chapter: 13 }],
      },
    ]);

    expect(runVerses(withMerge, { start: 0, end: 1, failure: FAILED })).toBe('13:18–19');
  });

  it('ends a run at the last verse of a bridged verse marker', () => {
    const bridged = makeSegment('JOS 13:18', 'one', []);
    const withBridge = outlineOf([
      { ...bridged, verseStarts: [{ charStart: 0, number: '18-20', chapter: 13 }] },
    ]);

    expect(runVerses(withBridge, { start: 0, end: 1, failure: FAILED })).toBe('13:18–20');
  });

  it('ends a run on a heading at the verse that the heading is filed under', () => {
    const withHeading = outlineOf([
      makeSegment('JOS 13:18', 'one', []),
      { ...makeSegment('JOS 13:19', 'Heading', []), verseStarts: [] },
    ]);

    expect(runVerses(withHeading, { start: 0, end: 2, failure: FAILED })).toBe('13:18–19');
  });
});
