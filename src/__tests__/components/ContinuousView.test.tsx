/** @file Unit tests for components/ContinuousView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, PhraseAnalysisLink, Token } from 'interlinearizer';
import { useState, type ReactNode } from 'react';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import ContinuousView from '../../components/ContinuousView';
import { isWordToken } from '../../types/type-guards';
import type { ViewOptions } from '../../types/view-options';
import { allFalseViewOptions, withAnalysisStore } from './test-helpers';

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
  mergePhrases: jest.fn(),
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

/**
 * Spy invoked once per rendered link icon (mounted, whether suppressed or not). Rendering a span
 * with data attributes encoding the token refs lets DOM queries check suppression state via the
 * parent wrapper's style. Cleared in `beforeEach`.
 */
const tokenLinkIconSpy = jest.fn();
jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: (props: Readonly<{ prevToken?: { ref: string }; nextToken?: { ref: string } }>) => {
    tokenLinkIconSpy(props);
    return (
      <span
        data-testid="mock-link-icon"
        data-prev-ref={props.prevToken?.ref}
        data-next-ref={props.nextToken?.ref}
      />
    );
  },
}));

jest.mock('../../components/ArcOverlay', () => ({
  __esModule: true,
  // Surface the props ContinuousView derives and forwards (hoveredPhraseId, candidatePhraseIds) as
  // data attributes so DOM queries can assert on values that otherwise only live inside ArcOverlay.
  default: ({
    onArcSplit,
    hoveredPhraseId,
    candidatePhraseIds,
  }: Readonly<{
    onArcSplit: (phraseId: string, splitAfterTokenRef: string) => void;
    hoveredPhraseId: string | undefined;
    candidatePhraseIds: ReadonlySet<string>;
  }>) => (
    <button
      type="button"
      data-testid="arc-split-btn"
      data-hovered-phrase-id={hoveredPhraseId ?? ''}
      data-candidate-phrase-ids={[...candidatePhraseIds].join(',')}
      onClick={() => onArcSplit('phrase-1', 'tok-0')}
    >
      split
    </button>
  ),
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    groupKey,
    isFocused = false,
    onFocusPhrase,
    tokens,
    phraseLink,
    showGlossInput = true,
  }: Readonly<{
    groupKey: string;
    isFocused: boolean;
    onFocusPhrase: (groupKey: string) => void;
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
      onClick={() => onFocusPhrase(groupKey)}
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
  tokenDocOrder: ReadonlyMap<string, number>;
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
} {
  const tokenSegmentMap = new Map<string, string>();
  const tokenDocOrder = new Map<string, number>();
  const wordTokenByRef = new Map<string, Token & { type: 'word' }>();
  let wordIndex = 0;
  book.segments.forEach((seg) => {
    seg.tokens.forEach((t) => {
      tokenSegmentMap.set(t.ref, seg.id);
      if (isWordToken(t)) {
        wordTokenByRef.set(t.ref, t);
        tokenDocOrder.set(t.ref, wordIndex);
        wordIndex += 1;
      }
    });
  });
  return { tokenSegmentMap, tokenDocOrder, wordTokenByRef };
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
  tokenDocOrder: ReadonlyMap<string, number>;
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  viewOptions: ViewOptions;
} {
  const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
  return {
    book,
    editPhraseSegmentId: undefined,
    focusedTokenRef: overrides?.focusedTokenRef,
    onFocusedTokenRefChange: jest.fn(),
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
    tokenSegmentMap,
    tokenDocOrder,
    wordTokenByRef,
    viewOptions: { ...allFalseViewOptions },
  };
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

beforeEach(() => {
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      Object.fromEntries(keys.map((k) => [k, k])),
      false,
    ]);
  scrollIntoViewMock.mockClear();
  tokenLinkIconSpy.mockClear();
  phraseLinkMap.clear();
  mockUsePhraseDispatch.mockReturnValue({
    createPhrase: jest.fn(),
    updatePhrase: jest.fn(),
    deletePhrase: jest.fn(),
    mergePhrases: jest.fn(),
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

  it('falls back to focusedTokenRef when the lagging displayed ref is from another book', () => {
    // During a book change displayFocusedTokenRef lags by one fade, so it briefly names a token from
    // the previous book that no longer exists in the new book. The focus must follow the live
    // focusedTokenRef (the new book's active verse) rather than collapsing to the book's first phrase.
    const book = makeBook();
    const { rerender } = render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    // Swap to a different book whose token refs share none of the previous book's. The displayed ref
    // ('tok-2') is now absent; focusedTokenRef points at the new book's *second* phrase.
    const otherBook: Book = {
      id: 'MAT',
      bookRef: 'MAT',
      textVersion: '1',
      segments: [
        {
          id: 'MAT 1:1',
          startRef: { book: 'MAT', chapter: 1, verse: 1 },
          endRef: { book: 'MAT', chapter: 1, verse: 1 },
          baselineText: 'Alpha',
          tokens: [
            {
              ref: 'mat-tok-0',
              surfaceText: 'Alpha',
              writingSystem: 'en',
              type: 'word',
              charStart: 0,
              charEnd: 5,
            },
          ],
        },
        {
          id: 'MAT 1:2',
          startRef: { book: 'MAT', chapter: 1, verse: 2 },
          endRef: { book: 'MAT', chapter: 1, verse: 2 },
          baselineText: 'Beta',
          tokens: [
            {
              ref: 'mat-tok-1',
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

    scrollIntoViewMock.mockClear();
    rerender(<ContinuousView {...requiredProps(otherBook, { focusedTokenRef: 'mat-tok-1' })} />);

    // The scroll target is resolved through focusPhraseIndex, which falls back to focusedTokenRef
    // ('mat-tok-1', the second phrase) rather than collapsing to phrase 0. So the element scrolled
    // into view is the one containing "Beta", never "Alpha".
    const scrolledTexts = scrollIntoViewMock.mock.contexts.map((el) =>
      el instanceof HTMLElement ? el.textContent : undefined,
    );
    expect(scrolledTexts.some((t) => t?.includes('Beta'))).toBe(true);
    expect(scrolledTexts.some((t) => t?.includes('Alpha'))).toBe(false);
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

  it('does not notify the parent when clicking the group of an already-focused non-first token', async () => {
    // Group tok-0 and tok-1 into one phrase box (keyed by tok-0), then focus tok-1 — the second
    // token of the group, as a segment-view click on a middle token would. Clicking the box must
    // stay a no-op even though its groupKey (tok-0) differs from focusedTokenRef (tok-1).
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
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousView {...props} />, withAnalysisStore);

    const groupedBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!groupedBox) throw new Error('Expected phrase box wrapper for grouped tokens');

    await userEvent.click(groupedBox);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });

  it('notifies the parent when clicking a phrase box while nothing is focused', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: undefined });
    render(<ContinuousView {...props} />, withAnalysisStore);

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
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

  it('steps from the externally-imposed focus, not the stale pending index, after an external change interrupts an in-flight internal nav', async () => {
    // Sequence: an external nav (tok-3) starts its fade while tok-1 is still displayed; the user
    // clicks Next during the fade (internal nav in flight — this parent never echoes it); then a
    // second external change lands back on the still-displayed tok-1. Because that value equals the
    // displayed ref, the focus-change effect early-returns without clearing the in-flight marker,
    // so only the render-phase external-override detection resyncs the pending index. Without it,
    // the next step would advance from the stale pending index (group 2 → tok-1) instead of the
    // externally-imposed position (group 1 → tok-0).
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);

    // External nav while idle: the fade starts; the displayed focus is still tok-1.
    rerender(<ContinuousView {...props} focusedTokenRef="tok-3" />);
    // Internal nav in flight: Next from the displayed group (tok-1) emits tok-2.
    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(1, 'tok-2');

    // The parent imposes an external position (not the tok-2 echo) that matches the displayed ref.
    rerender(<ContinuousView {...props} focusedTokenRef="tok-1" />);

    await userEvent.click(screen.getByRole('button', { name: 'Previous token' }));
    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(2, 'tok-0');
  });
});

// ---------------------------------------------------------------------------
// Scroll behavior
// ---------------------------------------------------------------------------

describe('ContinuousView scroll behavior', () => {
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

  it('snaps the link slots (no transition) during an external jump so they do not slide after the fade-in', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { container, rerender } = render(<ContinuousView {...props} />, withAnalysisStore);

    act(() => {
      jest.useFakeTimers();
    });
    // External nav into the other verse: the active segment commits instantly behind the fade, so
    // the slots must snap to their new widths rather than animating (which would slide the boxes for
    // ~200ms after the strip fades back in).
    rerender(<ContinuousView {...{ ...props, focusedTokenRef: 'tok-3' }} />);

    const slotWrapper = container.querySelector('[data-link-slot] > span');
    if (!(slotWrapper instanceof HTMLElement)) throw new Error('Expected a link-slot wrapper span');
    expect(slotWrapper.style.transitionDuration).toBe('0ms');

    act(() => {
      jest.advanceTimersByTime(600);
      jest.useRealTimers();
    });
  });

  it('smooth-scrolls for internal nav once the parent echoes the ref back synchronously', async () => {
    // The smooth-scroll path requires the displayed focus to already agree with the prop and the
    // strip to be visible when the scroll effect runs. That only happens when a real (stateful)
    // parent reflects the internal ref change straight back, so simulate one here rather than
    // driving the ref via a jest.fn() that never updates the prop.
    const book = makeBook();
    const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
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
          tokenDocOrder={tokenDocOrder}
          wordTokenByRef={wordTokenByRef}
          viewOptions={{ ...allFalseViewOptions }}
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

  /**
   * Renders ContinuousView with `hideInactiveLinkButtons` on, focused at tok-1 (the last phrase of
   * GEN 1:1) so a single Next step crosses into GEN 1:2. The slot between tok-0 and tok-1 lives in
   * GEN 1:1 and shows a link icon only while that segment is active, so it's a clean probe for
   * whether the active-segment relayout has committed.
   *
   * @returns A predicate reporting whether that in-segment link icon mounted in the latest render.
   */
  function renderHideInactiveCrossing(): () => boolean {
    const book = makeBook();
    const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
    function Parent() {
      const [ref, setRef] = useState<string | undefined>('tok-1');
      return (
        <ContinuousView
          book={book}
          editPhraseSegmentId={undefined}
          focusedTokenRef={ref}
          onFocusedTokenRefChange={setRef}
          phraseMode={{ kind: 'view' }}
          setPhraseMode={jest.fn()}
          tokenSegmentMap={tokenSegmentMap}
          tokenDocOrder={tokenDocOrder}
          wordTokenByRef={wordTokenByRef}
          viewOptions={{ ...allFalseViewOptions, hideInactiveLinkButtons: true }}
        />
      );
    }
    render(<Parent />, withAnalysisStore);
    // Returns true when the tok-0/tok-1 link icon is rendered AND its wrapper is visible (not
    // suppressed). Icons stay mounted but are hidden via opacity:0 when suppressed, so
    // we query the DOM wrapper's style rather than spy calls.
    return () => {
      const icon = document.querySelector<HTMLElement>(
        '[data-prev-ref="tok-0"][data-next-ref="tok-1"]',
      );
      if (!icon) return false;
      return icon.parentElement?.style.opacity !== '0';
    };
  }

  it('keeps the old segment’s link icon until the scroll settles, then drops it on scrollend', async () => {
    // With hideInactiveLinkButtons on, crossing a boundary wants to add/remove icons — but doing so
    // mid-scroll shifts every box and breaks the smooth glide. The view defers the active-segment
    // switch until the scroll settles (signaled by the container's `scrollend`), so the old segment
    // keeps its icon during the animation and only loses it once the scroll finishes.
    const inSegmentIconMounted = renderHideInactiveCrossing();
    await waitFor(() =>
      expect(screen.getByTestId('strip-fade-wrapper').className).toContain('tw:opacity-100'),
    );
    // GEN 1:1 is active, so its in-segment slot (between tok-0 and tok-1) shows a link icon.
    expect(inSegmentIconMounted()).toBe(true);

    // Step into GEN 1:2. The GEN 1:1 link icon must remain while the scroll animates (no relayout).
    tokenLinkIconSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next token' }));
    expect(inSegmentIconMounted()).toBe(true);

    // The scroll settles → `scrollend` fires on the clipping viewport (the element that actually
    // scrolls) → the active segment switches to GEN 1:2 and the GEN 1:1 icon disappears (its
    // in-segment slot is now inactive and suppressed).
    tokenLinkIconSpy.mockClear();
    act(() => {
      screen.getByTestId('strip-scroll-viewport').dispatchEvent(new Event('scrollend'));
    });
    expect(inSegmentIconMounted()).toBe(false);
  });

  it('also commits when scrollend fires on the inner content row', async () => {
    // The listener is attached to both the viewport and the content row, so whichever the browser
    // treats as the scroller settles the relayout. Covers the content-row path.
    const inSegmentIconMounted = renderHideInactiveCrossing();
    await waitFor(() =>
      expect(screen.getByTestId('strip-fade-wrapper').className).toContain('tw:opacity-100'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next token' }));
    expect(inSegmentIconMounted()).toBe(true);

    tokenLinkIconSpy.mockClear();
    act(() => {
      screen.getByTestId('token-strip').dispatchEvent(new Event('scrollend'));
    });
    expect(inSegmentIconMounted()).toBe(false);
  });

  it('commits the deferred relayout via the fallback timeout when scrollend never fires', () => {
    // Browsers without `scrollend` (or when the target was already centered, so no scroll happens)
    // must still commit the deferred relayout. A backstop timeout covers that case. Fake timers are
    // installed before render so every scheduled timer is captured, then advanced past the fallback.
    jest.useFakeTimers();
    try {
      const inSegmentIconMounted = renderHideInactiveCrossing();
      act(() => {
        jest.runOnlyPendingTimers();
      });
      // GEN 1:1 is active, so its in-segment link icon shows.
      expect(inSegmentIconMounted()).toBe(true);

      tokenLinkIconSpy.mockClear();
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Next token' }));
      });
      // Still present while the (fake-timer) scroll is mid-flight; no scrollend is dispatched.
      expect(inSegmentIconMounted()).toBe(true);

      tokenLinkIconSpy.mockClear();
      act(() => {
        // Advance past the 600ms fallback so the backstop commits the relayout.
        jest.advanceTimersByTime(700);
      });
      expect(inSegmentIconMounted()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-centers the focused group each frame while the inactive-link slots animate, then stops', () => {
    // After the active segment commits (post-scrollend), the inactive-link slots slide open/closed
    // over LINK_SLOT_TRANSITION_MS, continuously shifting every box around the center. The view
    // re-centers the focused group on every animation frame for that whole window so it stays dead
    // center, then tears the loop down once the transition completes. Fake timers drive both the
    // rAF callbacks and performance.now() deterministically.
    jest.useFakeTimers();
    try {
      const inSegmentIconMounted = renderHideInactiveCrossing();
      act(() => {
        jest.runOnlyPendingTimers();
      });
      expect(inSegmentIconMounted()).toBe(true);

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Next token' }));
      });

      // Commit the active segment (the scroll has settled). This seeds the re-center rAF loop.
      scrollIntoViewMock.mockClear();
      act(() => {
        screen.getByTestId('strip-scroll-viewport').dispatchEvent(new Event('scrollend'));
      });
      // The synchronous useLayoutEffect re-center has already fired once.
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'auto', inline: 'center' }),
      );

      // Advance one frame at a time: each frame within the transition window re-centers again.
      scrollIntoViewMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(50);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'auto', inline: 'center' }),
      );

      // Advance well past the transition window so the loop hits its deadline and stops scheduling.
      act(() => {
        jest.advanceTimersByTime(500);
      });
      scrollIntoViewMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(500);
      });
      // No further re-centering frames are scheduled once the deadline has passed.
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('scrolls with the nearest-block, center-inline placement', () => {
    const book = makeBook();
    render(
      <ContinuousView {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'center' }),
    );
  });

  it('re-centers once when simplifyPhrases toggles but not when hideInactiveLinkButtons toggles', () => {
    // Inactive link slots are now hidden via visibility:hidden (not max-width collapse), so toggling
    // hideInactiveLinkButtons no longer shifts the strip layout — no re-center needed.
    // simplifyPhrases still affects layout, so it should trigger one re-center.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);
    scrollIntoViewMock.mockClear();

    // Toggling hideInactiveLinkButtons should not cause any re-centering.
    rerender(
      <ContinuousView
        {...props}
        viewOptions={{ ...props.viewOptions, hideInactiveLinkButtons: true }}
      />,
    );
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    // Toggling simplifyPhrases re-centers exactly once (no rAF loop needed).
    rerender(
      <ContinuousView
        {...props}
        viewOptions={{ ...props.viewOptions, hideInactiveLinkButtons: true, simplifyPhrases: true }}
      />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', inline: 'center' }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('re-centers once when showMorphology toggles', () => {
    // Morpheme rows beneath tokens can widen phrase boxes, shifting the strip layout, so the
    // focused group must be snapped back to center when the toggle flips.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousView {...props} viewOptions={{ ...props.viewOptions, showMorphology: true }} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', inline: 'center' }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
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

  it('clears the hovered phrase highlight when the pointer leaves the token strip', async () => {
    // Group tok-0/tok-1 into one hoverable phrase so hovering it sets hoveredPhraseId, which
    // ContinuousView forwards to ArcOverlay. Leaving the strip runs clearAllHoverState, which must
    // reset hoveredPhraseId to undefined.
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

    // Hover the phrase group to set hoveredPhraseId='phrase-1'.
    const phraseGroupSpan = document.querySelector('[data-phrase-box="true"]')?.parentElement;
    if (!phraseGroupSpan) throw new Error('Expected a phrase group wrapper span');
    await userEvent.hover(phraseGroupSpan);
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute(
      'data-hovered-phrase-id',
      'phrase-1',
    );

    // Leaving the strip itself (not the group) must clear the highlight via clearAllHoverState.
    fireEvent.mouseLeave(screen.getByTestId('token-strip'));
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute('data-hovered-phrase-id', '');
  });

  it('applies the internal focus transition when the parent reflects a click-driven ref change', async () => {
    // Simulate: ContinuousView clicks Next, sets internalFocusedTokenRefRef, calls
    // onFocusedTokenRefChange. The parent then passes the new focusedTokenRef back. This exercises
    // the isInternal=true branch of the focus-change effect, which applies the new ref *immediately*
    // (setDisplayFocusedTokenRef) without fading the strip out. The external (non-internal) branch
    // would instead defer the display update behind a fade timeout, so the focused box would still
    // be 'In' (tok-0) right after the rerender.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousView {...props} />, withAnalysisStore);

    // Sanity: tok-0's box ('In') is focused before the click.
    expect(screen.getByText('In').closest('[data-phrase-box="true"]')).toHaveAttribute(
      'data-focus-state',
      'focused',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next token' }));
    // Now reflect the new ref back as a prop change (as a real parent would do). Because the click
    // stamped tok-1 as internally-originated, the echo is recognized as internal and applied at once.
    rerender(<ContinuousView {...props} focusedTokenRef="tok-1" />);

    // The displayed focus moved synchronously to tok-1's box ('the') — the internal path, not the
    // fade-then-snap external path (which would leave 'In' focused until the fade timeout fires).
    expect(screen.getByText('the').closest('[data-phrase-box="true"]')).toHaveAttribute(
      'data-focus-state',
      'focused',
    );
    expect(screen.getByText('In').closest('[data-phrase-box="true"]')).toHaveAttribute(
      'data-focus-state',
      'default',
    );
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
      mergePhrases: jest.fn(),
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
      mergePhrases: jest.fn(),
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
    // useCandidatePhraseIds resolves the hovered candidate ref (tok-0) to the phrase that contains
    // it, and ContinuousView forwards the set to ArcOverlay. The mock surfaces it as a data attr.
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute(
      'data-candidate-phrase-ids',
      'phrase-1',
    );
  });

  it('computes an empty candidatePhraseIds set when no candidate tokens are hovered', () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    // No hovered candidate refs: the phrase exists, but nothing should resolve to it.
    mockCandidateTokenRefs.current = new Set();
    const book = makeBook();
    render(<ContinuousView {...requiredProps(book)} />, withAnalysisStore);
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute('data-candidate-phrase-ids', '');
  });
});
