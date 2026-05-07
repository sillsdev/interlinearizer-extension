/** @file Unit tests for components/ContinuousView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import ContinuousView from '../../components/ContinuousView';

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

/**
 * A book whose GEN 1:1 segment has word tokens and whose GEN 1:2 segment has only a punctuation
 * token (no word tokens). Used to exercise code paths that run when a segment exists in the book
 * but contributes nothing to phraseEntries / segmentStartIndex.
 */
function makeMixedBook(): Book {
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
            id: 'mix-tok-0',
            surfaceText: 'In',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 2,
          },
        ],
      },
      {
        id: 'GEN 1:2',
        startRef: { book: 'GEN', chapter: 1, verse: 2 },
        endRef: { book: 'GEN', chapter: 1, verse: 2 },
        baselineText: '.',
        tokens: [
          {
            id: 'mix-punct-0',
            surfaceText: '.',
            writingSystem: 'en',
            type: 'punctuation',
            charStart: 0,
            charEnd: 1,
          },
        ],
      },
    ],
  };
}

/** A book where every token is non-word, so phraseEntries is empty. */
function makeWordFreeBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: '...',
        tokens: [
          {
            id: 'wf-punct-0',
            surfaceText: '.',
            writingSystem: 'en',
            type: 'punctuation',
            charStart: 0,
            charEnd: 1,
          },
        ],
      },
    ],
  };
}

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
  // These tests rely on the 500 ms fade-out timer that delays the focus jump.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

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
    // Advance past the fade-out delay so the pending focus jump fires.
    act(() => {
      jest.advanceTimersByTime(500);
    });

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
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Chapter 2 starts at index 1 (the last token), so right arrow should be disabled
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('calls scrollIntoView with instant behaviour when activeVerse changes', () => {
    // External jumps use behavior:'auto' (not 'smooth') to avoid double-animation with the
    // strip opacity fade that already plays during the jump.
    const { rerender } = render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }} />,
    );
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('initializes at the target verse position when activeVerse is provided at mount', () => {
    // makeBook(): GEN 1:1 at index 0-1, GEN 1:2 at index 2-3. Mounting with verse 2 should
    // start the strip focused at index 2 immediately (lazy useState initializer, no effect wait).
    render(
      <ContinuousView book={makeBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }} />,
    );

    // Index 2 is not the start (left enabled) and not the end (right enabled).
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
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
    // Must advance timers so the jump actually completes and the echo-back guard is exercised.
    jest.useFakeTimers();
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
    act(() => {
      jest.advanceTimersByTime(500);
    });
    jest.useRealTimers();

    expect(handleVerseChange).not.toHaveBeenCalled();
  });

  it('does not jump back when arrow navigation crosses a verse and the parent echoes activeVerse', async () => {
    // Regression: focusPhraseIndex was in the activeVerse effect's dep array, causing it to
    // re-run on every arrow press. When crossing a verse, onVerseChange fired, the parent
    // updated activeVerse, and the effect jumped back to the old verse — a loop.
    const handleVerseChange = jest.fn();
    const { rerender } = render(
      <ContinuousView book={makeBook()} onVerseChange={handleVerseChange} />,
    );

    // Advance twice from index 0 to index 2 (first token of GEN 1:2).
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 2 });

    // Parent echoes activeVerse = GEN 1:2. The strip is already there — no jump should fire.
    rerender(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={handleVerseChange}
      />,
    );

    // Focus stays at index 2: left arrow enabled, right arrow enabled (not at start or end).
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
    // onVerseChange must not have been called a second time (no loop).
    expect(handleVerseChange).toHaveBeenCalledTimes(1);
  });

  it('keeps clicked phrase focus when activeVerse updates to that same verse', async () => {
    const onVerseChange = jest.fn();
    const { rerender } = render(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
        onVerseChange={onVerseChange}
      />,
    );

    // Click the second phrase in GEN 1:2 ("God", index 3 in the full strip).
    const godToken = screen.getByText('God');
    const godPhraseBox = godToken.closest('[data-phrase-box="true"]');
    if (!godPhraseBox) throw new Error('Expected phrase box wrapper for token');
    await userEvent.click(godPhraseBox);

    // Parent receives verse change and updates activeVerse to GEN 1:2.
    expect(onVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 2 });
    rerender(
      <ContinuousView
        book={makeBook()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={onVerseChange}
      />,
    );

    // If focus was incorrectly reset to the first phrase of the verse ("beginning"), the right
    // arrow would be enabled. Staying on "God" keeps us at strip end, so it remains disabled.
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    expect(godPhraseBox).toHaveAttribute('data-focus-state', 'focused');
  });

  it('calls onVerseChange with the chapter-2 verse when crossing the chapter boundary', async () => {
    const handleVerseChange = jest.fn();
    render(<ContinuousView book={makeTwoChapterBook()} onVerseChange={handleVerseChange} />);
    handleVerseChange.mockClear();

    // ch1 has 1 token (index 0), ch2 starts at index 1 — one click crosses the boundary
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 2, verse: 1 });
  });

  it('does not call onVerseChange when book changes and focus resets to the first phrase', async () => {
    const handleVerseChange = jest.fn();
    const { rerender } = render(
      <ContinuousView book={makeBook()} onVerseChange={handleVerseChange} />,
    );

    // Move focus away from index 0 so book-switch reset path is exercised.
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    handleVerseChange.mockClear();

    const exoBook: Book = {
      ...makeBook(),
      id: 'EXO',
      bookRef: 'EXO',
      segments: makeBook().segments.map((seg) => ({
        ...seg,
        startRef: { ...seg.startRef, book: 'EXO' },
        endRef: { ...seg.endRef, book: 'EXO' },
      })),
    };

    rerender(<ContinuousView book={exoBook} onVerseChange={handleVerseChange} />);

    expect(handleVerseChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Non-word token rendering, word-free books, and word-free segment jumps
// ---------------------------------------------------------------------------

describe('ContinuousView non-word tokens and word-free paths', () => {
  it('renders a non-word token via TokenChip within the strip', () => {
    // makeMixedBook: GEN 1:1 has a word token; GEN 1:2 has a punctuation token
    render(<ContinuousView book={makeMixedBook()} />);

    // Both the word chip ("In") and the punctuation chip (".") must appear
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens (empty phraseEntries)', () => {
    render(<ContinuousView book={makeWordFreeBook()} />);

    // No phrase boxes rendered; both arrow buttons disabled (atStart && atEnd when length === 0)
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    // The punctuation token itself is rendered
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('does not jump when activeVerse targets a segment that has no word tokens', () => {
    // Start focused at GEN 1:1 (word token), then move activeVerse to GEN 1:2 (punctuation only).
    // getPhraseIndexForVerse should return undefined → no pending jump.
    jest.useFakeTimers();
    const { rerender } = render(
      <ContinuousView book={makeMixedBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }} />,
    );

    rerender(
      <ContinuousView book={makeMixedBook()} activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });
    jest.useRealTimers();

    // No jump occurred; focus stays at GEN 1:1 (index 0), so left arrow remains disabled.
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });
});
