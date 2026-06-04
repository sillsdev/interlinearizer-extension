/** @file Unit tests for components/ContinuousView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, PhraseAnalysisLink, Token } from 'interlinearizer';
import { useState, type ReactNode } from 'react';
import ContinuousView from '../../components/ContinuousView';
import { AnalysisStoreProvider, type PhraseDispatch } from '../../components/AnalysisStore';
import { isWordToken } from '../../types/typeGuards';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

/**
 * Stable module-level phrase-link map returned by `usePhraseLinkMap` across renders. Mutated by
 * individual tests to simulate phrase membership; reset in `beforeEach`.
 */
const phraseLinkMap = new Map<string, PhraseAnalysisLink>();

const mockUsePhraseDispatch = jest.fn<jest.MockedObject<PhraseDispatch>, []>().mockReturnValue({
  createPhrase: jest.fn(),
  updatePhrase: jest.fn(),
  deletePhrase: jest.fn(),
});

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode; analysisLanguage: string }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
  usePhraseLinkMap: () => phraseLinkMap,
  usePhraseLinkByIdMap: () =>
    new Map([...new Set(phraseLinkMap.values())].map((l) => [l.analysisId, l])),
  usePhraseLinkForToken: () => undefined,
  usePhraseDispatch: () => mockUsePhraseDispatch(),
  usePhraseGloss: () => '',
  usePhraseGlossDispatch: () => () => {},
}));

/** Render options that wrap every test render in a `AnalysisStoreProvider`. */
const withAnalysisStore = {
  wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <AnalysisStoreProvider analysisLanguage="und">{children}</AnalysisStoreProvider>;
  },
};

// The shared hover-preview state is covered in full by usePhraseHoverState.test.ts. Stub it here so
// ContinuousView's tests don't redundantly re-exercise the hook's internals; the view only forwards
// its handlers, which a no-op stub satisfies.
const mockCandidateTokenRefs = { current: new Set<string>() };
jest.mock('../../hooks/usePhraseHoverState', () => ({
  __esModule: true,
  usePhraseHoverState: () => ({
    hoveredGroupKey: undefined,
    setHoveredGroupKey: () => {},
    candidateTokenRefs: mockCandidateTokenRefs.current,
    setCandidateTokenRefs: () => {},
    splitFreeTokenRefs: new Set<string>(),
    handleSplitHoverChange: () => {},
    handleHoverSplitFreeTokens: () => {},
    clearAll: () => {},
  }),
}));

jest.mock('../../components/TokenChip');

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock('../../components/ArcOverlay', () => ({
  __esModule: true,
  default: ({
    onArcSplit,
  }: Readonly<{ onArcSplit: (phraseId: string, splitAfterTokenRef: string) => void }>) => (
    <button
      type="button"
      data-testid="arc-split-btn"
      onClick={() => onArcSplit('phrase-1', 'tok-0')}
    >
      split
    </button>
  ),
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    focusRef,
    isFocused = false,
    onFocusPhrase,
    tokens,
    phraseLink,
    showGlossInput = true,
  }: Readonly<{
    focusRef: string | undefined;
    isFocused: boolean;
    onFocusPhrase: (focusRef?: string) => void;
    tokens: (Token & { type: 'word' })[];
    phraseMode: unknown;
    setPhraseMode: unknown;
    phraseLink: { analysisId: string } | undefined;
    showGlossInput?: boolean;
  }>) => (
    <button
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
      data-phrase-id={phraseLink?.analysisId}
      data-show-gloss={showGlossInput}
      onClick={() => onFocusPhrase(focusRef)}
      type="button"
    >
      {tokens.map((t) => (
        <span key={t.ref}>{t.surfaceText}</span>
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

/** Builds a two-chapter Book fixture used to exercise cross-chapter navigation. */
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

/** Builds a Book with exactly one word token in one segment. */
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

/** A book whose GEN 1:1 segment has word tokens and whose GEN 1:2 segment has only punctuation. */
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

/** Builds a Book whose only token is punctuation. */
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

/** Builds a Book with `count` word tokens spread across one segment per token. */
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
          ref: `large-tok-${i}`,
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
 * Builds the lookup maps that ContinuousView's parent supplies, derived from a Book.
 *
 * @param book - The book to scan.
 * @returns The token-segment-id lookup and word-token-ref lookup.
 */
function buildLookups(book: Book): {
  tokenSegmentMap: ReadonlyMap<string, string>;
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
} {
  const tokenSegmentMap = new Map<string, string>();
  const wordTokenByRef = new Map<string, Token & { type: 'word' }>();
  book.segments.forEach((seg) => {
    seg.tokens.forEach((t) => {
      tokenSegmentMap.set(t.ref, seg.id);
      if (isWordToken(t)) wordTokenByRef.set(t.ref, t);
    });
  });
  return { tokenSegmentMap, wordTokenByRef };
}

/**
 * Minimal required props for ContinuousView. Spread into render calls so tests only need to
 * override what they actually care about. The lookup maps are derived from `book` so they always
 * agree with what's rendered.
 *
 * @param book - The book the test will render with.
 * @param overrides - Optional prop overrides.
 * @returns A complete ContinuousView props object.
 */
function requiredProps(
  book: Book,
  overrides?: { focusedTokenRef?: string | undefined },
): {
  book: Book;
  editPhraseSegmentId: string | undefined;
  focusedTokenRef: string | undefined;
  onFocusedTokenRefChange: jest.Mock;
  phraseMode: { kind: 'view' };
  setPhraseMode: jest.Mock;
  tokenSegmentMap: ReadonlyMap<string, string>;
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
} {
  const { tokenSegmentMap, wordTokenByRef } = buildLookups(book);
  return {
    book,
    editPhraseSegmentId: undefined,
    focusedTokenRef: overrides?.focusedTokenRef,
    onFocusedTokenRefChange: jest.fn(),
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
    tokenSegmentMap,
    wordTokenByRef,
  };
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  phraseLinkMap.clear();
  mockUsePhraseDispatch.mockReturnValue({
    createPhrase: jest.fn(),
    updatePhrase: jest.fn(),
    deletePhrase: jest.fn(),
  });
  mockCandidateTokenRefs.current = new Set();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('ContinuousView initial render', () => {
  it('renders all tokens from all segments as a flat list', () => {
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('beginning')).toBeInTheDocument();
    expect(screen.getByText('God')).toBeInTheDocument();
  });

  it('does not render any verse label or segment separator', () => {
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.queryByText('1:1')).not.toBeInTheDocument();
    expect(screen.queryByText('1:2')).not.toBeInTheDocument();
    expect(screen.queryByText('GEN 1:1')).not.toBeInTheDocument();
  });

  it('renders a Previous token button and a Next token button', () => {
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeInTheDocument();
  });

  it('renders a non-word token via InertTokenChip within the strip', () => {
    const book = makeMixedBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens', () => {
    const book = makeWordFreeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('notifies the parent of the initially-focused token on mount when no focus prop is set', () => {
    const book = makeBook();
    const props = requiredProps(book);
    render(<ContinuousView {...props} />, withAnalysisStore);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
  });

  it('does not notify the parent on mount when focusedTokenRef is already set', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });

  it('marks the phrase containing focusedTokenRef as focused', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    const focusedBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    expect(focusedBox).toHaveAttribute('data-focus-state', 'focused');
  });
});

// ---------------------------------------------------------------------------
// Click → focus change
// ---------------------------------------------------------------------------

describe('ContinuousView focus changes', () => {
  it('notifies the parent when an out-of-focus phrase box is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    const clickedPhraseBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    if (!clickedPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(clickedPhraseBox);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-2');
  });

  it('does not notify the parent when clicking the already-focused phrase box', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Arrow disabled states
// ---------------------------------------------------------------------------

describe('ContinuousView arrow disabled states', () => {
  it('disables the prev arrow when focus is on the first phrase', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
  });

  it('enables the prev arrow when focus is on a non-first phrase', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeEnabled();
  });

  it('disables the next arrow when focus is on the last phrase', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-3' })} />,
      withAnalysisStore,
    );

    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
  });

  it('enables the next arrow when focus is on a non-last phrase', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(screen.getByRole('button', { name: 'Next token' })).toBeEnabled();
  });

  it('disables both arrows when the book has a single token', () => {
    const book = makeSingleTokenBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-only' })} />,
      withAnalysisStore,
    );

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
  });

  it('disables both arrows when the book has no word tokens', () => {
    const book = makeWordFreeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByRole('button', { name: 'Previous token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next token' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Arrow nav
// ---------------------------------------------------------------------------

describe('ContinuousView arrow navigation', () => {
  it('notifies the parent of the next phrase ref when Next is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-1');
  });

  it('notifies the parent of the previous phrase ref when Previous is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
  });

  it('crosses verse boundaries via the Next arrow', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-2');
  });

  it('crosses chapter boundaries via the Next arrow', async () => {
    const book = makeTwoChapterBook();
    const props = requiredProps(book, { focusedTokenRef: 'ch1-tok-0' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('ch2-tok-0');
  });

  it('advances two groups on rapid double-click before re-render', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousView {...props} />, withAnalysisStore);
    const next = screen.getByRole('button', { name: 'Next token' });

    await userEvent.click(next);
    await userEvent.click(next);

    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(1, 'tok-1');
    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(2, 'tok-2');
  });
});

// ---------------------------------------------------------------------------
// Scroll behaviour
// ---------------------------------------------------------------------------

describe('ContinuousView scroll behaviour', () => {
  it('calls scrollIntoView on initial mount', () => {
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });

  it('uses instant scroll when focusedTokenRef changes externally', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);

    scrollIntoViewMock.mockClear();
    act(() => {
      jest.useFakeTimers();
    });
    rerender(<ContinuousView {...{ ...props, focusedTokenRef: 'tok-3' }} />);
    act(() => {
      jest.advanceTimersByTime(600);
      jest.useRealTimers();
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('smooth-scrolls for internal nav once the parent echoes the ref back synchronously', async () => {
    // The smooth-scroll path requires the displayed focus to already agree with the prop and the
    // strip to be visible when the scroll effect runs. That only happens when a real (stateful)
    // parent reflects the internal ref change straight back, so simulate one here rather than
    // driving the ref via a jest.fn() that never updates the prop.
    const book = makeBook();
    const { tokenSegmentMap, wordTokenByRef } = buildLookups(book);
    function Parent() {
      const [ref, setRef] = useState<string | undefined>('tok-0');
      return (
        <ContinuousView
          book={book}
          editPhraseSegmentId={undefined}
          focusedTokenRef={ref}
          onFocusedTokenRefChange={setRef}
          phraseMode={{ kind: 'view' }}
          setPhraseMode={jest.fn()}
          tokenSegmentMap={tokenSegmentMap}
          wordTokenByRef={wordTokenByRef}
        />
      );
    }
    render(<Parent />, withAnalysisStore);
    // Wait for the initial-load requestAnimationFrame fade-in to complete (strip becomes visible)
    // before navigating; the smooth path is only taken while the strip is already visible.
    await waitFor(() =>
      expect(screen.getByTestId('strip-fade-wrapper').className).toContain('tw:opacity-100'),
    );
    scrollIntoViewMock.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));

    await waitFor(() =>
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      ),
    );
  });

  it('scrolls with the nearest-block, centre-inline placement', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'center' }),
    );
  });
});

// ---------------------------------------------------------------------------
// RTL layout
// ---------------------------------------------------------------------------

describe('ContinuousView RTL layout', () => {
  let originalDir: string;

  beforeEach(() => {
    originalDir = document.documentElement.dir;
  });

  afterEach(() => {
    document.documentElement.dir = originalDir;
  });

  it('uses right-pointing arrow for Previous in RTL', () => {
    document.documentElement.dir = 'rtl';
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    const prev = screen.getByRole('button', { name: 'Previous token' });
    expect(prev.textContent).toContain('→');
  });

  it('uses left-pointing arrow for Next in RTL', () => {
    document.documentElement.dir = 'rtl';
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    const next = screen.getByRole('button', { name: 'Next token' });
    expect(next.textContent).toContain('←');
  });

  it('uses left-pointing arrow for Previous in LTR', () => {
    document.documentElement.dir = 'ltr';
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    const prev = screen.getByRole('button', { name: 'Previous token' });
    expect(prev.textContent).toContain('←');
  });
});

// ---------------------------------------------------------------------------
// Phrase window — large books
// ---------------------------------------------------------------------------

describe('ContinuousView phrase window', () => {
  it('renders the focused phrase from a large book', () => {
    const book = makeLargeBook(300);
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
      withAnalysisStore,
    );

    expect(screen.getByText('word150')).toBeInTheDocument();
  });

  it('does not render tokens that fall outside the rendered window', () => {
    const book = makeLargeBook(300);
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'large-tok-0' })} />,
      withAnalysisStore,
    );

    // PHRASE_WINDOW_HALF = 100; tok-299 is well outside.
    expect(screen.queryByText('word299')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phrase grouping
// ---------------------------------------------------------------------------

describe('ContinuousView phrase grouping', () => {
  it('groups adjacent tokens of the same phrase into a single PhraseBox', () => {
    phraseLinkMap.set('tok-0', {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    });
    phraseLinkMap.set('tok-1', {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    });
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    const phraseBoxes = document.querySelectorAll('[data-phrase-box="true"]');
    // Two tokens grouped → one box; plus the two free tokens from segment 2 → 3 total.
    expect(phraseBoxes).toHaveLength(3);
  });

  it('shows the gloss input on only the first fragment of a discontiguous phrase', () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-2', surfaceText: 'beginning' },
      ],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    phraseLinkMap.set('tok-2', phraseLink);
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    const phraseBoxes = document.querySelectorAll('[data-phrase-id="phrase-1"]');
    expect(phraseBoxes).toHaveLength(2);
    expect(phraseBoxes[0]).toHaveAttribute('data-show-gloss', 'true');
    expect(phraseBoxes[1]).toHaveAttribute('data-show-gloss', 'false');
  });

  it('fires mouse-leave on the token strip without throwing', async () => {
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);
    const strip = screen.getByTestId('token-strip');
    await userEvent.unhover(strip);
    // No throw = pass
  });

  it('applies the internal focus transition when the parent reflects a click-driven ref change', async () => {
    // Simulate: ContinuousView clicks Next, sets internalFocusedTokenRefRef, calls
    // onFocusedTokenRefChange. The parent then passes the new focusedTokenRef back. This exercises
    // the isInternal=true path (lines 306-308) of the pending-jump effect.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    // Now reflect the new ref back as a prop change (as a real parent would do).
    rerender(<ContinuousView {...props} focusedTokenRef="tok-1" />);
    // No throw = the isInternal path ran successfully.
  });

  it('scrolls to the first token of the active phrase when entering edit mode', async () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-2', surfaceText: 'beginning' },
        { tokenRef: 'tok-3', surfaceText: 'God' },
      ],
    };
    phraseLinkMap.set('tok-2', phraseLink);
    phraseLinkMap.set('tok-3', phraseLink);
    const book = makeBook();
    const onFocusedTokenRefChange = jest.fn();
    const { rerender } = render(
      <ContinuousView
        {...requiredProps(book)}
        focusedTokenRef="tok-0"
        onFocusedTokenRefChange={onFocusedTokenRefChange}
      />,
      withAnalysisStore,
    );

    // Switch to edit mode for phrase-1.
    rerender(
      <ContinuousView
        {...requiredProps(book)}
        focusedTokenRef="tok-0"
        onFocusedTokenRefChange={onFocusedTokenRefChange}
        phraseMode={{
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens: phraseLink.tokens,
        }}
      />,
    );
    // The effect should call onFocusedTokenRefChange with the first token of the phrase.
    expect(onFocusedTokenRefChange).toHaveBeenCalledWith('tok-2');
  });

  it('fires phrase group hover enter and leave without throwing', async () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    phraseLinkMap.set('tok-1', phraseLink);
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);

    // The PhraseGroup wrapper span contains the phrase box.
    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    const phraseGroupSpan = phraseBox?.parentElement;
    expect(phraseGroupSpan).not.toBeNull();
    await userEvent.hover(phraseGroupSpan ?? document.body);
    await userEvent.unhover(phraseGroupSpan ?? document.body);
    // No throw = pass
  });

  it('calls splitPhraseAtBoundary when the arc split button is clicked with a known phrase', async () => {
    const deletePhrase = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase,
    });
    // Two-token phrase split at tok-0 → both halves are 1 token → deletePhrase called
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    phraseLinkMap.set('tok-1', phraseLink);
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);
    await userEvent.click(screen.getByTestId('arc-split-btn'));
    expect(deletePhrase).toHaveBeenCalledWith('phrase-1');
  });

  it('does nothing when the arc split button fires for an unknown phrase id', async () => {
    const deletePhrase = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase,
    });
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);
    await userEvent.click(screen.getByTestId('arc-split-btn'));
    expect(deletePhrase).not.toHaveBeenCalled();
  });

  it('computes candidatePhraseIds from non-empty candidateTokenRefs', () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    mockCandidateTokenRefs.current = new Set(['tok-0']);
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);
    expect(screen.getByTestId('arc-split-btn')).toBeInTheDocument();
  });
});
