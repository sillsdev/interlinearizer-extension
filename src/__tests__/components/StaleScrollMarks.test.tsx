/// <reference types="jest" />

import { render, screen } from '@testing-library/react';
import StaleScrollMarks from '../../components/StaleScrollMarks';
import type { OutlineSegment } from '../../types/segment-pages';
import { buildHeightTable } from '../../utils/segment-heights';
import { makeSegment, makeWordToken, outlineOf } from '../test-helpers';

/** GEN 1:1–4, one word each, with no stale flags. */
const OUTLINE = outlineOf(
  [1, 2, 3, 4].map((verse) =>
    makeSegment(`GEN 1:${verse}`, 'word', [makeWordToken(`GEN 1:${verse}:0`, 'word')]),
  ),
);

/** Equal segment heights, so each segment takes a quarter of the track. */
const HEIGHTS = buildHeightTable(
  { displayMode: 'token-chip', showMorphology: false, showFreeTranslation: false },
  [100, 100, 100, 100],
);

/** A copy of {@link OUTLINE} in which each segment takes the flags keyed by its index. */
function flagged(flags: Record<number, Partial<OutlineSegment>>): OutlineSegment[] {
  return OUTLINE.map((segment, index) => ({ ...segment, ...flags[index] }));
}

/** The ids of the segments marked, in track order. */
function markedIds(): (string | undefined)[] {
  return [...screen.getByTestId('stale-scroll-marks').children].map(
    (mark) => mark.getAttribute('data-stale-segment-id') ?? undefined,
  );
}

describe('StaleScrollMarks', () => {
  it('renders nothing when no segment shows a stale analysis', () => {
    render(<StaleScrollMarks segments={OUTLINE} heights={HEIGHTS} />);

    expect(screen.queryByTestId('stale-scroll-marks')).not.toBeInTheDocument();
  });

  it('marks only the segments holding a stale gloss', () => {
    render(
      <StaleScrollMarks
        segments={flagged({ 1: { hasStaleGloss: true }, 2: { hasStaleGloss: false } })}
        heights={HEIGHTS}
      />,
    );

    expect(markedIds()).toEqual(['GEN 1:2']);
  });

  it('marks only the segments showing a stale free translation', () => {
    render(
      <StaleScrollMarks
        segments={flagged({
          0: { hasStaleFreeTranslation: false },
          3: { hasStaleFreeTranslation: true },
        })}
        heights={HEIGHTS}
      />,
    );

    expect(markedIds()).toEqual(['GEN 1:4']);
  });

  it("places each mark at its segment's share of the book's predicted height", () => {
    render(
      <StaleScrollMarks segments={flagged({ 2: { hasStaleGloss: true } })} heights={HEIGHTS} />,
    );

    const [mark] = screen.getByTestId('stale-scroll-marks').children;
    expect(mark).toHaveStyle({ top: '50%', height: '25%' });
  });

  it('stays out of the way of assistive technology and the pointer', () => {
    render(
      <StaleScrollMarks segments={flagged({ 0: { hasStaleGloss: true } })} heights={HEIGHTS} />,
    );

    const track = screen.getByTestId('stale-scroll-marks');
    expect(track).toHaveAttribute('aria-hidden', 'true');
    expect(track).toHaveClass('tw:pointer-events-none');
  });
});
