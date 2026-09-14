import type { MeasureChipWidth } from './segment-heights';

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
  return (surfaceText: string, glossText = '') => {
    const surfacePx = measureIn(metrics.font, surfaceText);
    const glossPx =
      glossText === '' || metrics.glossFont === undefined
        ? 0
        : measureIn(metrics.glossFont, glossText) + (metrics.glossPadPx ?? 0);
    return Math.max(metrics.floorPx, Math.max(surfacePx, glossPx) + metrics.padPx);
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
 * Builds a measurer whose results stay valid for as long as the metrics they were measured under.
 *
 * @returns A measurer that reports a form it has already measured without measuring it again.
 */
export function cacheMeasurer(measure: MeasureChipWidth): MeasureChipWidth {
  // Keyed by both texts, since a chip's width depends on its gloss as well as its surface form;
  // neither text contains a newline, so no two pairs collide on the separator.
  const widthByForm = new Map<string, number>();
  return (surfaceText: string, glossText = '') => {
    const key = `${surfaceText}\n${glossText}`;
    const cached = widthByForm.get(key);
    if (cached !== undefined) return cached;
    const width = measure(surfaceText, glossText);
    widthByForm.set(key, width);
    return width;
  };
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
