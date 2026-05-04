/** @file Unit tests for components/ContinuousView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import ContinuousView from '../components/ContinuousView';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Factory for a single-chapter book with two segments each having two word tokens. */
function makeBook(overrides?: Partial<Book>): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: 'In the',
        tokens: [
          {
            id: 'tok-0',
            surfaceText: 'In',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 2,
          },
          {
            id: 'tok-1',
            surfaceText: 'the',
            writingSystem: 'en',
            type: 'word',
            charStart: 3,
            charEnd: 6,
          },
        ],
      },
      {
        id: 'GEN 1:2',
        startRef: { book: 'GEN', chapter: 1, verse: 2 },
        endRef: { book: 'GEN', chapter: 1, verse: 2 },
        baselineText: 'beginning God',
        tokens: [
          {
            id: 'tok-2',
            surfaceText: 'beginning',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 9,
          },
          {
            id: 'tok-3',
            surfaceText: 'God',
            writingSystem: 'en',
            type: 'word',
            charStart: 10,
            charEnd: 13,
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** A two-chapter book: chapter 1 has one segment, chapter 2 has one segment. */
function makeTwoChapterBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: 'Alpha',
        tokens: [
          {
            id: 'ch1-tok-0',
            surfaceText: 'Alpha',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 5,
          },
        ],
      },
      {
        id: 'GEN 2:1',
        startRef: { book: 'GEN', chapter: 2, verse: 1 },
        endRef: { book: 'GEN', chapter: 2, verse: 1 },
        baselineText: 'Beta',
        tokens: [
          {
            id: 'ch2-tok-0',
            surfaceText: 'Beta',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 4,
          },
        ],
      },
    ],
  };
}

/** A book with exactly one token (minimal edge case). */
function makeSingleTokenBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: 'Word',
        tokens: [
          {
            id: 'tok-only',
            surfaceText: 'Word',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 4,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// scrollIntoView mock
// ---------------------------------------------------------------------------

const scrollIntoViewMock = jest.fn();

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

beforeEach(() => {
  scrollIntoViewMock.mockClear();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('ContinuousView rendering', () => {
  it('renders all tokens from all segments as a flat list', () => {
    render(<ContinuousView book={makeBook()} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('beginning')).toBeInTheDocument();
    expect(screen.getByText('God')).toBeInTheDocument();
  });

  it('renders tokens from both chapters in a two-chapter book', () => {
    render(<ContinuousView book={makeTwoChapterBook()} />);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('does not render any verse label or segment separator', () => {
    render(<ContinuousView book={makeBook()} />);

    // No verse numbers or colons that would indicate verse labels
    expect(screen.queryByText('1:1')).not.toBeInTheDocument();
    expect(screen.queryByText('1:2')).not.toBeInTheDocument();
    // Segment ids should not appear as text
    expect(screen.queryByText('GEN 1:1')).not.toBeInTheDocument();
  });

  it('renders a Previous token button and a Next token button', () => {
    render(<ContinuousView book={makeBook()} />);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeInTheDocument();
  });

  it('clicking an out-of-focus phrase box brings it into focus', async () => {
    render(<ContinuousView book={makeBook()} />);

    const clickedToken = screen.getByText('beginning');
    const clickedPhraseBox = clickedToken.closest('[data-phrase-box="true"]');
    if (!clickedPhraseBox) throw new Error('Expected phrase box wrapper for token');
    expect(clickedPhraseBox).toHaveAttribute('data-focus-state', 'default');

    await userEvent.click(clickedPhraseBox);

    expect(clickedPhraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Arrow disabled states
// ---------------------------------------------------------------------------

describe('ContinuousView arrow disabled states', () => {
  it('disables the left arrow on initial render (book start)', () => {
    render(<ContinuousView book={makeBook()} />);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('enables the right arrow on initial render when there are multiple tokens', () => {
    render(<ContinuousView book={makeBook()} />);

    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
  });

  it('disables both arrows when the book has exactly one token', () => {
    render(<ContinuousView book={makeSingleTokenBook()} />);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
  });

  it('enables the left arrow after clicking right once', async () => {
    render(<ContinuousView book={makeBook()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('disables the right arrow when advanced to the last token', async () => {
    render(<ContinuousView book={makeBook()} />);

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    // 4 tokens total: advance 3 times to reach index 3 (last)
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);

    expect(nextBtn).toBeDisabled();
  });

  it('re-enables the right arrow after going left from the last token', async () => {
    render(<ContinuousView book={makeBook()} />);

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    // Now at end
    expect(nextBtn).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(nextBtn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Fade overlays
// ---------------------------------------------------------------------------

describe('ContinuousView fade overlays', () => {
  it('does not render left fade at book start', () => {
    const { container } = render(<ContinuousView book={makeBook()} />);

    // Left fade gradient is tw-from-background (left-to-right gradient)
    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const leftFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw-bg-gradient-to-r'),
    );
    expect(leftFades).toHaveLength(0);
  });

  it('renders right fade at book start (right side is enabled)', () => {
    const { container } = render(<ContinuousView book={makeBook()} />);

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const rightFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw-bg-gradient-to-l'),
    );
    expect(rightFades).toHaveLength(1);
  });

  it('renders left fade after moving away from book start', async () => {
    const { container } = render(<ContinuousView book={makeBook()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const leftFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw-bg-gradient-to-r'),
    );
    expect(leftFades).toHaveLength(1);
  });

  it('does not render right fade at book end', async () => {
    const { container } = render(<ContinuousView book={makeBook()} />);

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const rightFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw-bg-gradient-to-l'),
    );
    expect(rightFades).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-chapter traversal
// ---------------------------------------------------------------------------

describe('ContinuousView cross-chapter traversal', () => {
  it('indexes tokens across chapter boundaries in segment order', () => {
    render(<ContinuousView book={makeTwoChapterBook()} />);

    // Both chapter tokens should be present
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('can navigate across a chapter boundary with the right arrow', async () => {
    render(<ContinuousView book={makeTwoChapterBook()} />);

    // Only one token per chapter, so clicking right once reaches chapter 2's token (index 1 = last)
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    // Right arrow should now be disabled (at end = last token = chapter 2 token)
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    // Left arrow should be enabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Smooth-scroll intent
// ---------------------------------------------------------------------------

describe('ContinuousView smooth-scroll intent', () => {
  it('calls scrollIntoView with smooth behaviour when right arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('calls scrollIntoView with smooth behaviour when left arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    scrollIntoViewMock.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('does not call scrollIntoView when a disabled arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} />);
    scrollIntoViewMock.mockClear();

    // Left arrow is disabled at start — clicking it should be a no-op
    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// activeVerse / verse-jump behaviour
// ---------------------------------------------------------------------------

describe('ContinuousView activeVerse verse-jump', () => {
  it('positions at focusIndex 0 when activeVerse matches the first segment', () => {
    render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }} />,
    );

    // At index 0 the left arrow should be disabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('jumps to the first token of the second segment when activeVerse points there', () => {
    // makeBook() has 4 tokens: index 0,1 in segment GEN 1:1 and index 2,3 in GEN 1:2
    const { rerender } = render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }} />,
    );

    rerender(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }} />,
    );

    // focusIndex is now 2 (first token of segment 2), so left arrow should be enabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('jumps across a chapter boundary to the second chapter segment', () => {
    const { rerender } = render(
      <ContinuousView
        book={makeTwoChapterBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );

    rerender(
      <ContinuousView
        book={makeTwoChapterBook()}
        activeVerse={{ book: 'GEN', chapter: 2, verse: 1 }}
      />,
    );

    // Chapter 2 starts at index 1 (the last token), so right arrow should be disabled
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('calls scrollIntoView when activeVerse changes', () => {
    const { rerender } = render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }} />,
    );
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }} />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('does not jump when activeVerse is undefined', () => {
    render(<ContinuousView book={makeBook()} />);

    // Without activeVerse the strip stays at focusIndex 0
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('does not jump when activeVerse does not match any segment', () => {
    render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 99, verse: 99 }} />,
    );

    // No matching segment — strip stays at focusIndex 0
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// onVerseChange outbound propagation
// ---------------------------------------------------------------------------

describe('ContinuousView onVerseChange propagation', () => {
  it('calls onVerseChange when the right arrow crosses into a new verse', async () => {
    // makeBook(): segment GEN 1:1 has tokens at index 0,1; GEN 1:2 starts at index 2
    const handleVerseChange = jest.fn();
    render(<ContinuousView book={makeBook()} onVerseChange={handleVerseChange} />);

    // Advance twice to reach index 2 (first token of GEN 1:2)
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 2 });
  });

  it('calls onVerseChange when the left arrow crosses back into a prior verse', async () => {
    const handleVerseChange = jest.fn();
    render(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={handleVerseChange}
      />,
    );
    handleVerseChange.mockClear();

    // focusIndex is at 2 (first token of GEN 1:2); go left to cross back to GEN 1:1
    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('does not call onVerseChange for multiple arrow clicks within the same verse', async () => {
    const handleVerseChange = jest.fn();
    render(<ContinuousView book={makeBook()} onVerseChange={handleVerseChange} />);
    handleVerseChange.mockClear();

    // index 0 → index 1: both are in GEN 1:1, no verse change
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).not.toHaveBeenCalled();
  });

  it('does not call onVerseChange when activeVerse prop drives the jump', () => {
    const handleVerseChange = jest.fn();
    const { rerender } = render(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
        onVerseChange={handleVerseChange}
      />,
    );
    handleVerseChange.mockClear();

    rerender(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={handleVerseChange}
      />,
    );

    expect(handleVerseChange).not.toHaveBeenCalled();
  });

  it('calls onVerseChange with the chapter-2 verse when crossing the chapter boundary', async () => {
    const handleVerseChange = jest.fn();
    render(<ContinuousView book={makeTwoChapterBook()} onVerseChange={handleVerseChange} />);
    handleVerseChange.mockClear();

    // ch1 has 1 token (index 0), ch2 starts at index 1 — one click crosses the boundary
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 2, verse: 1 });
  });
});
