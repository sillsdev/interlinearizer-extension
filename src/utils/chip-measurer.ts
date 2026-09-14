import type { MeasureChipWidth } from './segment-heights';

/** The subset of a canvas 2D context text measurement needs. */
export type TextMetricsSource = {
  font: string;
  measureText: (text: string) => { width: number };
};

/** Chip geometry read from live styles, in pixels except for the CSS font shorthand. */
export type ChipMetrics = Readonly<{
  /** CSS font shorthand the surface text renders in. */
  font: string;
  /** Width below which a chip cannot shrink, from the gloss field's minimum width. */
  floorPx: number;
  /** Horizontal padding and borders a chip adds around its surface text. */
  padPx: number;
}>;

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
 * Finds the chip's own gloss input, which a chip showing morphology holds behind the morpheme gloss
 * inputs.
 *
 * @returns The token gloss input, or `undefined` when the element is not laid out as a chip.
 */
function findGlossInput(chip: Element): HTMLInputElement | undefined {
  const id = chip instanceof HTMLLabelElement ? chip.htmlFor : '';
  const bound = id ? chip.querySelector(`input#${CSS.escape(id)}`) : undefined;
  const gloss = bound ?? chip.querySelector('input');
  return gloss instanceof HTMLInputElement ? gloss : undefined;
}

/**
 * Reads a mounted token chip's geometry from its live styles.
 *
 * @param chip - A mounted chip element, containing its surface-text span and gloss field.
 * @returns The chip's metrics, or `undefined` when the element is not laid out as a chip.
 */
export function readChipMetrics(chip: Element): ChipMetrics | undefined {
  const surface = chip.querySelector('span');
  const gloss = findGlossInput(chip);
  if (!surface || !gloss) return undefined;
  const glossStyle = getComputedStyle(gloss);
  const minWidthPx = Number.parseFloat(glossStyle.minWidth);
  const glossChrome = [
    glossStyle.paddingLeft,
    glossStyle.paddingRight,
    glossStyle.borderLeftWidth,
    glossStyle.borderRightWidth,
  ].reduce((total, side) => total + (Number.parseFloat(side) || 0), 0);
  // Under `border-box`, which Tailwind's preflight gives every element, `min-width` already bounds
  // the chrome, so only a `content-box` field is charged it on top.
  const floorPx = Number.isNaN(minWidthPx)
    ? glossChrome
    : minWidthPx + (glossStyle.boxSizing === 'content-box' ? glossChrome : 0);
  return {
    font: getComputedStyle(surface).font,
    floorPx,
    padPx: Math.max(0, chip.getBoundingClientRect().width - surface.getBoundingClientRect().width),
  };
}

/**
 * Builds a {@link MeasureChipWidth} that resolves a surface text to the width its chip occupies.
 *
 * @returns A measurer that never reports less than the chip's minimum width.
 */
export function createChipMeasurer(
  context: TextMetricsSource,
  metrics: ChipMetrics,
): MeasureChipWidth {
  // eslint-disable-next-line no-param-reassign
  context.font = metrics.font;
  return (surfaceText: string) =>
    Math.max(metrics.floorPx, context.measureText(surfaceText).width + metrics.padPx);
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
