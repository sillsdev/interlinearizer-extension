/** @file Unit tests for components/ContinuousView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, ScriptureRef, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import ContinuousView from '../../components/ContinuousView';
import { GlossStoreProvider } from '../../components/GlossStore';

// ---------------------------------------------------------------------------
// GlossStore mock — pass-through provider so GlossStore.tsx stays out of scope
// ---------------------------------------------------------------------------

jest.mock('../../components/GlossStore', () => ({
  __esModule: true,
  GlossStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
}));

/** Render options that wrap every test render in a `GlossStoreProvider`. */
const withGlossStore = { wrapper: GlossStoreProvider };

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  MemoizedInertTokenChip({ token }: Readonly<{ token: Token }>) {
    return <span>{token.surfaceText}</span>;
  },
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    index,
    isFocused = false,
    onFocusPhrase,
    tokens,
  }: Readonly<{
    index?: number;
    isFocused: boolean;
    onFocusPhrase?: (index?: number) => void;
    tokens: Token[];
  }>) => (
    <button
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
      onClick={() => onFocusPhrase?.(index)}
      type="button"
    >
      {tokens.map((t) => (
        <span key={t.id}>{t.surfaceText}</span>
      ))}
    </button>
  ),
}));

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
            ref: 'tok-0',
            surfaceText: 'In',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 2,
          },
          {
            ref: 'tok-1',
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
            ref: 'tok-2',
            surfaceText: 'beginning',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 9,
          },
          {
            ref: 'tok-3',
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

/**
 * Builds a two-chapter Book fixture: chapter 1 has one segment ("Alpha"), chapter 2 has one segment
 * ("Beta"). Used to exercise cross-chapter traversal and verse-jump behaviour.
 *
 * @returns A two-chapter Book.
 */
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
            ref: 'ch1-tok-0',
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
            ref: 'ch2-tok-0',
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

/**
 * Builds a Book with exactly one word token in one segment. Used to assert that both navigation
 * arrows are disabled when the strip has nowhere to move.
 *
 * @returns A single-token Book.
 */
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
            ref: 'tok-only',
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
 *
 * @returns A two-segment Book where the second segment has no word tokens.
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
            ref: 'mix-tok-0',
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
            ref: 'mix-punct-0',
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

/**
 * Builds a Book whose only token is punctuation, so phraseEntries is empty. Used to exercise the
 * code path where ContinuousView renders with no word tokens to navigate between.
 *
 * @returns A word-free Book.
 */
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
            ref: 'wf-punct-0',
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

/**
 * Builds a Book with `count` word tokens spread across one segment per token, each in GEN 1:N. Used
 * to exercise the phrase-window windowing code paths (PHRASE_WINDOW_HALF = 100 on each side).
 *
 * @param count - Total number of word-token segments to create.
 * @returns A Book with `count` single-token segments.
 */
function makeLargeBook(count: number): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: Array.from({ length: count }, (_, i) => ({
      id: `GEN 1:${i + 1}`,
      startRef: { book: 'GEN', chapter: 1, verse: i + 1 },
      endRef: { book: 'GEN', chapter: 1, verse: i + 1 },
      baselineText: `word${i}`,
      tokens: [
        {
          id: `large-tok-${i}`,
          surfaceText: `word${i}`,
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: String(`word${i}`).length,
        },
      ],
    })),
  };
}

// ---------------------------------------------------------------------------

const scrollIntoViewMock = jest.fn();

/**
 * Minimal required props for ContinuousView. Spread into render calls so tests only need to
 * override what they actually care about.
 *
 * @returns An object containing all required ContinuousView props set to no-op stubs.
 */
function requiredProps(): {
  activePhraseIndex: undefined;
  activeVerse: ScriptureRef;
  onFocusPhraseIndexChange: jest.Mock;
  onVerseChange: jest.Mock;
} {
  return {
    activePhraseIndex: undefined,
    activeVerse: { book: 'GEN', chapter: 1, verse: 1 },
    onFocusPhraseIndexChange: jest.fn(),
    onVerseChange: jest.fn(),
  };
}

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

describe('ContinuousView initial render', () => {
  it('renders all tokens from all segments as a flat list', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('beginning')).toBeInTheDocument();
    expect(screen.getByText('God')).toBeInTheDocument();
  });

  it('does not render any verse label or segment separator', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    // No verse numbers or colons that would indicate verse labels
    expect(screen.queryByText('1:1')).not.toBeInTheDocument();
    expect(screen.queryByText('1:2')).not.toBeInTheDocument();
    // Segment ids should not appear as text
    expect(screen.queryByText('GEN 1:1')).not.toBeInTheDocument();
  });

  it('renders a Previous token button and a Next token button', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeInTheDocument();
  });

  it('renders a non-word token via InertTokenChip within the strip', () => {
    // makeMixedBook: GEN 1:1 has a word token; GEN 1:2 has a punctuation token
    render(<ContinuousView book={makeMixedBook()} {...requiredProps()} />, withGlossStore);

    // Both the word chip ("In") and the inert chip (".") must appear
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens (empty phraseEntries)', () => {
    render(<ContinuousView book={makeWordFreeBook()} {...requiredProps()} />, withGlossStore);

    // The punctuation token is rendered
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens and activePhraseIndex is set', () => {
    render(
      <ContinuousView book={makeWordFreeBook()} {...requiredProps()} activePhraseIndex={0} />,
      withGlossStore,
    );

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('clicking an out-of-focus phrase box brings it into focus', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    const clickedPhraseBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    if (!clickedPhraseBox) throw new Error('Expected phrase box wrapper for token');
    expect(clickedPhraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();

    await userEvent.click(clickedPhraseBox);

    expect(clickedPhraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('clicking the already-focused phrase box leaves it focused', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    // The first token is focused by default.
    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');
    expect(firstPhraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();

    await userEvent.click(firstPhraseBox);

    // Still focused, still at the start.
    expect(firstPhraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Arrow disabled states
// ---------------------------------------------------------------------------

describe('ContinuousView arrow disabled states', () => {
  it('disables the prev arrow on initial render (book start)', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('enables the next arrow on initial render when there are multiple tokens', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
  });

  it('disables both arrows when the book has exactly one token', () => {
    render(<ContinuousView book={makeSingleTokenBook()} {...requiredProps()} />, withGlossStore);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
  });

  it('enables the prev arrow after clicking next once', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('disables the next arrow when advanced to the last token', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    // 4 tokens total: advance 3 times to reach index 3 (last)
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);

    expect(nextBtn).toBeDisabled();
  });

  it('re-enables the next arrow after going prev from the last token', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

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
  it('does not render prev fade at book start', () => {
    const { container } = render(
      <ContinuousView book={makeBook()} {...requiredProps()} />,
      withGlossStore,
    );

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const prevFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw:bg-linear-to-e'),
    );
    expect(prevFades).toHaveLength(0);
  });

  it('renders next fade at book start (next side is enabled)', () => {
    const { container } = render(
      <ContinuousView book={makeBook()} {...requiredProps()} />,
      withGlossStore,
    );

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const nextFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw:bg-linear-to-s'),
    );
    expect(nextFades).toHaveLength(1);
  });

  it('renders prev fade after moving away from book start', async () => {
    const { container } = render(
      <ContinuousView book={makeBook()} {...requiredProps()} />,
      withGlossStore,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const prevFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw:bg-linear-to-e'),
    );
    expect(prevFades).toHaveLength(1);
  });

  it('does not render next fade at book end', async () => {
    const { container } = render(
      <ContinuousView book={makeBook()} {...requiredProps()} />,
      withGlossStore,
    );

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);
    await userEvent.click(nextBtn);

    const gradients = container.querySelectorAll('[aria-hidden="true"]');
    const nextFades = Array.from(gradients).filter((el) =>
      el.className.includes('tw:bg-linear-to-s'),
    );
    expect(nextFades).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-chapter traversal
// ---------------------------------------------------------------------------

describe('ContinuousView cross-chapter traversal', () => {
  it('indexes tokens across chapter boundaries in segment order', () => {
    render(<ContinuousView book={makeTwoChapterBook()} {...requiredProps()} />, withGlossStore);

    // Both chapter tokens should be present
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('can navigate across a chapter boundary with the next arrow', async () => {
    render(<ContinuousView book={makeTwoChapterBook()} {...requiredProps()} />, withGlossStore);

    // Only one token per chapter, so clicking next once reaches chapter 2's token (index 1 = last)
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    // Next arrow should now be disabled (at end = last token = chapter 2 token)
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    // Prev arrow should be enabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Smooth-scroll intent
// ---------------------------------------------------------------------------

describe('ContinuousView smooth-scroll intent', () => {
  it('calls scrollIntoView with smooth behaviour when next arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('calls scrollIntoView with smooth behaviour when prev arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    scrollIntoViewMock.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });

  it('does not call scrollIntoView when a disabled arrow is clicked', async () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);
    scrollIntoViewMock.mockClear();

    // Prev arrow is disabled at start — clicking it should be a no-op
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
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
      withGlossStore,
    );

    // At index 0 the prev arrow should be disabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('jumps to the first token of the second segment when activeVerse points there', () => {
    // makeBook() has 4 tokens: index 0,1 in segment GEN 1:1 and index 2,3 in GEN 1:2
    const { rerender } = render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );

    rerender(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
      />,
    );
    // Advance past the fade-out delay so the pending focus jump fires.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // focusIndex is now 2 (first token of segment 2), so prev arrow should be enabled
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('jumps across a chapter boundary to the second chapter segment', () => {
    const { rerender } = render(
      <ContinuousView
        book={makeTwoChapterBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );

    rerender(
      <ContinuousView
        book={makeTwoChapterBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 2, verse: 1 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Chapter 2 starts at index 1 (the last token), so next arrow should be disabled
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('calls scrollIntoView with instant behaviour when activeVerse changes', () => {
    // External jumps use behavior:'auto' (not 'smooth') to avoid double-animation with the
    // strip opacity fade that already plays during the jump.
    const { rerender } = render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('does not call onVerseChange when activeVerse changes', () => {
    const { rerender } = render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );

    const handleVerseChange = jest.fn();
    rerender(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={handleVerseChange}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(handleVerseChange).not.toHaveBeenCalled();
  });

  it('initializes at the target verse position when activeVerse is provided at mount', () => {
    // makeBook(): GEN 1:1 at index 0-1, GEN 1:2 at index 2-3. Mounting with verse 2 should
    // start the strip focused at index 2 immediately (lazy useState initializer, no effect wait).
    render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
      />,
      withGlossStore,
    );

    // Index 2 is not the start (prev enabled) and not the end (next enabled).
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
  });

  it('does not jump when activeVerse is undefined', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    // Without activeVerse the strip stays at focusIndex 0
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('does not jump when activeVerse does not match any segment', () => {
    render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 99, verse: 99 }}
      />,
      withGlossStore,
    );

    // No matching segment — strip stays at focusIndex 0
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('does not jump when activeVerse targets a segment that has no word tokens', () => {
    // Start focused at GEN 1:1 (word token), then move activeVerse to GEN 1:2 (punctuation only).
    // getPhraseIndexForVerse should return undefined → no pending jump.
    const { rerender } = render(
      <ContinuousView
        book={makeMixedBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
      />,
    );

    rerender(
      <ContinuousView
        book={makeMixedBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // No jump occurred; focus stays at GEN 1:1 (index 0), so prev arrow remains disabled.
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// activePhraseIndex direct jump
// ---------------------------------------------------------------------------

describe('ContinuousView activePhraseIndex', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('jumps to the specified phrase index after the fade delay when activePhraseIndex changes', () => {
    const book = makeBook();
    const { rerender } = render(
      <ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />,
    );

    const phraseBtns = () =>
      screen.getAllByRole('button').filter((b) => b.dataset.phraseBox === 'true');

    expect(phraseBtns()[0]).toHaveAttribute('data-focus-state', 'focused');

    rerender(<ContinuousView book={book} {...requiredProps()} activePhraseIndex={1} />);
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(phraseBtns()[0]).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBtns()[1]).toHaveAttribute('data-focus-state', 'focused');
  });

  it('uses instant scrollIntoView behaviour after the fade completes', () => {
    const book = makeBook();
    render(
      <ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />,
      withGlossStore,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(globalThis.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' }),
    );
  });

  it('remains hidden while a second click overrides a pending jump mid-fade', () => {
    // Regression: when a second activePhraseIndex arrives before the first fade-out timer fires,
    // the RAF cleanup from the first jump must not reveal the strip prematurely.
    const book = makeBook();
    const { rerender } = render(
      <ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // First click — strip fades out; timer is pending.
    rerender(<ContinuousView book={book} {...requiredProps()} activePhraseIndex={1} />);

    // Second click before the first 500 ms timer fires — overrides the pending jump.
    rerender(<ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />);

    // Strip should still be hidden while the second fade-out timer is pending.
    expect(screen.getByTestId('token-strip')).toHaveClass('tw:opacity-0');
  });

  it('jumps to the correct phrase when a second click arrives before the first jump resolves', () => {
    // Regression: second click before the first fade timer fires must end at the second target, not
    // wherever the first jump would have landed.
    const book = makeBook();
    const { rerender } = render(
      <ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    const phraseBtns = () =>
      screen.getAllByRole('button').filter((b) => b.dataset.phraseBox === 'true');

    // First click to index 1.
    rerender(<ContinuousView book={book} {...requiredProps()} activePhraseIndex={1} />);

    // Second click back to index 0 before the first timer fires.
    rerender(<ContinuousView book={book} {...requiredProps()} activePhraseIndex={0} />);

    // Let the second fade-out timer fire.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(phraseBtns()[0]).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBtns()[1]).toHaveAttribute('data-focus-state', 'default');
  });
});

// ---------------------------------------------------------------------------
// onVerseChange outbound propagation
// ---------------------------------------------------------------------------

describe('ContinuousView onVerseChange propagation', () => {
  it('calls onVerseChange when the next arrow crosses into a new verse', async () => {
    // makeBook(): segment GEN 1:1 has tokens at index 0,1; GEN 1:2 starts at index 2
    const handleVerseChange = jest.fn();
    render(
      <ContinuousView book={makeBook()} {...requiredProps()} onVerseChange={handleVerseChange} />,
      withGlossStore,
    );

    // Advance twice to reach index 2 (first token of GEN 1:2)
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 2 });
  });

  it('calls onVerseChange when the prev arrow crosses back into a prior verse', async () => {
    const handleVerseChange = jest.fn();
    render(
      <ContinuousView
        book={makeBook()}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 2 }}
        onVerseChange={handleVerseChange}
      />,
      withGlossStore,
    );
    handleVerseChange.mockClear();

    // focusIndex is at 2 (first token of GEN 1:2); go prev to cross back to GEN 1:1
    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('does not call onVerseChange for multiple arrow clicks within the same verse', async () => {
    const handleVerseChange = jest.fn();
    render(
      <ContinuousView book={makeBook()} {...requiredProps()} onVerseChange={handleVerseChange} />,
      withGlossStore,
    );
    handleVerseChange.mockClear();

    // index 0 → index 1: both are in GEN 1:1, no verse change
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).not.toHaveBeenCalled();
  });

  it('calls onVerseChange with the chapter-2 verse when crossing the chapter boundary', async () => {
    const handleVerseChange = jest.fn();
    render(
      <ContinuousView
        book={makeTwoChapterBook()}
        {...requiredProps()}
        onVerseChange={handleVerseChange}
      />,
      withGlossStore,
    );
    handleVerseChange.mockClear();

    // ch1 has 1 token (index 0), ch2 starts at index 1 — one click crosses the boundary
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(handleVerseChange).toHaveBeenCalledWith({ book: 'GEN', chapter: 2, verse: 1 });
  });

  it('does not call onVerseChange when book changes and focus resets to the first phrase', async () => {
    const handleVerseChange = jest.fn();
    const { rerender } = render(
      <ContinuousView book={makeBook()} {...requiredProps()} onVerseChange={handleVerseChange} />,
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

    rerender(
      <ContinuousView book={exoBook} {...requiredProps()} onVerseChange={handleVerseChange} />,
    );

    expect(handleVerseChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RTL layout
// ---------------------------------------------------------------------------

describe('ContinuousView RTL layout', () => {
  beforeEach(() => {
    document.documentElement.dir = 'rtl';
  });

  afterEach(() => {
    document.documentElement.dir = 'ltr';
  });

  it('shows right-arrow (→) on the previous button in RTL mode', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    const prevBtn = screen.getByRole('button', { name: 'Previous token' });
    expect(prevBtn.querySelector('[aria-hidden="true"]')).toHaveTextContent('\u2192');
  });

  it('shows left-arrow (←) on the next button in RTL mode', () => {
    render(<ContinuousView book={makeBook()} {...requiredProps()} />, withGlossStore);

    const nextBtn = screen.getByRole('button', { name: 'Next token' });
    expect(nextBtn.querySelector('[aria-hidden="true"]')).toHaveTextContent('\u2190');
  });
});

// ---------------------------------------------------------------------------
// Phrase window — windowing branches (PHRASE_WINDOW_HALF = 100 on each side)
// ---------------------------------------------------------------------------

describe('ContinuousView phrase window', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('activates both windowing branches when the focused phrase is deep inside a large book', () => {
    // A book with 250 tokens: focusing phrase 125 means windowStart = 25 (> 0) and
    // windowEnd = 225 (< 249), exercising both the windowStartTokenIndex and
    // windowEndTokenIndex non-default branches.
    const book = makeLargeBook(250);
    render(
      <ContinuousView
        book={book}
        {...requiredProps()}
        activeVerse={{ book: 'GEN', chapter: 1, verse: 1 }}
        activePhraseIndex={125}
      />,
      withGlossStore,
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Phrase 125 is not at the start or end, so both arrows are enabled.
    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
  });
});
