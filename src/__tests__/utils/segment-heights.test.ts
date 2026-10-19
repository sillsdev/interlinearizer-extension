/// <reference types="jest" />

import {
  buildHeightTable,
  heightForRows,
  offsetOfSegment,
  predictLineCount,
  predictOrphanedCardHeights,
  predictRowCount,
  predictSegmentHeights,
  segmentIndexAtOffset,
} from '../../utils/segment-heights';

/**
 * Chip counts and wrap geometry measured in the running app (WEB, Psalms 1–2, 1872px panel, chips
 * with morphology), with the row count the browser actually laid out. These are the ground truth
 * the predictor has to reproduce.
 */
const MEASURED_SEGMENTS = [
  { id: 'PSA 1:1', chipCount: 27, actualRows: 2 },
  { id: 'PSA 1:2', chipCount: 15, actualRows: 1 },
  { id: 'PSA 1:3', chipCount: 30, actualRows: 2 },
  { id: 'PSA 1:4', chipCount: 15, actualRows: 1 },
  { id: 'PSA 1:5', chipCount: 17, actualRows: 1 },
  { id: 'PSA 1:6', chipCount: 16, actualRows: 1 },
  { id: 'PSA 2:1', chipCount: 12, actualRows: 1 },
  { id: 'PSA 2:2', chipCount: 21, actualRows: 2 },
  { id: 'PSA 2:3', chipCount: 11, actualRows: 1 },
];

/** Width of the box chips wrap inside, measured in the same session. */
const MEASURED_WRAP_WIDTH = 1782;

const CONFIG = {
  displayMode: 'token-chip',
  showMorphology: true,
  showFreeTranslation: false,
} as const;

describe('predictRowCount', () => {
  it.each(MEASURED_SEGMENTS)(
    'reproduces the browser row count for $id',
    ({ chipCount, actualRows }) => {
      expect(predictRowCount(chipCount, MEASURED_WRAP_WIDTH)).toBe(actualRows);
    },
  );

  it('keeps chips that exactly fill the wrap width on one row', () => {
    // Three 65px chips and two 32px gaps come to 259px.
    expect(predictRowCount(3, 259)).toBe(1);
  });

  it('wraps when the row would exceed the wrap width by a single pixel', () => {
    expect(predictRowCount(3, 258)).toBe(2);
  });

  it('reports one row for a segment with no chips', () => {
    expect(predictRowCount(0, 300)).toBe(1);
  });

  it('gives a chip wider than the wrap box its own row rather than looping', () => {
    expect(predictRowCount(3, 10)).toBe(3);
  });
});

describe('predictLineCount', () => {
  it('reports one line for empty text', () => {
    expect(predictLineCount(0, 300)).toBe(1);
  });

  it('keeps text that exactly fills the wrap width on one line', () => {
    expect(predictLineCount(100, 840)).toBe(1);
  });

  it('wraps when the text runs past the wrap width', () => {
    expect(predictLineCount(101, 840)).toBe(2);
  });
});

describe('heightForRows', () => {
  it('measures a one-row segment with morphology shown', () => {
    expect(heightForRows(1, CONFIG, 0, 300)).toBe(132);
  });

  it('measures a two-row segment with morphology shown', () => {
    expect(heightForRows(2, CONFIG, 0, 300)).toBe(256);
  });

  // Heights measured in Studio: mispredicting a row shifts the content under the reader as a
  // screenful hydrates, whichever direction the error runs in.
  it('measures a one-row segment with morphology hidden', () => {
    expect(heightForRows(1, { ...CONFIG, showMorphology: false }, 0, 300)).toBe(90);
  });

  it('measures a two-row segment with morphology hidden', () => {
    expect(heightForRows(2, { ...CONFIG, showMorphology: false }, 0, 300)).toBe(172);
  });

  it('adds the free-translation row to a one-row segment', () => {
    expect(heightForRows(1, { ...CONFIG, showFreeTranslation: true }, 0, 300)).toBe(166);
  });

  it('adds the free-translation row to a two-row segment', () => {
    expect(heightForRows(2, { ...CONFIG, showFreeTranslation: true }, 0, 300)).toBe(290);
  });

  it('measures a one-line segment in baseline-text mode', () => {
    expect(heightForRows(1, { ...CONFIG, displayMode: 'baseline-text' }, 0, 300)).toBe(38);
  });

  it('measures a two-line segment in baseline-text mode', () => {
    expect(heightForRows(2, { ...CONFIG, displayMode: 'baseline-text' }, 0, 300)).toBe(58);
  });

  it('charges one line for a read-only translation that fits the wrap width', () => {
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      freeTranslationText: () => 'a'.repeat(10),
    };
    expect(heightForRows(1, config, 0, 300)).toBe(166);
  });

  it('charges each wrapped line of a read-only translation that overflows the wrap width', () => {
    // Wraps onto three lines of the column.
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      freeTranslationText: () => 'a'.repeat(100),
    };
    expect(heightForRows(1, config, 0, 300)).toBe(206);
  });

  it('charges nothing for a segment the read-only view renders no translation for', () => {
    const config = { ...CONFIG, showFreeTranslation: true, freeTranslationText: () => undefined };
    expect(heightForRows(1, config, 0, 300)).toBe(132);
  });

  it('adds the stale translations a segment lists for review below its free translation', () => {
    const config = { ...CONFIG, showFreeTranslation: true, staleReviewTexts: () => ['A', 'B'] };
    expect(heightForRows(1, config, 0, 300)).toBe(166 + 20 + 2 * 32);
  });

  it('charges each wrapped line of a stale translation too long to share a row with its buttons', () => {
    // Wraps onto three lines of the column, with the buttons on a line below.
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      staleReviewTexts: () => ['a'.repeat(100)],
    };
    expect(heightForRows(1, config, 0, 300)).toBe(282);
  });

  it('moves the buttons below a stale translation that fits the column alone but not beside them', () => {
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      staleReviewTexts: () => ['a'.repeat(30)],
    };
    expect(heightForRows(1, config, 0, 300)).toBe(166 + 20 + 56);
  });

  it('keeps a stale translation beside Discard alone where the segment offers no Keep', () => {
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      staleReviewTexts: () => ['a'.repeat(30)],
      staleReviewOffersKeep: () => false,
    };
    expect(heightForRows(1, config, 0, 300)).toBe(166 + 20 + 32);
  });

  // Measured in the running app over WEB GEN 1:20, listing a short and a long English translation.
  it.each([
    { wrapWidth: 1808, measured: 128 },
    { wrapWidth: 904, measured: 148 },
  ])('reproduces the review measured at a $wrapWidth px column', ({ wrapWidth, measured }) => {
    const base = { ...CONFIG, showFreeTranslation: true };
    const withReview = { ...base, staleReviewTexts: () => ['a'.repeat(6), 'a'.repeat(342)] };
    expect(heightForRows(1, withReview, 0, wrapWidth) - heightForRows(1, base, 0, wrapWidth)).toBe(
      measured,
    );
  });

  it('charges no review for a segment listing no stale translation', () => {
    const config = { ...CONFIG, showFreeTranslation: true, staleReviewTexts: () => [] };
    expect(heightForRows(1, config, 0, 300)).toBe(166);
  });

  it('charges no review while the free translation is hidden', () => {
    const config = { ...CONFIG, staleReviewTexts: () => ['A', 'B'] };
    expect(heightForRows(1, config, 0, 300)).toBe(132);
  });

  it('adds the free-translation row in baseline-text mode too', () => {
    expect(
      heightForRows(
        1,
        { ...CONFIG, displayMode: 'baseline-text', showFreeTranslation: true },
        0,
        300,
      ),
    ).toBe(72);
  });
});

describe('predictSegmentHeights', () => {
  it('predicts a one-row height for a segment whose chips fit the wrap width', () => {
    expect(predictSegmentHeights([{ wordTokenCount: 2, textLength: 3 }], CONFIG, 300)).toEqual([
      132,
    ]);
  });

  it('charges a taller height to a segment whose chips wrap', () => {
    expect(predictSegmentHeights([{ wordTokenCount: 4, textLength: 7 }], CONFIG, 300)).toEqual([
      256,
    ]);
  });

  it('counts wrapped text lines, not chip rows, in baseline-text mode', () => {
    // One word token, but a baseline text too long for one line of the wrap width.
    expect(
      predictSegmentHeights(
        [{ wordTokenCount: 1, textLength: 50 }],
        { ...CONFIG, displayMode: 'baseline-text' },
        300,
      ),
    ).toEqual([58]);
  });

  it('predicts every segment in document order', () => {
    const segments = [
      { wordTokenCount: 1, textLength: 1 },
      { wordTokenCount: 4, textLength: 7 },
    ];
    expect(predictSegmentHeights(segments, CONFIG, 300)).toEqual([132, 256]);
  });

  it('charges the free-translation row only to the segments the view renders one for', () => {
    const segments = [
      { wordTokenCount: 1, textLength: 1 },
      { wordTokenCount: 1, textLength: 1 },
    ];
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      freeTranslationText: (index: number) => (index === 1 ? 'short' : undefined),
    };
    expect(predictSegmentHeights(segments, config, 300)).toEqual([132, 166]);
  });
});

describe('buildHeightTable', () => {
  it('gives every segment its predicted height', () => {
    const table = buildHeightTable(CONFIG, [100, 200, 300]);
    expect(table.heights).toEqual([100, 200, 300]);
  });

  it('accumulates offsets as the running top edge of each segment', () => {
    const table = buildHeightTable(CONFIG, [100, 200, 300]);
    expect(table.offsets).toEqual([0, 100, 300, 600]);
  });

  it('reports the summed height of every segment as the total', () => {
    const table = buildHeightTable(CONFIG, [100, 200, 300]);
    expect(table.total).toBe(600);
  });

  it('builds an empty table for a book with no segments', () => {
    expect(buildHeightTable(CONFIG, [])).toEqual({
      heights: [],
      boxHeights: [],
      offsets: [0],
      total: 0,
    });
  });

  it('adds the gap between segments to each height after the first', () => {
    const table = buildHeightTable({ ...CONFIG, segmentGapPx: 8 }, [100, 100, 100]);
    expect(table.heights).toEqual([100, 108, 108]);
  });

  it('adds the extra gap above only the segments that carry one', () => {
    const table = buildHeightTable(
      { ...CONFIG, segmentGapPx: 8, extraGapPx: (index) => (index === 2 ? 24 : 0) },
      [100, 100, 100],
    );
    expect(table.heights).toEqual([100, 108, 132]);
  });

  it('never charges an extra gap above the first segment', () => {
    const table = buildHeightTable({ ...CONFIG, extraGapPx: () => 24 }, [100, 100, 100]);
    expect(table.heights[0]).toBe(100);
  });

  it('adds the cards beside a segment to its height', () => {
    const table = buildHeightTable({ ...CONFIG, segmentGapPx: 8 }, [100, 100], [74, 0]);
    expect(table.heights).toEqual([174, 108]);
  });

  it("reports each segment's own box apart from its gap and the cards beside it", () => {
    const table = buildHeightTable({ ...CONFIG, segmentGapPx: 8 }, [100, 100], [74, 74]);
    expect(table.boxHeights).toEqual([100, 100]);
  });

  it('reports a total that spans every gap between segments', () => {
    const table = buildHeightTable({ ...CONFIG, segmentGapPx: 8 }, [100, 100, 100]);
    expect(table.total).toBe(316);
  });
});

describe('predictOrphanedCardHeights', () => {
  const withCards = { ...CONFIG, showFreeTranslation: true, segmentGapPx: 8 };

  it('charges nothing beside a segment showing no cards', () => {
    expect(predictOrphanedCardHeights(2, withCards)).toEqual([0, 0]);
  });

  it('charges each card its height and the gap beside it', () => {
    const config = { ...withCards, orphanedCardCount: () => 2 };

    expect(predictOrphanedCardHeights(1, config)).toEqual([2 * (8 + 66)]);
  });

  it('charges no gap beside a card where the config sets none', () => {
    const config = { ...CONFIG, showFreeTranslation: true, orphanedCardCount: () => 1 };

    expect(predictOrphanedCardHeights(1, config)).toEqual([66]);
  });

  it('charges only the segments showing cards', () => {
    const config = { ...withCards, orphanedCardCount: (index: number) => (index === 1 ? 1 : 0) };

    expect(predictOrphanedCardHeights(2, config)).toEqual([0, 8 + 66]);
  });

  it('charges nothing while free translations are hidden', () => {
    const config = { ...withCards, showFreeTranslation: false, orphanedCardCount: () => 1 };

    expect(predictOrphanedCardHeights(1, config)).toEqual([0]);
  });
});

describe('segmentIndexAtOffset', () => {
  function table() {
    return buildHeightTable(CONFIG, [132, 132, 132]);
  }

  it('resolves an offset inside a segment to that segment', () => {
    expect(segmentIndexAtOffset(table(), 200)).toBe(1);
  });

  it('resolves a segment top edge to that segment, not its predecessor', () => {
    expect(segmentIndexAtOffset(table(), 132)).toBe(1);
  });

  it('resolves offset zero to the first segment', () => {
    expect(segmentIndexAtOffset(table(), 0)).toBe(0);
  });

  it('clamps an offset past the end of the book to the last segment', () => {
    expect(segmentIndexAtOffset(table(), 10_000)).toBe(2);
  });

  it('clamps a negative offset to the first segment', () => {
    expect(segmentIndexAtOffset(table(), -50)).toBe(0);
  });

  it('round-trips every segment index through its own offset', () => {
    const built = table();
    built.heights.forEach((_height, index) => {
      expect(segmentIndexAtOffset(built, offsetOfSegment(built, index))).toBe(index);
    });
  });
});
