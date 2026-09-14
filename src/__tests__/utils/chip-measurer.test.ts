/// <reference types="jest" />

import {
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

  it('applies the font to the context so text measures in the chip typeface', () => {
    const context = fakeContext(10);
    createChipMeasurer(context, { font: '14px mono', floorPx: 0, padPx: 0 });
    expect(context.font).toBe('14px mono');
  });
});

describe('readChipMetrics', () => {
  /** Side padding and borders jsdom's UA stylesheet gives every `<input>`. */
  const UA_GLOSS_CHROME_PX = 6;

  /**
   * Builds a chip whose surface span and gloss field carry the styles the reader looks for.
   * `boxSizing` is always set explicitly: jsdom computes it to `''` otherwise, which stands for
   * neither sizing model.
   */
  function mountChip({
    font,
    minWidth,
    boxSizing = 'border-box',
    padding,
    morphemeMinWidth,
  }: {
    font: string;
    minWidth: string;
    boxSizing?: 'border-box' | 'content-box';
    padding?: string;
    morphemeMinWidth?: string;
  }) {
    const chip = document.createElement('label');
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

  it('adds the chrome to the floor of a content-box gloss field', () => {
    const { chip } = mountChip({
      font: '13px monospace',
      minWidth: '40px',
      boxSizing: 'content-box',
      padding: '12px',
    });
    expect(readChipMetrics(chip)?.floorPx).toBe(40 + 12 * 2 + 2 * 2);
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
