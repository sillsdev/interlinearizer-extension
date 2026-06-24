/** @file Unit tests for the pure segmentation-delta transforms. */
/// <reference types="jest" />

import type { Book, SegmentationDelta } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import {
  addBoundaryBefore,
  defaultVerseStarts,
  effectiveStarts,
  isDefaultSegmentation,
  mergeSegments,
  moveBoundary,
  removeBoundaryAt,
  splitSegmentBefore,
} from '../../utils/segmentation';

/**
 * Builds a verse-tokenized GEN book from the given verses for use as the `verseBook` argument.
 *
 * @param verses - Verse SID + text pairs.
 * @returns The tokenized book.
 */
function makeBook(verses: { sid: string; text: string }[]): Book {
  return tokenizeBook({ bookCode: 'GEN', writingSystem: 'en', contentHash: 'h', verses });
}

/** A three-verse fixture: "Alpha beta." / "Gamma delta." / "Epsilon." */
const THREE_VERSES = makeBook([
  { sid: 'GEN 1:1', text: 'Alpha beta.' },
  { sid: 'GEN 1:2', text: 'Gamma delta.' },
  { sid: 'GEN 1:3', text: 'Epsilon.' },
]);

// First token refs of each verse (charStart 0): "GEN 1:1:0", "GEN 1:2:0", "GEN 1:3:0".
const V1_START = 'GEN 1:1:0';
const V2_START = 'GEN 1:2:0';
const V3_START = 'GEN 1:3:0';
// Second word of verse 1 ("beta" at charStart 6).
const V1_BETA = 'GEN 1:1:6';

/**
 * A fixture with a mid-book verse-0 superscription: GEN 1:1, then GEN 2:0 (the superscription),
 * then GEN 2:1. Verse 0 is deliberately not the book's first segment so its start-lock is distinct
 * from the always-present book-first lock.
 */
const MID_VERSE_ZERO = makeBook([
  { sid: 'GEN 1:1', text: 'Alpha beta.' },
  { sid: 'GEN 2:0', text: 'Sup tee.' },
  { sid: 'GEN 2:1', text: 'Gamma.' },
]);
// Verse-0 start, an interior verse-0 word ("tee" at charStart 4), and the start of the verse right
// after verse 0 — the three refs frozen by the verse-0 locks.
const VZ0_START = 'GEN 2:0:0';
const VZ0_INTERIOR = 'GEN 2:0:4';
const VZ_NEXT_START = 'GEN 2:1:0';

/**
 * A fixture whose final segment is a verse-0 superscription, so the superscription has no segment
 * after it. Exercises the after-boundary branch of the verse-0 lock when verse 0 ends the book.
 */
const TRAILING_VERSE_ZERO = makeBook([
  { sid: 'GEN 1:1', text: 'Alpha beta.' },
  { sid: 'GEN 2:0', text: 'Sup tee.' },
]);
// Start of the trailing verse-0 superscription.
const TVZ0_START = 'GEN 2:0:0';

describe('defaultVerseStarts', () => {
  it('returns the first-token ref of every verse', () => {
    expect(defaultVerseStarts(THREE_VERSES)).toEqual(new Set([V1_START, V2_START, V3_START]));
  });

  it('skips verses with no tokens', () => {
    const book = makeBook([
      { sid: 'GEN 1:1', text: '   ' },
      { sid: 'GEN 1:2', text: 'Word.' },
    ]);
    expect(defaultVerseStarts(book)).toEqual(new Set(['GEN 1:2:0']));
  });
});

describe('isDefaultSegmentation', () => {
  it('is true for undefined', () => {
    expect(isDefaultSegmentation(undefined)).toBe(true);
  });

  it('is true for empty arrays', () => {
    expect(isDefaultSegmentation({ removedVerseStarts: [], addedStarts: [] })).toBe(true);
  });

  it('is false when a boundary is removed', () => {
    expect(isDefaultSegmentation({ removedVerseStarts: [V2_START], addedStarts: [] })).toBe(false);
  });

  it('is false when a boundary is added', () => {
    expect(isDefaultSegmentation({ removedVerseStarts: [], addedStarts: [V1_BETA] })).toBe(false);
  });
});

describe('effectiveStarts', () => {
  it('returns all default verse starts for the default segmentation', () => {
    expect(effectiveStarts(THREE_VERSES, undefined)).toEqual(
      new Set([V1_START, V2_START, V3_START]),
    );
  });

  it('drops a removed verse start (merge)', () => {
    const starts = effectiveStarts(THREE_VERSES, {
      removedVerseStarts: [V2_START],
      addedStarts: [],
    });
    expect(starts).toEqual(new Set([V1_START, V3_START]));
  });

  it('adds a split start', () => {
    const starts = effectiveStarts(THREE_VERSES, {
      removedVerseStarts: [],
      addedStarts: [V1_BETA],
    });
    expect(starts).toEqual(new Set([V1_START, V1_BETA, V2_START, V3_START]));
  });

  it('ignores an added start whose token no longer exists (drift)', () => {
    const starts = effectiveStarts(THREE_VERSES, {
      removedVerseStarts: [],
      addedStarts: ['GEN 9:9:9'],
    });
    expect(starts).toEqual(new Set([V1_START, V2_START, V3_START]));
  });

  it('always keeps the book-first token as a start even if asked to remove it', () => {
    const starts = effectiveStarts(THREE_VERSES, {
      removedVerseStarts: [V1_START],
      addedStarts: [],
    });
    expect(starts.has(V1_START)).toBe(true);
  });
});

describe('addBoundaryBefore', () => {
  it('records a mid-verse split as an added start', () => {
    expect(addBoundaryBefore(THREE_VERSES, undefined, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA],
    });
  });

  it('un-merges a default verse start by dropping it from removedVerseStarts', () => {
    const merged: SegmentationDelta = { removedVerseStarts: [V2_START], addedStarts: [] };
    expect(addBoundaryBefore(THREE_VERSES, merged, V2_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is idempotent on an already-added start', () => {
    const once = addBoundaryBefore(THREE_VERSES, undefined, V1_BETA);
    expect(addBoundaryBefore(THREE_VERSES, once, V1_BETA)).toEqual(once);
  });

  it('is a no-op when splitting inside a verse-0 superscription (its tokens stay together)', () => {
    expect(addBoundaryBefore(MID_VERSE_ZERO, undefined, VZ0_INTERIOR)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });
});

describe('removeBoundaryAt', () => {
  it('records a default verse start as removed (merge)', () => {
    expect(removeBoundaryAt(THREE_VERSES, undefined, V2_START)).toEqual({
      removedVerseStarts: [V2_START],
      addedStarts: [],
    });
  });

  it('drops an added split rather than recording a removal', () => {
    const split: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V1_BETA] };
    expect(removeBoundaryAt(THREE_VERSES, split, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is a no-op for the book-first token', () => {
    expect(removeBoundaryAt(THREE_VERSES, undefined, V1_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is a no-op when removing the boundary before a verse-0 superscription (would join the previous chapter)', () => {
    expect(removeBoundaryAt(MID_VERSE_ZERO, undefined, VZ0_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is a no-op when removing the boundary after a verse-0 superscription (would sweep verse 0 forward)', () => {
    expect(removeBoundaryAt(MID_VERSE_ZERO, undefined, VZ_NEXT_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is a no-op when removing the boundary before a verse-0 superscription that ends the book', () => {
    expect(removeBoundaryAt(TRAILING_VERSE_ZERO, undefined, TVZ0_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });
});

describe('moveBoundary', () => {
  it('removes the old start and adds the new one', () => {
    expect(moveBoundary(THREE_VERSES, undefined, V2_START, V1_BETA)).toEqual({
      removedVerseStarts: [V2_START],
      addedStarts: [V1_BETA],
    });
  });

  it('is a no-op when both halves touch a verse-0 superscription', () => {
    // The after-superscription boundary can't be removed (it borders verse 0), and an interior
    // verse-0 token can't become a new start, so neither half of the move applies.
    expect(moveBoundary(MID_VERSE_ZERO, undefined, VZ_NEXT_START, VZ0_INTERIOR)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });
});

describe('mergeSegments / splitSegmentBefore aliases', () => {
  it('mergeSegments removes the second segment start', () => {
    expect(mergeSegments(THREE_VERSES, undefined, V2_START)).toEqual(
      removeBoundaryAt(THREE_VERSES, undefined, V2_START),
    );
  });

  it('splitSegmentBefore adds a start', () => {
    expect(splitSegmentBefore(THREE_VERSES, undefined, V1_BETA)).toEqual(
      addBoundaryBefore(THREE_VERSES, undefined, V1_BETA),
    );
  });
});

describe('normalization', () => {
  it('dedupes and sorts removed/added arrays by document order', () => {
    const messy: SegmentationDelta = {
      removedVerseStarts: [V3_START, V2_START, V2_START],
      addedStarts: [],
    };
    // Re-adding V1_BETA twice plus the messy removals exercises dedupe + sort.
    const result = addBoundaryBefore(
      THREE_VERSES,
      addBoundaryBefore(THREE_VERSES, messy, V1_BETA),
      V1_BETA,
    );
    expect(result).toEqual({ removedVerseStarts: [V2_START, V3_START], addedStarts: [V1_BETA] });
  });

  it('strips a removed ref that is not a default verse start', () => {
    const bogus: SegmentationDelta = { removedVerseStarts: [V1_BETA], addedStarts: [] };
    // V1_BETA is mid-verse, not a default start, so it is not a valid removal.
    expect(removeBoundaryAt(THREE_VERSES, bogus, V3_START)).toEqual({
      removedVerseStarts: [V3_START],
      addedStarts: [],
    });
  });

  it('strips an added ref that is actually a default verse start', () => {
    const bogus: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V2_START] };
    expect(addBoundaryBefore(THREE_VERSES, bogus, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA],
    });
  });
});
