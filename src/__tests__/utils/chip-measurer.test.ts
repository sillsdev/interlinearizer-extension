/// <reference types="jest" />

import {
  cacheMeasurer,
  createChipMeasurer,
  createTextMeasurer,
  getTextMetricsSource,
  readBaselineMetrics,
  readChipMetrics,
} from '../../utils/chip-measurer';

/**
 * Stands in for the canvas 2D context the measurer uses, charging a fixed width per character so a
 * test can state an expected width without depending on a real font.
 */
function fakeContext(pxPerChar: number) {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * pxPerChar }),
  };
}

describe('createChipMeasurer', () => {
  it('measures a chip wider than the floor from its surface text', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 50,
      padPx: 0,
    });
    expect(measure('abcdefgh')).toBe(80);
  });

  it('holds a chip narrower than the floor at the floor', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 50,
      padPx: 0,
    });
    expect(measure('ab')).toBe(50);
  });

  it('adds the chip padding around the measured text', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 6,
    });
    expect(measure('abcd')).toBe(46);
  });

  it('applies the surface font to the context so surface text measures in the chip typeface', () => {
    const context = fakeContext(10);
    const measure = createChipMeasurer(context, { font: '14px mono', floorPx: 0, padPx: 0 });
    measure('abcd');
    expect(context.font).toBe('14px mono');
  });

  it('applies the gloss font to the context so a gloss measures in its own typeface', () => {
    const context = fakeContext(10);
    const measure = createChipMeasurer(context, {
      font: '14px mono',
      glossFont: '11px mono',
      floorPx: 0,
      padPx: 0,
    });
    measure('ab', 'gloss');
    expect(context.font).toBe('11px mono');
  });

  it('widens a chip whose gloss is wider than its surface text', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      glossFont: '14px mono',
      floorPx: 0,
      padPx: 0,
      glossPadPx: 6,
    });
    // The gloss and its own padding decide the width here, not the shorter surface text.
    expect(measure('ab', 'longgloss')).toBe(9 * 10 + 6);
  });

  it('holds a chip whose surface text is wider than its gloss at the surface width', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      glossFont: '14px mono',
      floorPx: 0,
      padPx: 0,
      glossPadPx: 6,
    });
    expect(measure('abcdefghij', 'go')).toBe(100);
  });

  it('measures no gloss width for a chip whose gloss is empty', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      glossFont: '14px mono',
      floorPx: 0,
      padPx: 0,
      glossPadPx: 6,
    });
    // Without the empty-gloss short circuit the padding alone would win over the surface text.
    expect(measure('ab', '')).toBe(20);
  });

  it('ignores a gloss when the metrics carry no gloss font to measure it in', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
    });
    expect(measure('ab', 'longgloss')).toBe(20);
  });

  it('charges the chip padding around the wider of the two texts', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      glossFont: '14px mono',
      floorPx: 0,
      padPx: 4,
      glossPadPx: 0,
    });
    expect(measure('ab', 'gloss')).toBe(5 * 10 + 4);
  });

  /** Grid geometry with no chrome, so a measured width is the cell texts alone. */
  const BARE_GRID = {
    formFont: '11px mono',
    glossFont: '11px mono',
    formPadPx: 0,
    glossPadPx: 0,
    columnFloorPx: 0,
    columnGapPx: 0,
    padPx: 0,
  };

  it('sizes a chip to its morpheme grid when that is wider than either of its texts', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      glossFont: '14px mono',
      floorPx: 0,
      padPx: 0,
      glossPadPx: 0,
      morpheme: BARE_GRID,
    });
    expect(
      measure('a', 'b', [
        { form: 'abcd', gloss: 'x' },
        { form: 'y', gloss: 'efgh' },
      ]),
    ).toBe(4 * 10 + 4 * 10);
  });

  it('sizes each grid column to the wider of the form and gloss stacked in it', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
      morpheme: BARE_GRID,
    });
    expect(measure('a', '', [{ form: 'ab', gloss: 'abcd' }])).toBe(4 * 10);
  });

  it('holds a grid column no narrower than the column floor', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
      morpheme: { ...BARE_GRID, columnFloorPx: 60 },
    });
    expect(measure('a', '', [{ form: 'ab', gloss: '' }])).toBe(60);
  });

  it('charges the gaps between grid columns and the padding around them', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
      morpheme: { ...BARE_GRID, columnGapPx: 2, padPx: 3 },
    });
    // Two columns of one 10px character each, one gap between them, padding on both sides.
    expect(
      measure('a', '', [
        { form: 'a', gloss: '' },
        { form: 'b', gloss: '' },
      ]),
    ).toBe(10 + 10 + 2 + 3);
  });

  it("charges each grid cell's own padding around its text", () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
      morpheme: { ...BARE_GRID, formPadPx: 4, glossPadPx: 6 },
    });
    // The gloss cell wins the column: its text plus its own padding exceeds the form's.
    expect(measure('a', '', [{ form: 'ab', gloss: 'ab' }])).toBe(2 * 10 + 6);
  });

  it('ignores a breakdown when no mounted chip supplied the grid geometry to size it', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
    });
    expect(measure('a', '', [{ form: 'abcdefgh', gloss: '' }])).toBe(10);
  });

  it('measures no grid for a token whose breakdown is empty', () => {
    const measure = createChipMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 0,
      padPx: 0,
      morpheme: { ...BARE_GRID, padPx: 99 },
    });
    expect(measure('a', '', [])).toBe(10);
  });
});

describe('readChipMetrics', () => {
  /** Side padding and borders jsdom's UA stylesheet gives every `<input>`. */
  const UA_GLOSS_CHROME_PX = 6;

  /**
   * Side borders jsdom's UA stylesheet gives every `<button>` and `<input>`, which remain once a
   * test sets its own padding over the UA's.
   */
  const UA_CELL_BORDER_PX = 4;

  /**
   * Builds a chip whose surface span and gloss field carry the styles the reader looks for.
   * `boxSizing` is always set explicitly: jsdom computes it to `''` otherwise, which stands for
   * neither sizing model.
   */
  /** Options for the morpheme grid {@link mountChip} can nest inside the chip. */
  type GridOptions = {
    formFont?: string;
    glossFont?: string;
    formMinWidth?: string;
    glossMinWidth?: string;
    formPadding?: string;
    glossPadding?: string;
    columnGap?: string;
    gridPadding?: string;
    readOnly?: boolean;
  };

  /**
   * Builds the morpheme grid a chip holds when its token has a breakdown, as MorphemeBox renders
   * it.
   */
  function mountGrid({
    formFont = '11px monospace',
    glossFont = '11px sans-serif',
    formMinWidth = '',
    glossMinWidth = '',
    formPadding,
    glossPadding,
    columnGap,
    gridPadding,
    readOnly = false,
  }: GridOptions) {
    const grid = document.createElement('div');
    grid.style.gridTemplateColumns = 'repeat(2, minmax(1ch, auto))';
    if (columnGap !== undefined) grid.style.columnGap = columnGap;
    if (gridPadding !== undefined) {
      grid.style.paddingLeft = gridPadding;
      grid.style.paddingRight = gridPadding;
    }
    // The forms row leads with the edit-breakdown button, which the reader samples as the form cell.
    const form = document.createElement('button');
    form.style.font = formFont;
    form.style.minWidth = formMinWidth;
    form.style.boxSizing = 'border-box';
    if (formPadding !== undefined) {
      form.style.paddingLeft = formPadding;
      form.style.paddingRight = formPadding;
    }
    const gloss = document.createElement(readOnly ? 'span' : 'input');
    if (readOnly) gloss.setAttribute('data-testid', 'readonly-morpheme-gloss');
    else gloss.setAttribute('data-morpheme-gloss', 'true');
    gloss.style.font = glossFont;
    gloss.style.minWidth = glossMinWidth;
    gloss.style.boxSizing = 'border-box';
    if (glossPadding !== undefined) {
      gloss.style.paddingLeft = glossPadding;
      gloss.style.paddingRight = glossPadding;
    }
    grid.append(form, gloss);
    return grid;
  }

  function mountChip({
    font,
    minWidth,
    boxSizing = 'border-box',
    padding,
    morphemeMinWidth,
    chipPadding,
    chipBorder,
    grid,
  }: {
    font: string;
    minWidth: string;
    boxSizing?: 'border-box' | 'content-box';
    padding?: string;
    morphemeMinWidth?: string;
    chipPadding?: string;
    chipBorder?: string;
    grid?: GridOptions;
  }) {
    const chip = document.createElement('label');
    if (chipPadding !== undefined) {
      chip.style.paddingLeft = chipPadding;
      chip.style.paddingRight = chipPadding;
    }
    if (chipBorder !== undefined) {
      chip.style.borderLeftWidth = chipBorder;
      chip.style.borderRightWidth = chipBorder;
    }
    const surface = document.createElement('span');
    surface.textContent = 'word';
    surface.style.font = font;
    const gloss = document.createElement('input');
    gloss.id = 'token-gloss';
    gloss.style.minWidth = minWidth;
    gloss.style.boxSizing = boxSizing;
    if (padding !== undefined) {
      gloss.style.paddingLeft = padding;
      gloss.style.paddingRight = padding;
    }
    chip.htmlFor = gloss.id;
    chip.append(surface);
    // The morpheme gloss inputs precede the token's own inside the label, as they do in TokenChip.
    if (morphemeMinWidth !== undefined) {
      const morpheme = document.createElement('input');
      morpheme.style.minWidth = morphemeMinWidth;
      chip.append(morpheme);
    }
    if (grid) {
      chip.append(mountGrid(grid));
    }
    chip.append(gloss);
    document.body.append(chip);
    return { chip, surface };
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('takes the font from the chip surface text', () => {
    const { chip, surface } = mountChip({ font: '13px monospace', minWidth: '40px' });
    expect(readChipMetrics(chip)?.font).toBe(getComputedStyle(surface).font);
  });

  it('takes the floor from a border-box gloss field minimum width alone', () => {
    // The sizing every chip in the app gets, from Tailwind's preflight.
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px', padding: '12px' });
    expect(readChipMetrics(chip)?.floorPx).toBe(40);
  });

  it("adds the chip's own chrome to the floor, which no gloss field minimum bounds", () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      padding: '12px',
      chipPadding: '2px',
      chipBorder: '1px',
    });
    expect(readChipMetrics(chip)?.floorPx).toBe(40 + 2 * 2 + 1 * 2);
  });

  it('adds the chrome to the floor of a content-box gloss field', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      boxSizing: 'content-box',
      padding: '12px',
    });
    expect(readChipMetrics(chip)?.floorPx).toBe(40 + 12 * 2 + 2 * 2);
  });

  it("takes the padding from the chip's own chrome, not from the slack around a short sample", () => {
    // Rects of a chip held at its gloss minimum: far wider than the short surface text it wraps.
    const { chip, surface } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      chipPadding: '2px',
      chipBorder: '1px',
    });
    jest.spyOn(chip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 46, 20));
    jest.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 8, 20));
    expect(readChipMetrics(chip)?.padPx).toBe(2 * 2 + 1 * 2);
  });

  it('reports nothing for an element that is not a chip', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(readChipMetrics(bare)).toBeUndefined();
  });

  it('falls back to the chrome as the floor when the gloss field sets no minimum width', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '' });
    expect(readChipMetrics(chip)?.floorPx).toBe(UA_GLOSS_CHROME_PX);
  });

  it('takes the floor from the token gloss field, not a morpheme one that precedes it', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      morphemeMinWidth: '16px',
    });
    expect(readChipMetrics(chip)?.floorPx).toBe(40);
  });

  it('charges no chrome for a content-box gloss field whose padding and borders do not resolve', () => {
    // Stands in for a host that reports an empty computed value for padding and borders.
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px' });
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      const { style } = document.createElement('div');
      style.minWidth = '40px';
      style.boxSizing = 'content-box';
      return style;
    });
    expect(readChipMetrics(chip)?.floorPx).toBe(40);
  });

  /**
   * Builds the chip a read-only analysis renders, whose gloss is a static span and which holds no
   * input.
   */
  function mountReadOnlyChip({ minWidth, padding }: { minWidth: string; padding?: string }) {
    const chip = document.createElement('label');
    const surface = document.createElement('span');
    surface.textContent = 'word';
    surface.style.font = '13px monospace';
    const gloss = document.createElement('span');
    gloss.setAttribute('data-readonly-gloss', '');
    gloss.style.minWidth = minWidth;
    gloss.style.boxSizing = 'border-box';
    if (padding !== undefined) {
      gloss.style.paddingLeft = padding;
      gloss.style.paddingRight = padding;
    }
    chip.append(surface, gloss);
    document.body.append(chip);
    return { chip, surface };
  }

  it('reads the floor from the static gloss of a read-only chip, which holds no input', () => {
    const { chip } = mountReadOnlyChip({ minWidth: '40px', padding: '12px' });
    expect(readChipMetrics(chip)?.floorPx).toBe(40);
  });

  it('reads the surface font of a read-only chip rather than reporting nothing', () => {
    const { chip, surface } = mountReadOnlyChip({ minWidth: '40px' });
    expect(readChipMetrics(chip)?.font).toBe(getComputedStyle(surface).font);
  });

  it('falls back to the first input when the chip binds no gloss field by id', () => {
    const chip = document.createElement('label');
    const surface = document.createElement('span');
    const gloss = document.createElement('input');
    gloss.style.minWidth = '24px';
    gloss.style.boxSizing = 'border-box';
    chip.append(surface, gloss);
    document.body.append(chip);
    expect(readChipMetrics(chip)?.floorPx).toBe(24);
  });

  it('reports no grid metrics for a chip whose token has no breakdown', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px' });
    expect(readChipMetrics(chip)?.morpheme).toBeUndefined();
  });

  it('takes the grid fonts from the form and gloss cells stacked in a column', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      grid: { formFont: '11px monospace', glossFont: '11px sans-serif' },
    });
    const morpheme = readChipMetrics(chip)?.morpheme;
    expect(morpheme?.formFont).toContain('monospace');
    expect(morpheme?.glossFont).toContain('sans-serif');
  });

  it('takes the column floor from the wider of the two cell minimums', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      grid: { formMinWidth: '10px', glossMinWidth: '16px' },
    });
    expect(readChipMetrics(chip)?.morpheme?.columnFloorPx).toBe(16);
  });

  it('takes the column gap and the padding around the grid', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      grid: { columnGap: '2px', gridPadding: '3px' },
    });
    const morpheme = readChipMetrics(chip)?.morpheme;
    expect(morpheme?.columnGapPx).toBe(2);
    expect(morpheme?.padPx).toBe(3 * 2);
  });

  it("takes the cells' own padding, which sizes each column around its text", () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      grid: { formPadding: '2px', glossPadding: '4px' },
    });
    const morpheme = readChipMetrics(chip)?.morpheme;
    expect(morpheme?.formPadPx).toBe(2 * 2 + UA_CELL_BORDER_PX);
    expect(morpheme?.glossPadPx).toBe(4 * 2 + UA_CELL_BORDER_PX);
  });

  it('reads a read-only grid, whose glosses are static text rather than inputs', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      grid: { readOnly: true, glossMinWidth: '16px' },
    });
    expect(readChipMetrics(chip)?.morpheme?.columnFloorPx).toBe(16);
  });

  it('charges no gap for a grid whose column gap does not resolve', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px', grid: {} });
    expect(readChipMetrics(chip)?.morpheme?.columnGapPx).toBe(0);
  });

  it('adds the chrome to the floor of a content-box grid cell', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px', grid: {} });
    // Stands in for a host that sizes the grid cells as content boxes.
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      const { style } = document.createElement('div');
      style.minWidth = '16px';
      style.boxSizing = 'content-box';
      style.paddingLeft = '3px';
      style.paddingRight = '3px';
      return style;
    });
    expect(readChipMetrics(chip)?.morpheme?.columnFloorPx).toBe(16 + 3 * 2);
  });
});

describe('createTextMeasurer', () => {
  it('measures text without the chip minimum width', () => {
    const measure = createTextMeasurer(fakeContext(10), {
      font: '14px mono',
      floorPx: 50,
      padPx: 6,
    });
    expect(measure('ab')).toBe(20);
  });
});

describe('cacheMeasurer', () => {
  it('measures a form it has already seen only once', () => {
    const measureSpy = jest.fn(() => 100);
    const measure = cacheMeasurer(measureSpy);
    measure('the');
    measure('the');
    expect(measureSpy).toHaveBeenCalledTimes(1);
  });

  it('measures each distinct form', () => {
    const measureSpy = jest.fn((text: string) => text.length * 10);
    const measure = cacheMeasurer(measureSpy);
    expect([measure('ab'), measure('cde')]).toEqual([20, 30]);
  });
});

describe('readBaselineMetrics', () => {
  it('reads the font off the run and carries no chip floor or padding', () => {
    const run = document.createElement('span');
    run.style.font = '13px monospace';
    document.body.append(run);
    expect(readBaselineMetrics(run)).toEqual({
      font: getComputedStyle(run).font,
      floorPx: 0,
      padPx: 0,
    });
  });
});

describe('getTextMetricsSource', () => {
  it('reports nothing where the host provides no canvas rendering', () => {
    // jsdom implements no 2D context, which is the same absence a locked-down host would present.
    expect(getTextMetricsSource()).toBeUndefined();
  });
});
