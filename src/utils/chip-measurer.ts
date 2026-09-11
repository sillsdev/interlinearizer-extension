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
 * Reads a mounted token chip's geometry from its live styles.
 *
 * @param chip - A mounted chip element, containing its surface-text span and gloss field.
 * @returns The chip's metrics, or `undefined` when the element is not laid out as a chip.
 */
export function readChipMetrics(chip: Element): ChipMetrics | undefined {
  const surface = chip.querySelector('span');
  const gloss = chip.querySelector('input');
  if (!surface || !gloss) return undefined;
  const floorPx = Number.parseFloat(getComputedStyle(gloss).minWidth);
  return {
    font: getComputedStyle(surface).font,
    floorPx: Number.isNaN(floorPx) ? 0 : floorPx,
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
