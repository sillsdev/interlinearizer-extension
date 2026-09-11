/// <reference types="jest" />

import { makePunctToken, makeSegment, makeWordToken } from '../test-helpers';
import {
  buildHeightTable,
  findHeightDrift,
  heightForRows,
  offsetOfSegment,
  predictRowCount,
  segmentIndexAtOffset,
} from '../../utils/segment-heights';

/**
 * Chip widths and wrap geometry measured in the running app (WEB, Psalms 1–2, 1872px panel, chips
 * with morphology). Each entry is one segment's chip widths in document order, with the row count
 * the browser actually laid out. These are the ground truth the predictor has to reproduce.
 */
const MEASURED_SEGMENTS = [
  { id: 'PSA 1:1', chipWidths: chipsOf(27, 1757.3), actualRows: 2 },
  { id: 'PSA 1:2', chipWidths: chipsOf(15, 996.8), actualRows: 1 },
  { id: 'PSA 1:3', chipWidths: chipsOf(30, 1960), actualRows: 2 },
  { id: 'PSA 1:4', chipWidths: chipsOf(15, 971.5), actualRows: 1 },
  { id: 'PSA 1:5', chipWidths: chipsOf(17, 1185.3), actualRows: 1 },
  { id: 'PSA 1:6', chipWidths: chipsOf(16, 1053.1), actualRows: 1 },
  { id: 'PSA 2:1', chipWidths: chipsOf(12, 777.3), actualRows: 1 },
  { id: 'PSA 2:2', chipWidths: chipsOf(21, 1377.1), actualRows: 2 },
  { id: 'PSA 2:3', chipWidths: chipsOf(11, 712.4), actualRows: 1 },
];

/** Width of the box chips wrap inside, measured in the same session. */
const MEASURED_WRAP_WIDTH = 1782;

/** Spreads a segment's measured total chip width evenly across its chip count. */
function chipsOf(count: number, totalWidth: number): number[] {
  return Array.from({ length: count }, () => totalWidth / count);
}

describe('predictRowCount', () => {
  it.each(MEASURED_SEGMENTS)(
    'reproduces the browser row count for $id',
    ({ chipWidths, actualRows }) => {
      expect(predictRowCount(chipWidths, MEASURED_WRAP_WIDTH)).toBe(actualRows);
    },
  );

  it('keeps chips that exactly fill the wrap width on one row', () => {
    // Two 100px chips plus one 32px gap is exactly 232.
    expect(predictRowCount([100, 100], 232)).toBe(1);
  });

  it('wraps when the row would exceed the wrap width by a single pixel', () => {
    expect(predictRowCount([100, 100], 231)).toBe(1 + 1);
  });

  it('charges no gap after the last chip on a row', () => {
    // The two chips plus the one gap between them come to exactly the wrap width.
    expect(predictRowCount([100, 68], 200)).toBe(1);
  });

  it('reports one row for a segment with no chips', () => {
    expect(predictRowCount([], MEASURED_WRAP_WIDTH)).toBe(1);
  });

  it('gives a chip wider than the wrap box its own row rather than looping', () => {
    expect(predictRowCount([50, 4000, 50], 200)).toBe(3);
  });
});

describe('heightForRows', () => {
  const chipMode = { displayMode: 'token-chip' } as const;

  it('measures a one-row segment with morphology shown', () => {
    expect(
      heightForRows(1, { ...chipMode, showMorphology: true, showFreeTranslation: false }),
    ).toBe(132);
  });

  it('measures a two-row segment with morphology shown', () => {
    expect(
      heightForRows(2, { ...chipMode, showMorphology: true, showFreeTranslation: false }),
    ).toBe(256);
  });

  it('measures a one-row segment with morphology hidden', () => {
    expect(
      heightForRows(1, { ...chipMode, showMorphology: false, showFreeTranslation: false }),
    ).toBe(90);
  });

  it('measures a two-row segment with morphology hidden', () => {
    expect(
      heightForRows(2, { ...chipMode, showMorphology: false, showFreeTranslation: false }),
    ).toBe(172);
  });

  it('adds the free-translation row to a one-row segment', () => {
    expect(heightForRows(1, { ...chipMode, showMorphology: true, showFreeTranslation: true })).toBe(
      166,
    );
  });

  it('adds the free-translation row to a two-row segment', () => {
    expect(heightForRows(2, { ...chipMode, showMorphology: true, showFreeTranslation: true })).toBe(
      290,
    );
  });

  it('is a flat height in baseline-text mode, whatever the row count', () => {
    const baseline = {
      displayMode: 'baseline-text',
      showMorphology: true,
      showFreeTranslation: false,
    } as const;
    expect(heightForRows(1, baseline)).toBe(72);
    expect(heightForRows(4, baseline)).toBe(72);
  });
});

describe('buildHeightTable', () => {
  const CONFIG = {
    displayMode: 'token-chip',
    showMorphology: true,
    showFreeTranslation: false,
  } as const;

  /** A uniform chip width leaves `wrapWidth` as the only thing deciding where rows break. */
  const measure = () => 100;

  /** Segments short enough that their chips fit one row of the wrap width used below. */
  function threeShortSegments() {
    return [
      makeSegment('PSA 1:1', 'a b', [
        makeWordToken('PSA 1:1:0', 'a'),
        makeWordToken('PSA 1:1:1', 'b'),
      ]),
      makeSegment('PSA 1:2', 'c d', [
        makeWordToken('PSA 1:2:0', 'c'),
        makeWordToken('PSA 1:2:1', 'd'),
      ]),
      makeSegment('PSA 1:3', 'e f', [
        makeWordToken('PSA 1:3:0', 'e'),
        makeWordToken('PSA 1:3:1', 'f'),
      ]),
    ];
  }

  it('gives every segment its predicted height', () => {
    const table = buildHeightTable(threeShortSegments(), CONFIG, 300, measure);
    expect(table.heights).toEqual([132, 132, 132]);
  });

  it('accumulates offsets as the running top edge of each segment', () => {
    const table = buildHeightTable(threeShortSegments(), CONFIG, 300, measure);
    expect(table.offsets).toEqual([0, 132, 264, 396]);
  });

  it('reports the summed height of every segment as the total', () => {
    const table = buildHeightTable(threeShortSegments(), CONFIG, 300, measure);
    expect(table.total).toBe(396);
  });

  it('charges a taller height to a segment whose chips wrap', () => {
    // Four 100px chips need 3 gaps: 496px, which wraps inside a 300px box.
    const wide = makeSegment('PSA 1:1', 'a b c d', [
      makeWordToken('PSA 1:1:0', 'a'),
      makeWordToken('PSA 1:1:1', 'b'),
      makeWordToken('PSA 1:1:2', 'c'),
      makeWordToken('PSA 1:1:3', 'd'),
    ]);
    const table = buildHeightTable([wide], CONFIG, 300, measure);
    expect(table.heights).toEqual([256]);
  });

  it('builds an empty table for a book with no segments', () => {
    const table = buildHeightTable([], CONFIG, 300, measure);
    expect(table).toEqual({ heights: [], offsets: [0], total: 0 });
  });

  it('adds the gap between segments to each height after the first', () => {
    const table = buildHeightTable(
      threeShortSegments(),
      { ...CONFIG, segmentGapPx: 32 },
      300,
      measure,
    );
    expect(table.heights).toEqual([132, 164, 164]);
  });

  it('counts no gap above a lone segment', () => {
    const [only] = threeShortSegments();
    const table = buildHeightTable([only], { ...CONFIG, segmentGapPx: 32 }, 300, measure);
    expect(table.total).toBe(132);
  });

  it('reports a total that spans every gap between segments', () => {
    const table = buildHeightTable(
      threeShortSegments(),
      { ...CONFIG, segmentGapPx: 32 },
      300,
      measure,
    );
    expect(table.total).toBe(132 * 3 + 32 * 2);
  });

  it('measures each distinct surface form once, however often it recurs', () => {
    const measureSpy = jest.fn(() => 100);
    const repeated = makeSegment('PSA 1:1', 'the the the', [
      makeWordToken('PSA 1:1:0', 'the'),
      makeWordToken('PSA 1:1:1', 'the'),
      makeWordToken('PSA 1:1:2', 'the'),
    ]);
    buildHeightTable([repeated], CONFIG, 1000, measureSpy);
    expect(measureSpy).toHaveBeenCalledTimes(1);
  });

  it('excludes punctuation tokens, which render inside a chip rather than as one', () => {
    const withPunct = makeSegment('PSA 1:1', 'a. b', [
      makeWordToken('PSA 1:1:0', 'a'),
      makePunctToken('PSA 1:1:1', '.'),
      makeWordToken('PSA 1:1:2', 'b'),
    ]);
    // The wrap width fits two chips on a row, but not three.
    const table = buildHeightTable([withPunct], CONFIG, 300, measure);
    expect(table.heights).toEqual([132]);
  });
});

describe('segmentIndexAtOffset', () => {
  const CONFIG = {
    displayMode: 'token-chip',
    showMorphology: true,
    showFreeTranslation: false,
  } as const;
  const measure = () => 100;

  /** Three single-row segments, so every segment in the table has the same height. */
  function table() {
    return buildHeightTable(
      [
        makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]),
        makeSegment('PSA 1:2', 'b', [makeWordToken('PSA 1:2:0', 'b')]),
        makeSegment('PSA 1:3', 'c', [makeWordToken('PSA 1:3:0', 'c')]),
      ],
      CONFIG,
      300,
      measure,
    );
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

describe('findHeightDrift', () => {
  const CONFIG = {
    displayMode: 'token-chip',
    showMorphology: true,
    showFreeTranslation: false,
  } as const;
  const measure = () => 100;

  /** A table of three single-row segments, each predicted at the same height. */
  function table() {
    return buildHeightTable(
      [
        makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]),
        makeSegment('PSA 1:2', 'b', [makeWordToken('PSA 1:2:0', 'b')]),
        makeSegment('PSA 1:3', 'c', [makeWordToken('PSA 1:3:0', 'c')]),
      ],
      CONFIG,
      300,
      measure,
    );
  }

  it('finds nothing when every measured height matches its prediction', () => {
    const built = table();
    const measured = new Map([
      [0, built.heights[0]],
      [1, built.heights[1]],
    ]);
    expect(findHeightDrift(built, measured)).toEqual([]);
  });

  it('reports a segment whose measured height differs from its prediction', () => {
    const built = table();
    const measured = new Map([[1, built.heights[1] + 40]]);
    expect(findHeightDrift(built, measured)).toEqual([
      { index: 1, predicted: built.heights[1], actual: built.heights[1] + 40 },
    ]);
  });

  it('tolerates a sub-pixel difference, which rounding alone can produce', () => {
    const built = table();
    const measured = new Map([[0, built.heights[0] + 0.4]]);
    expect(findHeightDrift(built, measured)).toEqual([]);
  });

  it('ignores an index the table does not cover', () => {
    expect(findHeightDrift(table(), new Map([[99, 500]]))).toEqual([]);
  });
});
