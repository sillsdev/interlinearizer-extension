/// <reference types="jest" />

import { makePunctToken, makeSegment, makeWordToken } from '../test-helpers';
import {
  buildHeightTable,
  heightForRows,
  offsetOfSegment,
  predictLineCount,
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
  showVerseGutter: false,
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
    expect(predictLineCount('', 300)).toBe(1);
  });

  it('keeps text that exactly fills the wrap width on one line', () => {
    expect(predictLineCount('a'.repeat(100), 840)).toBe(1);
  });

  it('wraps when the text runs past the wrap width', () => {
    expect(predictLineCount('a'.repeat(101), 840)).toBe(2);
  });
});

describe('heightForRows', () => {
  it('measures a one-row segment with morphology shown', () => {
    expect(heightForRows(1, CONFIG, 0)).toBe(132);
  });

  it('measures a two-row segment with morphology shown', () => {
    expect(heightForRows(2, CONFIG, 0)).toBe(256);
  });

  it('measures a one-row segment with morphology hidden', () => {
    expect(heightForRows(1, { ...CONFIG, showMorphology: false }, 0)).toBe(90);
  });

  it('measures a two-row segment with morphology hidden', () => {
    expect(heightForRows(2, { ...CONFIG, showMorphology: false }, 0)).toBe(172);
  });

  it('adds the free-translation row to a one-row segment', () => {
    expect(heightForRows(1, { ...CONFIG, showFreeTranslation: true }, 0)).toBe(166);
  });

  it('adds the free-translation row to a two-row segment', () => {
    expect(heightForRows(2, { ...CONFIG, showFreeTranslation: true }, 0)).toBe(290);
  });

  it('measures a one-line segment in baseline-text mode', () => {
    expect(heightForRows(1, { ...CONFIG, displayMode: 'baseline-text' }, 0)).toBe(38);
  });

  it('measures a two-line segment in baseline-text mode', () => {
    expect(heightForRows(2, { ...CONFIG, displayMode: 'baseline-text' }, 0)).toBe(58);
  });

  it('adds the free-translation row in baseline-text mode too', () => {
    expect(
      heightForRows(1, { ...CONFIG, displayMode: 'baseline-text', showFreeTranslation: true }, 0),
    ).toBe(72);
  });
});

describe('predictSegmentHeights', () => {
  it('predicts a one-row height for a segment whose chips fit the wrap width', () => {
    const segment = makeSegment('PSA 1:1', 'a b', [
      makeWordToken('PSA 1:1:0', 'a'),
      makeWordToken('PSA 1:1:1', 'b'),
    ]);
    expect(predictSegmentHeights([segment], CONFIG, 300)).toEqual([132]);
  });

  it('charges a taller height to a segment whose chips wrap', () => {
    const segment = makeSegment(
      'PSA 1:1',
      'a b c d',
      ['a', 'b', 'c', 'd'].map((t, i) => makeWordToken(`PSA 1:1:${i}`, t)),
    );
    expect(predictSegmentHeights([segment], CONFIG, 300)).toEqual([256]);
  });

  it('excludes punctuation tokens, which render inside a chip rather than as one', () => {
    // Three words and three punctuation marks fit the width only if the marks are not chips.
    const segment = makeSegment('PSA 1:1', 'a, b, c,', [
      makeWordToken('PSA 1:1:0', 'a'),
      makePunctToken('PSA 1:1:1', ','),
      makeWordToken('PSA 1:1:2', 'b'),
      makePunctToken('PSA 1:1:3', ','),
      makeWordToken('PSA 1:1:4', 'c'),
      makePunctToken('PSA 1:1:5', ','),
    ]);
    expect(predictSegmentHeights([segment], CONFIG, 300)).toEqual([132]);
  });

  it('counts wrapped text lines, not chip rows, in baseline-text mode', () => {
    // One word token, but a baseline text too long for one line of the wrap width.
    const segment = makeSegment('PSA 1:1', 'a'.repeat(50), [makeWordToken('PSA 1:1:0', 'a')]);
    expect(
      predictSegmentHeights([segment], { ...CONFIG, displayMode: 'baseline-text' }, 300),
    ).toEqual([58]);
  });

  it('predicts every segment in document order', () => {
    const segments = [
      makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]),
      makeSegment(
        'PSA 1:2',
        'a b c d',
        ['a', 'b', 'c', 'd'].map((t, i) => makeWordToken(`PSA 1:2:${i}`, t)),
      ),
    ];
    expect(predictSegmentHeights(segments, CONFIG, 300)).toEqual([132, 256]);
  });

  it('charges the free-translation row only to the segments the view renders one for', () => {
    const segments = [
      makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]),
      makeSegment('PSA 1:2', 'b', [makeWordToken('PSA 1:2:0', 'b')]),
    ];
    const config = {
      ...CONFIG,
      showFreeTranslation: true,
      hasFreeTranslation: (index: number) => index === 1,
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
    expect(buildHeightTable(CONFIG, [])).toEqual({ heights: [], offsets: [0], total: 0 });
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

  it('reports a total that spans every gap between segments', () => {
    const table = buildHeightTable({ ...CONFIG, segmentGapPx: 8 }, [100, 100, 100]);
    expect(table.total).toBe(316);
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
