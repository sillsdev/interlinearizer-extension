/// <reference types="jest" />

import {
  createChipMeasurer,
  createTextMeasurer,
  getTextMetricsSource,
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
  /** Builds a chip whose surface span and gloss field carry the styles the reader looks for. */
  function mountChip({ font, minWidth }: { font: string; minWidth: string }) {
    const chip = document.createElement('label');
    const surface = document.createElement('span');
    surface.textContent = 'word';
    surface.style.font = font;
    const gloss = document.createElement('input');
    gloss.style.minWidth = minWidth;
    chip.append(surface, gloss);
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

  it('takes the floor from the gloss field minimum width', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '40px' });
    expect(readChipMetrics(chip)?.floorPx).toBe(40);
  });

  it('reports nothing for an element that is not a chip', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(readChipMetrics(bare)).toBeUndefined();
  });

  it('floors at zero when the gloss field sets no minimum width', () => {
    const { chip } = mountChip({ font: '13px monospace', minWidth: '' });
    expect(readChipMetrics(chip)?.floorPx).toBe(0);
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

describe('getTextMetricsSource', () => {
  it('reports nothing where the host provides no canvas rendering', () => {
    // jsdom implements no 2D context, which is the same absence a locked-down host would present.
    expect(getTextMetricsSource()).toBeUndefined();
  });
});
