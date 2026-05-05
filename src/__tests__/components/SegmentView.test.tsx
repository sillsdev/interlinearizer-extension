/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Segment } from 'interlinearizer';
import SegmentView from '../../components/SegmentView';

/** A word token segment. */
const WORD_SEGMENT: Segment = {
  id: 'GEN 1:1',
  startRef: { book: 'GEN', chapter: 1, verse: 1 },
  endRef: { book: 'GEN', chapter: 1, verse: 1 },
  baselineText: 'In the beginning.',
  tokens: [
    { id: 'tok-0', surfaceText: 'In', writingSystem: 'en', type: 'word', charStart: 0, charEnd: 2 },
    {
      id: 'tok-1',
      surfaceText: 'the',
      writingSystem: 'en',
      type: 'word',
      charStart: 3,
      charEnd: 6,
    },
  ],
};

/** A segment with a single punctuation (non-word) token. */
const PUNCT_SEGMENT: Segment = {
  id: 'GEN 1:2',
  startRef: { book: 'GEN', chapter: 1, verse: 2 },
  endRef: { book: 'GEN', chapter: 1, verse: 2 },
  baselineText: '.',
  tokens: [
    {
      id: 'tok-p',
      surfaceText: '.',
      writingSystem: 'en',
      type: 'punctuation',
      charStart: 0,
      charEnd: 1,
    },
  ],
};

describe('SegmentView', () => {
  it('renders word token chips in token-chip mode (default)', () => {
    render(<SegmentView segment={WORD_SEGMENT} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(<SegmentView segment={PUNCT_SEGMENT} />);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders explicit token-chip mode the same as the default', () => {
    render(<SegmentView segment={WORD_SEGMENT} displayMode="token-chip" />);

    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(<SegmentView segment={WORD_SEGMENT} displayMode="baseline-text" />);

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(<SegmentView segment={WORD_SEGMENT} displayMode="baseline-text" />);

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(<SegmentView segment={WORD_SEGMENT} />);

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    render(<SegmentView segment={WORD_SEGMENT} isActive />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is false', () => {
    render(<SegmentView segment={WORD_SEGMENT} isActive={false} />);

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
  });

  it('does not set aria-current when isActive is omitted', () => {
    render(<SegmentView segment={WORD_SEGMENT} />);

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
  });

  it('calls onClick when the button is clicked', async () => {
    const handleClick = jest.fn();
    render(<SegmentView segment={WORD_SEGMENT} onClick={handleClick} />);

    await userEvent.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onClick is omitted and button is clicked', async () => {
    render(<SegmentView segment={WORD_SEGMENT} />);

    await userEvent.click(screen.getByRole('button'));
    // No assertion needed — test passes if no error is thrown
  });
});
