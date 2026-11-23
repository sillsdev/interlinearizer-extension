/** A half-open `[start, end)` range of indices into the flat list a scroll window slices. */
export type WindowRange = Readonly<{ start: number; end: number }>;

/**
 * Counts the mounted elements an extend may cull: the contiguous run, from the end of the window
 * opposite the one growing, that `isBeyondRetention` reports clear of the viewport. The walk stops
 * at the first retained element, since every element past it lies nearer the viewport still.
 *
 * @param els - The mounted elements, in list order.
 * @param from - The end the run starts from: `'end'` for a window growing at its start, `'start'`
 *   for one growing at its end.
 * @param isBeyondRetention - Whether an element lies wholly beyond the retention margin.
 */
export function countCullableRun(
  els: readonly Element[],
  from: 'start' | 'end',
  isBeyondRetention: (el: Element) => boolean,
): number {
  let count = 0;
  if (from === 'end') {
    for (let i = els.length - 1; i >= 0 && isBeyondRetention(els[i]); i -= 1) count += 1;
  } else {
    for (let i = 0; i < els.length && isBeyondRetention(els[i]); i += 1) count += 1;
  }
  return count;
}
