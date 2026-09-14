import type { MeasureChipWidth, MorphemeCell } from './segment-heights';

/** The subset of a canvas 2D context text measurement needs. */
export type TextMetricsSource = {
  font: string;
  measureText: (text: string) => { width: number };
};

/** Chip geometry read from live styles, in pixels except for the CSS font shorthands. */
export type ChipMetrics = Readonly<{
  /** CSS font shorthand the surface text renders in. */
  font: string;
  /**
   * CSS font shorthand the gloss renders in. Absent for metrics read from something other than a
   * chip, whose gloss width is never measured.
   */
  glossFont?: string;
  /** Width below which a chip cannot shrink: the gloss field's minimum, plus the chip's chrome. */
  floorPx: number;
  /** Horizontal padding and borders a chip adds around its surface text. */
  padPx: number;
  /**
   * Horizontal padding and borders the gloss field adds around its own text. Defaults to `0`, for
   * metrics that measure no gloss.
   */
  glossPadPx?: number;
  /**
   * Geometry of the morpheme grid a chip showing morphology holds. Absent when no chip on screen
   * has a breakdown to read it from, which leaves a grid's width unmodeled.
   */
  morpheme?: MorphemeGridMetrics;
}>;

/** Morpheme-grid geometry read from live styles, in pixels except for the CSS font shorthands. */
export type MorphemeGridMetrics = Readonly<{
  /** CSS font shorthand a morpheme form renders in. */
  formFont: string;
  /** CSS font shorthand a morpheme gloss renders in. */
  glossFont: string;
  /** Horizontal padding and borders a form cell adds around its text. */
  formPadPx: number;
  /** Horizontal padding and borders a gloss cell adds around its text. */
  glossPadPx: number;
  /** Width below which one column cannot shrink: the wider of the two cells' minimums. */
  columnFloorPx: number;
  /** Horizontal space between two adjacent columns. */
  columnGapPx: number;
  /** Horizontal padding and borders the grid adds around its columns. */
  padPx: number;
}>;

/** Marks the static span a read-only chip renders in place of its gloss input. */
const READ_ONLY_GLOSS_ATTRIBUTE = 'data-readonly-gloss';

/** Canvas backing {@link getTextMetricsSource}. */
let sharedCanvas: HTMLCanvasElement | undefined;

/**
 * Supplies the text-measuring context chip widths are derived from.
 *
 * @returns The shared context, or `undefined` where the host provides no canvas rendering.
 */
export function getTextMetricsSource(): TextMetricsSource | undefined {
  sharedCanvas ??= document.createElement('canvas');
  return sharedCanvas.getContext('2d') ?? undefined;
}

/**
 * Finds the chip's own gloss field, which a chip showing morphology holds behind the morpheme gloss
 * fields, and which a read-only chip renders as a static span rather than an input.
 *
 * @returns The token gloss field, or `undefined` when the element is not laid out as a chip.
 */
function findGlossField(chip: Element): HTMLElement | undefined {
  const id = chip instanceof HTMLLabelElement ? chip.htmlFor : '';
  const bound = id ? chip.querySelector(`input#${CSS.escape(id)}`) : undefined;
  const gloss = bound ?? chip.querySelector(`input, [${READ_ONLY_GLOSS_ATTRIBUTE}]`);
  return gloss instanceof HTMLElement ? gloss : undefined;
}

/** Sums an element's left and right padding and border widths, in pixels. */
function horizontalChrome(style: CSSStyleDeclaration): number {
  return [
    style.paddingLeft,
    style.paddingRight,
    style.borderLeftWidth,
    style.borderRightWidth,
  ].reduce((total, side) => total + (Number.parseFloat(side) || 0), 0);
}

/** Marks a morpheme gloss field, distinguishing it from the chip's own. */
const MORPHEME_GLOSS_ATTRIBUTE = 'data-morpheme-gloss';

/**
 * Reads the geometry of the morpheme grid a mounted chip holds when its token has a breakdown.
 *
 * @returns The grid's metrics, or `undefined` when this chip shows no breakdown to read.
 */
function readMorphemeGridMetrics(chip: Element): MorphemeGridMetrics | undefined {
  const grid = chip.querySelector('[style*="grid-template-columns"]');
  const gloss = grid?.querySelector(
    `[${MORPHEME_GLOSS_ATTRIBUTE}], [data-testid="readonly-morpheme-gloss"]`,
  );
  // The form sits in the grid's first row, above the gloss fields.
  const form = grid?.querySelector('button, span');
  if (!grid || !(gloss instanceof HTMLElement) || !(form instanceof HTMLElement)) return undefined;
  const gridStyle = getComputedStyle(grid);
  const glossStyle = getComputedStyle(gloss);
  const formStyle = getComputedStyle(form);
  const minWidthOf = (style: CSSStyleDeclaration) => {
    const minWidthPx = Number.parseFloat(style.minWidth);
    const chrome = horizontalChrome(style);
    // Under `border-box`, which Tailwind's preflight gives every element, `min-width` already
    // bounds the chrome, so only a `content-box` cell is charged it on top.
    if (Number.isNaN(minWidthPx)) return chrome;
    return minWidthPx + (style.boxSizing === 'content-box' ? chrome : 0);
  };
  return {
    formFont: formStyle.font,
    glossFont: glossStyle.font,
    formPadPx: horizontalChrome(formStyle),
    glossPadPx: horizontalChrome(glossStyle),
    // A grid track is at least as wide as the wider of the two cells stacked in it.
    columnFloorPx: Math.max(minWidthOf(formStyle), minWidthOf(glossStyle)),
    columnGapPx: Number.parseFloat(gridStyle.columnGap) || 0,
    padPx: horizontalChrome(gridStyle),
  };
}

/**
 * Reads a mounted token chip's geometry from its live styles.
 *
 * @param chip - A mounted chip element, containing its surface-text span and gloss field.
 * @returns The chip's metrics, or `undefined` when the element is not laid out as a chip.
 */
export function readChipMetrics(chip: Element): ChipMetrics | undefined {
  const surface = chip.querySelector('span');
  const gloss = findGlossField(chip);
  if (!surface || !gloss) return undefined;
  const glossStyle = getComputedStyle(gloss);
  const minWidthPx = Number.parseFloat(glossStyle.minWidth);
  const glossChrome = horizontalChrome(glossStyle);
  // Under `border-box`, which Tailwind's preflight gives every element, `min-width` already bounds
  // the chrome, so only a `content-box` field is charged it on top.
  const glossFloorPx = Number.isNaN(minWidthPx)
    ? glossChrome
    : minWidthPx + (glossStyle.boxSizing === 'content-box' ? glossChrome : 0);
  // The chip's own padding and borders sit outside the gloss field under either sizing model.
  const chipChrome = horizontalChrome(getComputedStyle(chip));
  const morpheme = readMorphemeGridMetrics(chip);
  return {
    font: getComputedStyle(surface).font,
    glossFont: glossStyle.font,
    floorPx: glossFloorPx + chipChrome,
    // The chrome alone, because a sampled chip is usually as wide as its gloss field's minimum:
    // any slack beyond the surface text is this chip's, and floorPx already carries that minimum.
    padPx: chipChrome,
    // A field sized to its content grows to fit the text plus its own chrome under either sizing
    // model, so the chrome is charged on top of the gloss rather than absorbed by it.
    glossPadPx: glossChrome,
    ...(morpheme === undefined ? {} : { morpheme }),
  };
}

/**
 * Builds a {@link MeasureChipWidth} that resolves a chip's texts to the width it occupies, which a
 * long gloss can drive past the surface text.
 *
 * @returns A measurer that never reports less than the chip's minimum width.
 */
export function createChipMeasurer(
  context: TextMetricsSource,
  metrics: ChipMetrics,
): MeasureChipWidth {
  // The surface text and the gloss render in different fonts, so each measurement sets its own.
  const measureIn = (font: string, text: string) => {
    // eslint-disable-next-line no-param-reassign
    context.font = font;
    return context.measureText(text).width;
  };
  // Each grid column is as wide as the wider of the form and gloss stacked in it, and the grid is
  // sized to its content, so its width is those columns plus the gaps and padding around them.
  const measureGrid = (morphemes: readonly MorphemeCell[]): number => {
    const grid = metrics.morpheme;
    if (!grid || morphemes.length === 0) return 0;
    const columns = morphemes.reduce((total, cell) => {
      const formPx = measureIn(grid.formFont, cell.form) + grid.formPadPx;
      const glossPx = measureIn(grid.glossFont, cell.gloss) + grid.glossPadPx;
      return total + Math.max(grid.columnFloorPx, formPx, glossPx);
    }, 0);
    return columns + grid.columnGapPx * (morphemes.length - 1) + grid.padPx;
  };
  return (surfaceText, glossText, morphemes) => {
    const surfacePx = measureIn(metrics.font, surfaceText);
    const glossPx =
      !glossText || metrics.glossFont === undefined
        ? 0
        : measureIn(metrics.glossFont, glossText) + (metrics.glossPadPx ?? 0);
    const gridPx = morphemes ? measureGrid(morphemes) : 0;
    return Math.max(metrics.floorPx, Math.max(surfacePx, glossPx, gridPx) + metrics.padPx);
  };
}

/**
 * Builds a measurer for a run of plain text, which carries neither a chip's minimum width nor its
 * padding.
 */
export function createTextMeasurer(
  context: TextMetricsSource,
  metrics: ChipMetrics,
): MeasureChipWidth {
  // eslint-disable-next-line no-param-reassign
  context.font = metrics.font;
  return (text: string) => context.measureText(text).width;
}

/**
 * Reads the font a mounted run of baseline text renders in, for the mode that mounts no chip for
 * {@link readChipMetrics} to read.
 *
 * @returns Metrics carrying the run's font, with no floor or padding — plain text has neither.
 */
export function readBaselineMetrics(run: Element): ChipMetrics {
  return { font: getComputedStyle(run).font, floorPx: 0, padPx: 0 };
}
