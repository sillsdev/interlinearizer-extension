/// <reference types="jest" />

import { decideReseat, SKIM_LEAD_PX, type ReseatInputs } from '../../hooks/useSkimReseat';
import type { HeightTable } from '../../utils/segment-heights';

/**
 * A book of 100 segments, each 1000px tall, so segment `i` starts at offset `i * 1000` and the skim
 * distances read as whole segments.
 */
const TABLE: HeightTable = (() => {
  const heights = Array.from({ length: 100 }, () => 1000);
  const offsets = heights.map((_h, i) => i * 1000);
  offsets.push(100_000);
  return { heights, boxHeights: heights, offsets, total: 100_000 };
})();

/** A 600px-tall container whose top edge sits at 0 in the viewport. */
const ROOT = { top: 0, bottom: 600 };

/**
 * Inputs with the mounted run straddling the viewport, far from either edge: nothing to re-seat.
 * Each test overrides what makes it different.
 */
const ON_SCREEN: ReseatInputs = {
  root: ROOT,
  topSentinelTop: -5000,
  bottomSentinelBottom: 5000,
  scrollTop: 50_000,
  isSkimming: false,
  direction: 1,
  range: { start: 45, end: 56 },
  table: TABLE,
};

describe('decideReseat', () => {
  it('leaves a window the viewport still sits inside', () => {
    expect(decideReseat(ON_SCREEN)).toBeUndefined();
  });

  it('rebuilds around the scroll position when the mounted run lies wholly above the viewport', () => {
    // Segment 50, reaching 2000px behind to segment 48 and 8000px ahead to segment 58.
    expect(
      decideReseat({
        ...ON_SCREEN,
        bottomSentinelBottom: -1,
        scrollTop: 50_000,
        range: { start: 0, end: 10 },
      }),
    ).toStrictEqual({ start: 48, end: 59 });
  });

  it('rebuilds reaching further up the book when traveling up', () => {
    // Segment 50, reaching 8000px behind to segment 42 and 2000px ahead to segment 52.
    expect(
      decideReseat({
        ...ON_SCREEN,
        topSentinelTop: 601,
        scrollTop: 50_000,
        direction: -1,
        range: { start: 90, end: 100 },
      }),
    ).toStrictEqual({ start: 42, end: 53 });
  });

  it('rebuilds a skim whose scroll position has left the window', () => {
    expect(
      decideReseat({
        ...ON_SCREEN,
        bottomSentinelBottom: ROOT.bottom + SKIM_LEAD_PX - 1,
        isSkimming: true,
        scrollTop: 50_000,
        range: { start: 0, end: 10 },
      }),
    ).toStrictEqual({ start: 48, end: 59 });
  });

  it('leaves the window when the table places the scroll position inside it', () => {
    expect(decideReseat({ ...ON_SCREEN, bottomSentinelBottom: -1 })).toBeUndefined();
  });

  it('slides a skim running out of runway ahead, keeping the segments both ranges share', () => {
    // Both edges move 3000px, three segments, down the book.
    expect(
      decideReseat({
        ...ON_SCREEN,
        bottomSentinelBottom: ROOT.bottom + SKIM_LEAD_PX - 1,
        isSkimming: true,
        range: { start: 40, end: 60 },
      }),
    ).toStrictEqual({ start: 43, end: 63 });
  });

  it('slides a skim running out of runway behind when traveling up', () => {
    expect(
      decideReseat({
        ...ON_SCREEN,
        topSentinelTop: ROOT.top - SKIM_LEAD_PX + 1,
        isSkimming: true,
        direction: -1,
        range: { start: 40, end: 60 },
      }),
    ).toStrictEqual({ start: 37, end: 57 });
  });

  it('leaves a skim with the full lead distance of runway ahead', () => {
    expect(
      decideReseat({
        ...ON_SCREEN,
        bottomSentinelBottom: ROOT.bottom + SKIM_LEAD_PX,
        isSkimming: true,
        range: { start: 40, end: 60 },
      }),
    ).toBeUndefined();
  });

  it('leaves a slide that the end of the book holds in place', () => {
    expect(
      decideReseat({
        ...ON_SCREEN,
        bottomSentinelBottom: ROOT.bottom + SKIM_LEAD_PX - 1,
        isSkimming: true,
        scrollTop: 90_000,
        range: { start: 80, end: 100 },
      }),
    ).toBeUndefined();
  });
});
