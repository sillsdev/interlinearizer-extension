/** @file Unit tests for utils/segment-labels.ts. */
/// <reference types="jest" />

import type { Segment } from 'interlinearizer';
import { buildSegmentLabels } from '../../utils/segment-labels';

/**
 * Builds a minimal token-less {@link Segment} spanning the given verse coordinates. Label derivation
 * only reads `id`, `startRef`, and `endRef`, so tokens and baseline text stay empty.
 *
 * @param id - The segment id.
 * @param startChapter - Chapter of the segment's start.
 * @param startVerse - Verse of the segment's start.
 * @param endChapter - Chapter of the segment's end; defaults to `startChapter`.
 * @param endVerse - Verse of the segment's end; defaults to `startVerse`.
 * @returns The assembled segment.
 */
function makeSegment(
  id: string,
  startChapter: number,
  startVerse: number,
  endChapter: number = startChapter,
  endVerse: number = startVerse,
): Segment {
  return {
    id,
    startRef: { book: 'GEN', chapter: startChapter, verse: startVerse },
    endRef: { book: 'GEN', chapter: endChapter, verse: endVerse },
    baselineText: '',
    tokens: [],
  };
}

describe('buildSegmentLabels', () => {
  it('labels default verse segments with their bare verse numbers', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('s2', 1, 2),
      makeSegment('s3', 1, 3),
    ]);

    expect(labels.get('s1')).toBe('1');
    expect(labels.get('s2')).toBe('2');
    expect(labels.get('s3')).toBe('3');
  });

  it('labels a verse-0 superscription segment as 0', () => {
    const labels = buildSegmentLabels([makeSegment('s0', 1, 0), makeSegment('s1', 1, 1)]);

    expect(labels.get('s0')).toBe('0');
    expect(labels.get('s1')).toBe('1');
  });

  it('shows a merged segment as the contained verse range', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('merged', 1, 2, 1, 3),
      makeSegment('s4', 1, 4),
    ]);

    expect(labels.get('merged')).toBe('2–3');
    // Neighboring whole-verse segments keep their bare numbers.
    expect(labels.get('s4')).toBe('4');
  });

  it('letters the portions of a split verse in document order', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('split-a', 1, 2),
      makeSegment('split-b', 1, 2),
      makeSegment('s3', 1, 3),
    ]);

    expect(labels.get('split-a')).toBe('2a');
    expect(labels.get('split-b')).toBe('2b');
    // The verse after the split is unaffected.
    expect(labels.get('s3')).toBe('3');
  });

  it('letters only the split end of a range when a split portion is merged with following verses', () => {
    // Split verse 1 into three portions, the third merged with verse 2: 1a, 1b, 1c–2, 3.
    const labels = buildSegmentLabels([
      makeSegment('p1', 1, 1),
      makeSegment('p2', 1, 1),
      makeSegment('p3', 1, 1, 1, 2),
      makeSegment('s3', 1, 3),
    ]);

    expect(labels.get('p1')).toBe('1a');
    expect(labels.get('p2')).toBe('1b');
    expect(labels.get('p3')).toBe('1c–2');
    expect(labels.get('s3')).toBe('3');
  });

  it('letters a range end when the segment ends mid-verse', () => {
    // Verse 1 merged with the first portion of a split verse 2: 1–2a, then 2b.
    const labels = buildSegmentLabels([makeSegment('head', 1, 1, 1, 2), makeSegment('tail', 1, 2)]);

    expect(labels.get('head')).toBe('1–2a');
    expect(labels.get('tail')).toBe('2b');
  });

  it('qualifies the range end with its chapter when a segment crosses a chapter boundary', () => {
    const labels = buildSegmentLabels([
      makeSegment('c1s1', 1, 1),
      makeSegment('crossing', 1, 2, 2, 1),
      makeSegment('c2s2', 2, 2),
    ]);

    expect(labels.get('crossing')).toBe('2–2:1');
    expect(labels.get('c2s2')).toBe('2');
  });

  it('letters a chapter-crossing end when its verse is split', () => {
    const labels = buildSegmentLabels([
      makeSegment('crossing', 1, 29, 2, 1),
      makeSegment('tail', 2, 1),
    ]);

    expect(labels.get('crossing')).toBe('29–2:1a');
    expect(labels.get('tail')).toBe('1b');
  });

  it('continues lettering bijectively past z for a verse split into more than 26 portions', () => {
    const portions = Array.from({ length: 28 }, (_, i) => makeSegment(`p${i}`, 1, 1));
    const labels = buildSegmentLabels(portions);

    expect(labels.get('p0')).toBe('1a');
    expect(labels.get('p25')).toBe('1z');
    expect(labels.get('p26')).toBe('1aa');
    expect(labels.get('p27')).toBe('1ab');
  });
});
