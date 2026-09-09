/// <reference types="jest" />

import type { SegmentationDelta } from 'interlinearizer';
import {
  addBoundaryBefore,
  defaultVerseStarts,
  effectiveStarts,
  isDefaultSegmentation,
  isDefaultSegmentationForBook,
  lostAnchors,
  mergeSegments,
  moveBoundary,
  removeBoundaryAt,
  splitSegmentBefore,
} from '../../utils/segmentation';
import { makeVerseBook } from '../test-helpers';

/** A three-verse fixture: "Alpha beta." / "Gamma delta." / "Epsilon." */
const THREE_VERSES = makeVerseBook([
  { sid: 'GEN 1:1', number: '1', text: 'Alpha beta.' },
  { sid: 'GEN 1:2', number: '2', text: 'Gamma delta.' },
  { sid: 'GEN 1:3', number: '3', text: 'Epsilon.' },
]);

// First token refs of each verse (charStart 0): "GEN 1:1:0", "GEN 1:2:0", "GEN 1:3:0".
const V1_START = 'GEN 1:1:0';
const V2_START = 'GEN 1:2:0';
const V3_START = 'GEN 1:3:0';
// Second word of verse 1 ("beta" at charStart 6).
const V1_BETA = 'GEN 1:1:6';

/**
 * A fixture with a mid-book verse-0 superscription: GEN 1:1, then GEN 2:0 (the superscription),
 * then GEN 2:1. Verse 0 is an ordinary segment for boundary editing (only the book-first lock
 * applies).
 */
const MID_VERSE_ZERO = makeVerseBook([
  { sid: 'GEN 1:1', number: '1', text: 'Alpha beta.' },
  { sid: 'GEN 2:0', number: '0', text: 'Sup tee.' },
  { sid: 'GEN 2:1', number: '1', text: 'Gamma.' },
]);
// Verse-0 start, an interior verse-0 word ("tee" at charStart 4), and the start of the verse right
// after verse 0.
const VZ0_START = 'GEN 2:0:0';
const VZ0_INTERIOR = 'GEN 2:0:4';
const VZ_NEXT_START = 'GEN 2:1:0';

/**
 * A fixture whose middle verse carries no token (an empty verse marker), leaving verse 3 with no
 * preceding token run to be merged into.
 */
const EMPTY_MIDDLE_VERSE = makeVerseBook([
  { sid: 'GEN 1:1', number: '1', text: 'Alpha beta.' },
  { sid: 'GEN 1:2', number: '2', text: '   ' },
  { sid: 'GEN 1:3', number: '3', text: 'Epsilon.' },
]);

/** The same, with the token-less verse opening the book, so verse 2 begins the first token run. */
const EMPTY_FIRST_VERSE = makeVerseBook([
  { sid: 'GEN 1:1', number: '1', text: '   ' },
  { sid: 'GEN 1:2', number: '2', text: 'Gamma delta.' },
  { sid: 'GEN 1:3', number: '3', text: 'Epsilon.' },
]);

describe('defaultVerseStarts', () => {
  it('returns the first-token ref of every verse', () => {
    expect(defaultVerseStarts(THREE_VERSES)).toEqual(new Set([V1_START, V2_START, V3_START]));
  });

  it('skips verses with no tokens', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', number: '1', text: '   ' },
      { sid: 'GEN 1:2', number: '2', text: 'Word.' },
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

describe('isDefaultSegmentationForBook', () => {
  it('is true for undefined', () => {
    expect(isDefaultSegmentationForBook(THREE_VERSES, undefined)).toBe(true);
  });

  it('is true when every anchor names another book', () => {
    expect(
      isDefaultSegmentationForBook(THREE_VERSES, {
        removedVerseStarts: ['EXO 1:5:0'],
        addedStarts: ['EXO 1:1:6'],
      }),
    ).toBe(true);
  });

  it('is false when this book has a removed boundary', () => {
    expect(
      isDefaultSegmentationForBook(THREE_VERSES, {
        removedVerseStarts: [V2_START],
        addedStarts: ['EXO 1:1:6'],
      }),
    ).toBe(false);
  });

  it('is false when this book has an added boundary', () => {
    expect(
      isDefaultSegmentationForBook(THREE_VERSES, {
        removedVerseStarts: ['EXO 1:5:0'],
        addedStarts: [V1_BETA],
      }),
    ).toBe(false);
  });
});

describe('lostAnchors', () => {
  it('is empty for undefined', () => {
    expect(lostAnchors(THREE_VERSES, undefined)).toEqual([]);
  });

  it('is empty when every anchor still names a token', () => {
    const delta: SegmentationDelta = { removedVerseStarts: [V2_START], addedStarts: [V1_BETA] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual([]);
  });

  it('reports a removed verse start whose token is gone', () => {
    const delta: SegmentationDelta = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual(['GEN 1:9:0']);
  });

  it('reports an added start whose char offset no longer exists', () => {
    const delta: SegmentationDelta = { removedVerseStarts: [], addedStarts: ['GEN 1:1:99'] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual(['GEN 1:1:99']);
  });

  it('reports losses from both arrays, keeping the surviving anchors out', () => {
    const delta: SegmentationDelta = {
      removedVerseStarts: [V2_START, 'GEN 1:9:0'],
      addedStarts: [V1_BETA, 'GEN 1:1:99'],
    };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual(['GEN 1:9:0', 'GEN 1:1:99']);
  });

  it('ignores anchors naming a book other than the one loaded', () => {
    // One delta spans the whole draft, so a boundary set in Exodus is intact, not lost.
    const delta: SegmentationDelta = {
      removedVerseStarts: ['EXO 1:5:0'],
      addedStarts: ['EXO 1:1:6'],
    };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual([]);
  });

  it('still reports this book’s losses when another book’s anchors are present', () => {
    const delta: SegmentationDelta = {
      removedVerseStarts: ['EXO 1:5:0', 'GEN 1:9:0'],
      addedStarts: ['EXO 1:1:6'],
    };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual(['GEN 1:9:0']);
  });

  it('reports a removed start whose token survived but no longer begins a verse', () => {
    // A mid-verse ref leaves the merge nothing to remove, the drifted source having moved the
    // verse start off it.
    const delta: SegmentationDelta = { removedVerseStarts: [V1_BETA], addedStarts: [] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual([V1_BETA]);
  });

  it('reports an added start whose token has become a verse’s own first token', () => {
    const delta: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V2_START] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual([V2_START]);
  });

  it('reports a merge that drift turned into the book’s first token', () => {
    // Verse 1 has gone missing upstream, leaving the merged-away start of verse 2 to begin the book.
    const droppedFirstVerse = makeVerseBook([
      { sid: 'GEN 1:2', number: '2', text: 'Gamma delta.' },
      { sid: 'GEN 1:3', number: '3', text: 'Epsilon.' },
    ]);
    const delta: SegmentationDelta = { removedVerseStarts: [V2_START], addedStarts: [] };
    expect(effectiveStarts(droppedFirstVerse, delta).has(V2_START)).toBe(true);
    expect(lostAnchors(droppedFirstVerse, delta)).toEqual([V2_START]);
  });

  it('reports a removed start that drift left on the book’s first token', () => {
    // No edit records this anchor, so its presence means earlier source text went missing.
    const delta: SegmentationDelta = { removedVerseStarts: [V1_START], addedStarts: [] };
    expect(lostAnchors(THREE_VERSES, delta)).toEqual([V1_START]);
  });

  it('reports a merge whose preceding verse drift left token-less', () => {
    const delta: SegmentationDelta = { removedVerseStarts: [V3_START], addedStarts: [] };
    expect(lostAnchors(EMPTY_MIDDLE_VERSE, delta)).toEqual([V3_START]);
  });

  it('reports a merge into a token-less verse that opens the book', () => {
    const delta: SegmentationDelta = { removedVerseStarts: [V2_START], addedStarts: [] };
    expect(lostAnchors(EMPTY_FIRST_VERSE, delta)).toEqual([V2_START]);
  });

  it('keeps reporting nothing for a merge whose preceding verse still has tokens', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', number: '1', text: 'Alpha beta.' },
      { sid: 'GEN 1:2', number: '2', text: '   ' },
      { sid: 'GEN 1:3', number: '3', text: 'Epsilon here.' },
      { sid: 'GEN 1:4', number: '4', text: 'Zeta.' },
    ]);
    const delta: SegmentationDelta = { removedVerseStarts: ['GEN 1:4:0'], addedStarts: [] };
    expect(lostAnchors(book, delta)).toEqual([]);
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

  it('keeps a start whose preceding verse is token-less, matching resegmentBook', () => {
    const starts = effectiveStarts(EMPTY_MIDDLE_VERSE, {
      removedVerseStarts: [V3_START],
      addedStarts: [],
    });
    expect(starts.has(V3_START)).toBe(true);
  });

  it('keeps the first token-bearing start when a token-less verse opens the book', () => {
    const starts = effectiveStarts(EMPTY_FIRST_VERSE, {
      removedVerseStarts: [V2_START],
      addedStarts: [],
    });
    expect(starts.has(V2_START)).toBe(true);
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

  it('splits inside a verse-0 superscription like any other verse', () => {
    expect(addBoundaryBefore(MID_VERSE_ZERO, undefined, VZ0_INTERIOR)).toEqual({
      removedVerseStarts: [],
      addedStarts: [VZ0_INTERIOR],
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

  it('merges a verse-0 superscription into the previous segment like any verse start', () => {
    expect(removeBoundaryAt(MID_VERSE_ZERO, undefined, VZ0_START)).toEqual({
      removedVerseStarts: [VZ0_START],
      addedStarts: [],
    });
  });

  it('merges the verse after a verse-0 superscription into it like any verse start', () => {
    expect(removeBoundaryAt(MID_VERSE_ZERO, undefined, VZ_NEXT_START)).toEqual({
      removedVerseStarts: [VZ_NEXT_START],
      addedStarts: [],
    });
  });

  it('is a no-op for a start whose preceding verse carries no token', () => {
    // Recording the removal would store an anchor lostAnchors immediately reports as lost.
    expect(removeBoundaryAt(EMPTY_MIDDLE_VERSE, undefined, V3_START)).toEqual({
      removedVerseStarts: [],
      addedStarts: [],
    });
  });

  it('is a no-op for the first token-bearing start when a token-less verse opens the book', () => {
    expect(removeBoundaryAt(EMPTY_FIRST_VERSE, undefined, V2_START)).toEqual({
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

  it('moves a boundary across a verse-0 superscription like any other segment', () => {
    expect(moveBoundary(MID_VERSE_ZERO, undefined, VZ_NEXT_START, VZ0_INTERIOR)).toEqual({
      removedVerseStarts: [VZ_NEXT_START],
      addedStarts: [VZ0_INTERIOR],
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

  it('keeps a removed ref whose token drifted off a verse start', () => {
    // V1_BETA is mid-verse, so this source honors no removal there, but its token is still present.
    const drifted: SegmentationDelta = { removedVerseStarts: [V1_BETA], addedStarts: [] };
    expect(removeBoundaryAt(THREE_VERSES, drifted, V3_START)).toEqual({
      removedVerseStarts: [V3_START, V1_BETA],
      addedStarts: [],
    });
  });

  it('keeps an added ref whose token drifted onto a default verse start', () => {
    const drifted: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V2_START] };
    expect(addBoundaryBefore(THREE_VERSES, drifted, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA, V2_START],
    });
  });

  it('keeps a removed ref that drift left on the book’s first token', () => {
    // The merge returns if the missing earlier text does, so the anchor outlives the edit.
    const drifted: SegmentationDelta = { removedVerseStarts: [V1_START], addedStarts: [] };
    expect(removeBoundaryAt(THREE_VERSES, drifted, V3_START)).toEqual({
      removedVerseStarts: [V3_START, V1_START],
      addedStarts: [],
    });
  });

  it('keeps another book’s added start when splitting in this one', () => {
    // One delta spans the draft, so an Exodus split must survive an edit made while Genesis is
    // loaded — its ref cannot resolve here, but that is absence of evidence, not a dead anchor.
    const withExodus: SegmentationDelta = { removedVerseStarts: [], addedStarts: ['EXO 1:1:6'] };
    expect(addBoundaryBefore(THREE_VERSES, withExodus, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA, 'EXO 1:1:6'],
    });
  });

  it('keeps another book’s removed verse start when merging in this one', () => {
    const withExodus: SegmentationDelta = { removedVerseStarts: ['EXO 1:5:0'], addedStarts: [] };
    expect(removeBoundaryAt(THREE_VERSES, withExodus, V2_START)).toEqual({
      removedVerseStarts: [V2_START, 'EXO 1:5:0'],
      addedStarts: [],
    });
  });

  it('keeps another book’s anchors when merging the book-first token is a no-op', () => {
    const withExodus: SegmentationDelta = {
      removedVerseStarts: ['EXO 1:5:0'],
      addedStarts: ['EXO 1:1:6'],
    };
    expect(removeBoundaryAt(THREE_VERSES, withExodus, V1_START)).toEqual(withExodus);
  });

  it('sorts other books’ anchors by book code, whichever book is loaded', () => {
    // Grouping the foreign tail keeps serialization independent of which book the last edit was
    // made in; within a book the encounter order stands, there being no token stream to sort by.
    const foreign: SegmentationDelta = {
      removedVerseStarts: ['REV 1:1:0', 'EXO 1:5:0', 'EXO 1:2:0', 'LEV 1:1:0'],
      addedStarts: [],
    };
    expect(removeBoundaryAt(THREE_VERSES, foreign, V2_START)).toEqual({
      removedVerseStarts: [V2_START, 'EXO 1:5:0', 'EXO 1:2:0', 'LEV 1:1:0', 'REV 1:1:0'],
      addedStarts: [],
    });
  });

  it('keeps this book’s drift-hidden added start through an unrelated split', () => {
    // A ref this source cannot resolve: unhonored for now, but recoverable if the source reverts.
    const hidden: SegmentationDelta = { removedVerseStarts: [], addedStarts: ['GEN 1:1:99'] };
    expect(addBoundaryBefore(THREE_VERSES, hidden, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA, 'GEN 1:1:99'],
    });
  });

  it('keeps this book’s drift-hidden removed start through an unrelated merge', () => {
    const hidden: SegmentationDelta = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
    expect(removeBoundaryAt(THREE_VERSES, hidden, V2_START)).toEqual({
      removedVerseStarts: [V2_START, 'GEN 1:9:0'],
      addedStarts: [],
    });
  });

  it('sorts drift-hidden anchors after the resolvable ones, before other books’', () => {
    const mixed: SegmentationDelta = {
      removedVerseStarts: ['EXO 1:5:0', 'GEN 1:9:0', V3_START],
      addedStarts: [],
    };
    expect(removeBoundaryAt(THREE_VERSES, mixed, V2_START)).toEqual({
      removedVerseStarts: [V2_START, V3_START, 'GEN 1:9:0', 'EXO 1:5:0'],
      addedStarts: [],
    });
  });

  it('keeps every anchor lostAnchors reports through an unrelated edit', () => {
    // The two must agree on which anchors drift has unhonored: an anchor reported as a recoverable
    // loss that a later edit deletes is not recoverable at all.
    const drifted: SegmentationDelta = {
      removedVerseStarts: [V1_START, V1_BETA, 'GEN 1:9:0'],
      addedStarts: [V2_START, 'GEN 1:1:99'],
    };
    const lost = lostAnchors(THREE_VERSES, drifted);
    expect(lost).toEqual([V1_START, V1_BETA, 'GEN 1:9:0', V2_START, 'GEN 1:1:99']);
    const after = addBoundaryBefore(THREE_VERSES, drifted, 'GEN 1:2:6');
    const survivors = [...after.removedVerseStarts, ...after.addedStarts];
    lost.forEach((ref) => expect(survivors).toContain(ref));
  });

  it('clears a drifted added start when merging at that same ref', () => {
    // Drift moved V2_START's token onto a verse start while an added split still names it.
    const drifted: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V2_START] };
    const merged = removeBoundaryAt(THREE_VERSES, drifted, V2_START);
    expect(merged).toEqual({ removedVerseStarts: [V2_START], addedStarts: [] });
    expect(effectiveStarts(THREE_VERSES, merged).has(V2_START)).toBe(false);
  });

  it('clears a drifted removed start when splitting at that same ref', () => {
    // The mirror case: a removal naming a ref that drift left mid-verse, un-done by a split there.
    const drifted: SegmentationDelta = { removedVerseStarts: [V1_BETA], addedStarts: [] };
    expect(addBoundaryBefore(THREE_VERSES, drifted, V1_BETA)).toEqual({
      removedVerseStarts: [],
      addedStarts: [V1_BETA],
    });
  });

  it('moves a boundary off a ref a drifted added start also names', () => {
    const drifted: SegmentationDelta = { removedVerseStarts: [], addedStarts: [V2_START] };
    const moved = moveBoundary(THREE_VERSES, drifted, V2_START, V1_BETA);
    expect(moved).toEqual({ removedVerseStarts: [V2_START], addedStarts: [V1_BETA] });
    expect(effectiveStarts(THREE_VERSES, moved).has(V2_START)).toBe(false);
  });

  it('still dedupes and sorts this book’s anchors alongside another book’s', () => {
    const messy: SegmentationDelta = {
      removedVerseStarts: ['EXO 1:5:0', V3_START, V2_START, V2_START],
      addedStarts: [],
    };
    expect(removeBoundaryAt(THREE_VERSES, messy, V2_START)).toEqual({
      removedVerseStarts: [V2_START, V3_START, 'EXO 1:5:0'],
      addedStarts: [],
    });
  });
});
