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
  it('numbers default verse segments sequentially with single-verse ranges', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('s2', 1, 2),
      makeSegment('s3', 1, 3),
    ]);

    expect(labels.get('s1')).toEqual({ ordinal: 1, verseRange: '1' });
    expect(labels.get('s2')).toEqual({ ordinal: 2, verseRange: '2' });
    expect(labels.get('s3')).toEqual({ ordinal: 3, verseRange: '3' });
  });

  it('starts a chapter at 0 when its first segment is a verse-0 superscription', () => {
    const labels = buildSegmentLabels([makeSegment('s0', 1, 0), makeSegment('s1', 1, 1)]);

    expect(labels.get('s0')).toEqual({ ordinal: 0, verseRange: '0' });
    expect(labels.get('s1')).toEqual({ ordinal: 1, verseRange: '1' });
  });

  it('restarts numbering at each chapter', () => {
    const labels = buildSegmentLabels([
      makeSegment('c1s1', 1, 1),
      makeSegment('c1s2', 1, 2),
      makeSegment('c2s1', 2, 1),
    ]);

    expect(labels.get('c1s2')?.ordinal).toBe(2);
    expect(labels.get('c2s1')).toEqual({ ordinal: 1, verseRange: '1' });
  });

  it('shows a merged segment as one number with the contained verse range', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('merged', 1, 2, 1, 3),
      makeSegment('s4', 1, 4),
    ]);

    expect(labels.get('merged')).toEqual({ ordinal: 2, verseRange: '2–3' });
    // The following segment keeps counting segments, not verses.
    expect(labels.get('s4')).toEqual({ ordinal: 3, verseRange: '4' });
  });

  it('numbers split pieces of one verse as separate segments sharing the verse range', () => {
    const labels = buildSegmentLabels([
      makeSegment('s1', 1, 1),
      makeSegment('split-a', 1, 2),
      makeSegment('split-b', 1, 2),
    ]);

    expect(labels.get('split-a')).toEqual({ ordinal: 2, verseRange: '2' });
    expect(labels.get('split-b')).toEqual({ ordinal: 3, verseRange: '2' });
  });

  it('qualifies the range end with its chapter when a segment crosses a chapter boundary', () => {
    const labels = buildSegmentLabels([
      makeSegment('c1s1', 1, 1),
      makeSegment('crossing', 1, 2, 2, 1),
      makeSegment('c2s2', 2, 2),
    ]);

    expect(labels.get('crossing')).toEqual({ ordinal: 2, verseRange: '2–2:1' });
    // The crossing segment belongs to the chapter it starts in; the next chapter restarts at 1.
    expect(labels.get('c2s2')).toEqual({ ordinal: 1, verseRange: '2' });
  });
});
