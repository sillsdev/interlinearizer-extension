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

  it('leaves a leading oversized chip overflowing the first row rather than opening one above it', () => {
    expect(predictRowCount([4000, 50], 200)).toBe(2);
  });
});

/** Baseline-text mode, whose height tracks wrapped text lines rather than chip rows. */
const BASELINE = {
  displayMode: 'baseline-text',
  showMorphology: true,
  showFreeTranslation: false,
  showVerseGutter: false,
} as const;

describe('heightForRows', () => {
  const chipMode = { displayMode: 'token-chip', showVerseGutter: false } as const;

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

  it('charges no free-translation row to a segment that renders none', () => {
    // The read-only view omits the field entirely for a segment with no translation.
    const config = {
      ...chipMode,
      showMorphology: true,
      showFreeTranslation: true,
      hasFreeTranslation: () => false,
    };
    expect(heightForRows(1, config, 0)).toBe(132);
  });

  it('charges the free-translation row to a segment that renders one', () => {
    const config = {
      ...chipMode,
      showMorphology: true,
      showFreeTranslation: true,
      hasFreeTranslation: () => true,
    };
    expect(heightForRows(1, config, 0)).toBe(166);
  });

  it('charges every segment when asked without naming one', () => {
    // A caller measuring the allowances in general, rather than a particular segment's.
    const config = {
      ...chipMode,
      showMorphology: true,
      showFreeTranslation: true,
      hasFreeTranslation: () => false,
    };
    expect(heightForRows(1, config)).toBe(166);
  });

  it('measures a one-line segment in baseline-text mode', () => {
    expect(heightForRows(1, BASELINE)).toBe(38);
  });

  it('measures a two-line segment in baseline-text mode', () => {
    expect(heightForRows(2, BASELINE)).toBe(58);
  });

  it('measures a three-line segment in baseline-text mode', () => {
    expect(heightForRows(3, BASELINE)).toBe(78);
  });

  it('adds the free-translation row in baseline-text mode too', () => {
    // Baseline mode renders the same free-translation field beneath its text as token-chip mode.
    expect(heightForRows(1, { ...BASELINE, showFreeTranslation: true })).toBe(38 + 34);
  });

  it('charges the same free-translation allowance in both display modes', () => {
    const allowance = (displayMode: 'token-chip' | 'baseline-text') =>
      heightForRows(1, { ...BASELINE, displayMode, showFreeTranslation: true }) -
      heightForRows(1, { ...BASELINE, displayMode, showFreeTranslation: false });
    expect(allowance('baseline-text')).toBe(allowance('token-chip'));
  });
});

describe('buildHeightTable', () => {
  const CONFIG = {
    displayMode: 'token-chip',
    showMorphology: true,
    showFreeTranslation: false,
    showVerseGutter: false,
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

  it('measures each chip with the gloss its token carries', () => {
    const glossed: string[] = [];
    buildHeightTable(
      threeShortSegments(),
      CONFIG,
      300,
      (surfaceText, glossText) => {
        glossed.push(`${surfaceText}=${glossText}`);
        return 100;
      },
      undefined,
      new Map([['PSA 1:1:0', 'a long gloss']]),
    );
    expect(glossed).toContain('a=a long gloss');
  });

  it('wraps a row sooner when a gloss widens the chips past their surface text', () => {
    const segments = threeShortSegments();
    // A gloss-aware measurer: a glossed chip takes the whole wrap width, so its neighbor must wrap.
    const measureWithGloss = (_surfaceText: string, glossText = '') =>
      glossText === '' ? 100 : 300;
    const withoutGloss = buildHeightTable(segments, CONFIG, 300, measureWithGloss);
    const withGloss = buildHeightTable(
      segments,
      CONFIG,
      300,
      measureWithGloss,
      undefined,
      new Map([['PSA 1:1:0', 'wide']]),
    );
    expect(withGloss.heights[0]).toBeGreaterThan(withoutGloss.heights[0]);
  });

  it('measures two tokens sharing a surface form separately once their glosses differ', () => {
    const segments = [
      makeSegment('PSA 1:1', 'a a', [
        makeWordToken('PSA 1:1:0', 'a'),
        makeWordToken('PSA 1:1:1', 'a'),
      ]),
    ];
    const measured: string[] = [];
    buildHeightTable(
      segments,
      CONFIG,
      300,
      (surfaceText, glossText) => {
        measured.push(`${surfaceText}=${glossText}`);
        return 100;
      },
      undefined,
      new Map([
        ['PSA 1:1:0', 'first'],
        ['PSA 1:1:1', 'second'],
      ]),
    );
    expect(measured).toEqual(['a=first', 'a=second']);
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

  it('adds the extra gap above only the segments that carry one', () => {
    const table = buildHeightTable(
      threeShortSegments(),
      { ...CONFIG, segmentGapPx: 8, extraGapPx: (index) => (index === 2 ? 24 : 0) },
      300,
      measure,
    );
    expect(table.heights).toEqual([132, 140, 164]);
  });

  it('charges no extra gap when none is supplied', () => {
    const table = buildHeightTable(
      threeShortSegments(),
      { ...CONFIG, segmentGapPx: 8 },
      300,
      measure,
    );
    expect(table.heights).toEqual([132, 140, 140]);
  });

  it('never charges an extra gap above the first segment', () => {
    const table = buildHeightTable(
      threeShortSegments(),
      { ...CONFIG, segmentGapPx: 8, extraGapPx: () => 24 },
      300,
      measure,
    );
    expect(table.heights[0]).toBe(132);
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

  it('counts wrapped text lines, not chip rows, in baseline-text mode', () => {
    // Three words wide enough that their run needs two lines of the box, while the segment's one
    // chip fits a single row.
    const segment = makeSegment('PSA 1:1', 'xxxxxxxxxx yyyyyyyyyy zzzzzzzzzz', [
      makeWordToken('PSA 1:1:0', 'xxxxxxxxxx'),
    ]);
    const table = buildHeightTable([segment], BASELINE, 300, (text) => text.length * 10);
    expect(table.heights).toEqual([58]);
  });

  it('breaks baseline text between words rather than at the wrap width', () => {
    // Words sized so that no two fit a line together, though their total width would fill fewer
    // lines than the browser lays out.
    const segment = makeSegment('PSA 1:1', 'xxxxxxxxxxxxxxxx yyyyyyyyyyyyyyyy zzzzzzzzzzzzzzzz', [
      makeWordToken('PSA 1:1:0', 'xxxxxxxxxxxxxxxx'),
    ]);
    const table = buildHeightTable([segment], BASELINE, 200, (text) => text.length * 10);
    expect(table.heights).toEqual([78]);
  });

  it('reports one line for a segment whose baseline text is empty', () => {
    const segment = makeSegment('PSA 1:1', '', []);
    const table = buildHeightTable([segment], BASELINE, 300, (text) => text.length * 10);
    expect(table.heights).toEqual([38]);
  });

  it('takes a mounted segment at its measured height rather than its predicted one', () => {
    const segment = makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]);
    const table = buildHeightTable([segment], CONFIG, 300, measure, new Map([['PSA 1:1', 500]]));
    expect(table.heights).toEqual([500]);
  });

  it('predicts a segment that has no measurement yet', () => {
    const segments = [
      makeSegment('PSA 1:1', 'a', [makeWordToken('PSA 1:1:0', 'a')]),
      makeSegment('PSA 1:2', 'a', [makeWordToken('PSA 1:2:0', 'a')]),
    ];
    const table = buildHeightTable(segments, CONFIG, 300, measure, new Map([['PSA 1:1', 500]]));
    expect(table.heights).toEqual([500, 132]);
  });

  it('keeps a word wider than the box on its own overflowing line', () => {
    // One word wider than the whole box, which default `overflow-wrap` never splits.
    const segment = makeSegment('PSA 1:1', 'x'.repeat(60), [makeWordToken('PSA 1:1:0', 'x')]);
    const table = buildHeightTable([segment], BASELINE, 300, (text) => text.length * 10);
    expect(table.heights).toEqual([38]);
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
    showVerseGutter: false,
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
    showVerseGutter: false,
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
