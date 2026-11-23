/// <reference types="jest" />

import { countCullableRun } from '../../utils/scroll-window';

/**
 * Builds mounted elements, each marked beyond the retention margin or not, and the predicate that
 * reads the mark.
 */
function mounted(beyond: readonly boolean[]) {
  const els = beyond.map(() => document.createElement('div'));
  const beyondSet = new Set<Element>(els.filter((_el, i) => beyond[i]));
  return { els, isBeyondRetention: (el: Element) => beyondSet.has(el) };
}

describe('countCullableRun', () => {
  it('counts the run from the end, stopping at the first retained element', () => {
    const { els, isBeyondRetention } = mounted([true, false, true, true]);

    expect(countCullableRun(els, 'end', isBeyondRetention)).toBe(2);
  });

  it('counts the run from the start, stopping at the first retained element', () => {
    const { els, isBeyondRetention } = mounted([true, true, false, true]);

    expect(countCullableRun(els, 'start', isBeyondRetention)).toBe(2);
  });

  it('counts nothing when the element at the run end is retained', () => {
    const { els, isBeyondRetention } = mounted([true, true, false]);

    expect(countCullableRun(els, 'end', isBeyondRetention)).toBe(0);
  });

  it('counts every element when all lie beyond the margin', () => {
    const { els, isBeyondRetention } = mounted([true, true, true]);

    expect(countCullableRun(els, 'start', isBeyondRetention)).toBe(3);
  });

  it('counts nothing when nothing is mounted', () => {
    expect(countCullableRun([], 'end', () => true)).toBe(0);
  });
});
