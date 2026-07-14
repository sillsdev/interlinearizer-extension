/** @file Unit tests for utils/segment-labels.ts. */
/// <reference types="jest" />

import type { Segment } from 'interlinearizer';
import { buildSegmentLabels } from '../../utils/segment-labels';

/**
 * Builds a minimal token-less {@link Segment} covering the given verses. Label derivation reads the
 * `verseStarts` covered-verse set, so `covered` enumerates each covered verse as a `[chapter,
 * verse]` pair; `startRef`/`endRef` are set from the first and last covered verse for completeness
 * but are not consulted by the labeler.
 *
 * @param id - The segment id.
 * @param covered - The verses the segment covers, in document order, as `[chapter, verse]` pairs.
 * @returns The assembled segment.
 */
function makeSegment(id: string, covered: [number, number][]): Segment {
  const [startChapter, startVerse] = covered[0];
  const [endChapter, endVerse] = covered[covered.length - 1];
  return {
    id,
    startRef: { book: 'GEN', chapter: startChapter, verse: startVerse },
    endRef: { book: 'GEN', chapter: endChapter, verse: endVerse },
    baselineText: '',
    tokens: [],
    verseStarts: covered.map(([chapter, verse]) => ({
      charStart: 0,
      number: String(verse),
      chapter,
    })),
  };
}

describe('buildSegmentLabels', () => {
  it('labels default single-verse segments with their bare verse numbers', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', [[1, 1]]),
      makeSegment('s2', [[1, 2]]),
      makeSegment('s3', [[1, 3]]),
    ]);

    expect(labels.get('s1')).toBe('1');
    expect(labels.get('s2')).toBe('2');
    expect(labels.get('s3')).toBe('3');
  });

  it('shows a merged multi-verse segment as the covered verse range', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', [[1, 1]]),
      makeSegment('merged', [
        [1, 2],
        [1, 3],
      ]),
      makeSegment('s4', [[1, 4]]),
    ]);

    expect(labels.get('merged')).toBe('2–3');
  });

  it('qualifies the end chapter of a chapter-crossing segment', () => {
    // A merge that folds chapter 1's tail into chapter 2's opening covers 1:29 and 2:1; the end is
    // qualified with its chapter so the range reads 29–2:1, not an ambiguous 29–1.
    const labels = buildSegmentLabels([
      makeSegment('crossing', [
        [1, 29],
        [2, 1],
      ]),
    ]);

    expect(labels.get('crossing')).toBe('29–2:1');
  });

  it('labels every portion of a split verse with the bare verse number, not lettered portions', () => {
    // Verse 1 is split into three pieces; each covers only verse 1, so each reads a bare `1`. The
    // gutter reflects the overlapping verse range rather than inventing per-portion identity — two
    // adjacent portions of verse 1 both reading `1` is the intended behavior (the inline verse
    // superscripts, not the gutter, distinguish the pieces).
    const labels = buildSegmentLabels([
      makeSegment('p1', [[1, 1]]),
      {
        ...makeSegment('p2', [[1, 1]]),
        verseStarts: [{ charStart: 0, number: '1', chapter: 1, isContinuation: true }],
      },
      {
        ...makeSegment('p3', [[1, 1]]),
        verseStarts: [{ charStart: 0, number: '1', chapter: 1, isContinuation: true }],
      },
      makeSegment('s2', [[1, 2]]),
    ]);

    expect(labels.get('p1')).toBe('1');
    expect(labels.get('p2')).toBe('1');
    expect(labels.get('p3')).toBe('1');
    expect(labels.get('s2')).toBe('2');
  });

  it('labels a verse-0 superscription segment as 0', () => {
    const labels = buildSegmentLabels([makeSegment('sup', [[3, 0]]), makeSegment('v1', [[3, 1]])]);

    expect(labels.get('sup')).toBe('0');
  });

  it('ranges a split portion that also spans into a following verse without lettering it', () => {
    // Verse 5 is split; its second portion is then merged with verse 6. The first piece covers only
    // verse 5 (bare `5`); the second covers verses 5 and 6 (range `5–6`). No portion letters.
    const labels = buildSegmentLabels([
      makeSegment('p1', [[1, 5]]),
      makeSegment('p2', [
        [1, 5],
        [1, 6],
      ]),
    ]);

    expect(labels.get('p1')).toBe('5');
    expect(labels.get('p2')).toBe('5–6');
  });

  it('ranges to the bare end verse even when that verse is split across segments', () => {
    // Verse 6 is split; the first segment covers verse 5 plus verse 6's first portion (range `5–6`),
    // the second covers verse 6's remaining portion (bare `6`). No portion letters on either end.
    const labels = buildSegmentLabels([
      makeSegment('r1', [
        [1, 5],
        [1, 6],
      ]),
      makeSegment('r2', [[1, 6]]),
    ]);

    expect(labels.get('r1')).toBe('5–6');
    expect(labels.get('r2')).toBe('6');
  });
});
