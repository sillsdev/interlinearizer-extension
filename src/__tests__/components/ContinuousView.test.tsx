/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, PhraseAnalysisLink, Token } from 'interlinearizer';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import { AltHeldProvider } from '../../components/AltHeldContext';
import ContinuousView from '../../components/ContinuousView';
import {
  createFocusStore,
  FocusStoreProvider,
  type FocusActions,
  type FocusStore,
} from '../../components/FocusStore';
import {
  SegmentationProvider,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import { isWordToken } from '../../types/type-guards';
import { FIXTURE_STAMPS, makePunctToken, makeSegment, makeWordToken } from '../test-helpers';
import {
  allFalseViewOptions,
  mockKeyAsValueLocalizedStrings,
  withAnalysisStore,
} from './test-helpers';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

/**
 * Stable module-level phrase-link map returned by `usePhraseLinkMap` across renders. Mutated by
 * individual tests to simulate phrase membership; reset in `beforeEach`.
 */
let phraseLinkMap = new Map<string, PhraseAnalysisLink>();

/**
 * Replaces the phrase-link map with a copy carrying the given link, so the identity change
 * invalidates the memos keyed on it the way a real link edit does.
 */
function addPhraseLinkWithNewIdentity(link: PhraseAnalysisLink): void {
  phraseLinkMap = new Map(phraseLinkMap);
  link.tokens.forEach((t) => phraseLinkMap.set(t.tokenRef, link));
}

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

// Hover-preview state is covered by the hook's own unit tests; the view only forwards its
// handlers, so a no-op stub suffices.
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
 * Spy invoked once per rendered link icon (mounted, whether suppressed or not). The rendered span
 * encodes the token refs as data attributes so DOM queries can check suppression via the parent
 * wrapper's style. Cleared in `beforeEach`.
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

/** Factory for a single-chapter book with two segments each having two word tokens. */
function makeBook(overrides?: Partial<Book>): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      makeSegment('GEN 1:1', 'In the', [
        makeWordToken('tok-0', 'In'),
        makeWordToken('tok-1', 'the', 3),
      ]),
      makeSegment('GEN 1:2', 'beginning God', [
        makeWordToken('tok-2', 'beginning'),
        makeWordToken('tok-3', 'God', 10),
      ]),
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
      makeSegment('GEN 1:1', 'Alpha', [makeWordToken('ch1-tok-0', 'Alpha')]),
      makeSegment('GEN 2:1', 'Beta', [makeWordToken('ch2-tok-0', 'Beta')]),
    ],
  };
}

/** Builds a Book with exactly one word token in one segment. */
function makeSingleTokenBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [makeSegment('GEN 1:1', 'Word', [makeWordToken('tok-only', 'Word')])],
  };
}

/** A book whose GEN 1:1 segment has word tokens and whose GEN 1:2 segment has only punctuation. */
function makeMixedBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [
      makeSegment('GEN 1:1', 'In the', [makeWordToken('mix-tok-0', 'In')]),
      makeSegment('GEN 1:2', '.', [makePunctToken('mix-punct-0')]),
    ],
  };
}

/** Builds a Book whose only token is punctuation. */
function makeWordFreeBook(): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: '1',
    segments: [makeSegment('GEN 1:1', '...', [makePunctToken('wf-punct-0')])],
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
      tokens: [makeWordToken(`large-tok-${i}`, `word${i}`)],
      verseStarts: [{ charStart: 0, number: String(i + 1), chapter: 1 }],
    })),
  };
}

const scrollIntoViewMock = jest.fn();

/** Builds the lookup maps that ContinuousView's parent supplies, derived from a Book. */
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

/** Props for {@link ContinuousViewHarness}. */
type ContinuousViewHarnessProps = ComponentProps<typeof ContinuousView> &
  Readonly<{
    /**
     * Focus the store is seeded with; each later change is applied as a focus the strip did not
     * choose.
     */
    focusedTokenRef: string | undefined;
    /** Called with every focus the strip writes, so a test can spy on or echo back its moves. */
    onFocusedTokenRefChange: (ref: string) => void;
  }>;

/**
 * Mounts the strip over a real focus store driven by the harness props, so a test can drive focus
 * from outside the strip and observe the moves the strip makes without standing up the provider
 * that resolves focus from a book and a reference.
 */
function ContinuousViewHarness({
  focusedTokenRef,
  onFocusedTokenRefChange,
  ...stripProps
}: ContinuousViewHarnessProps) {
  const storeRef = useRef<FocusStore | undefined>(undefined);
  if (storeRef.current === undefined) storeRef.current = createFocusStore(focusedTokenRef);
  const store = storeRef.current;

  const actions = useMemo<FocusActions>(
    () => ({
      focusToken: (ref, origin) => {
        store.write(ref, origin);
        onFocusedTokenRefChange(ref);
      },
      selectSegment: () => {},
    }),
    [store, onFocusedTokenRefChange],
  );

  // Mirrors only an actual prop change: applying the seed again on mount would clobber the focus the
  // strip names for itself when nothing resolved one, since child effects run first.
  const prevFocusRef = useRef(focusedTokenRef);
  useEffect(() => {
    if (focusedTokenRef === prevFocusRef.current) return;
    prevFocusRef.current = focusedTokenRef;
    store.write(focusedTokenRef, 'reseed');
  }, [store, focusedTokenRef]);

  return (
    <FocusStoreProvider store={store} actions={actions}>
      <ContinuousView {...stripProps} />
    </FocusStoreProvider>
  );
}

/**
 * Minimal required props for the strip harness. Spread into render calls so tests only need to
 * override what they actually care about. The lookup maps are derived from `book` so they always
 * agree with what's rendered.
 */
function requiredProps(
  book: Book,
  overrides?: { focusedTokenRef?: string | undefined },
): ContinuousViewHarnessProps & { onFocusedTokenRefChange: jest.Mock; setPhraseMode: jest.Mock } {
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

/** Every {@link TrackingResizeObserver} created since the last reset, newest last. */
let resizeObserverInstances: TrackingResizeObserver[] = [];

/**
 * A ResizeObserver test double that records what it was pointed at, its callback, and its
 * disconnect state, and appends itself to {@link resizeObserverInstances}, so a test can fire a
 * simulated late content reflow and assert whether the active observer was disconnected.
 * Module-scoped (rather than an inline class per test) so the file stays under
 * `max-classes-per-file`.
 */
class TrackingResizeObserver implements ResizeObserver {
  /** Whether {@link disconnect} has been called on this instance. */
  disconnected = false;

  /**
   * Elements this instance was pointed at. The view runs several observers at once, so a test picks
   * one by the element it watches rather than by creation order.
   */
  targets: Element[] = [];

  constructor(public callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }
}

beforeAll(() => {
  // jsdom does not implement scrollIntoView.
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
});

beforeEach(() => {
  mockKeyAsValueLocalizedStrings();
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

describe('ContinuousView initial render', () => {
  it('renders all tokens from all segments as a flat list', () => {
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('beginning')).toBeInTheDocument();
    expect(screen.getByText('God')).toBeInTheDocument();
  });

  it('renders an inline verse-number superscript at each verse start', () => {
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    // Verses 1 and 2; the first opens chapter 1, so its label is chapter-qualified (`1:1`).
    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups.map((s) => s.textContent)).toEqual(['1:1', '2']);
  });

  it('renders no verse superscript at a mid-verse continuation start', () => {
    // Verse 1 split across two segments; the second's verse start is flagged isContinuation.
    const splitBook = makeBook({
      segments: [
        {
          id: 'GEN 1:1',
          startRef: { book: 'GEN', chapter: 1, verse: 1 },
          endRef: { book: 'GEN', chapter: 1, verse: 1, charIndex: 3 },
          baselineText: 'In',
          tokens: [makeWordToken('tok-0', 'In')],
          verseStarts: [{ charStart: 0, number: '1', chapter: 1 }],
        },
        {
          id: 'GEN 1:1:3',
          startRef: { book: 'GEN', chapter: 1, verse: 1, charIndex: 3 },
          endRef: { book: 'GEN', chapter: 1, verse: 1 },
          baselineText: 'the',
          tokens: [makeWordToken('tok-1', 'the')],
          verseStarts: [{ charStart: 0, number: '1', chapter: 1, isContinuation: true }],
        },
      ],
    });
    render(<ContinuousViewHarness {...requiredProps(splitBook)} />, withAnalysisStore);

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups.map((s) => s.textContent)).toEqual(['1:1']);
  });

  it('does not render an extension-generated segment separator', () => {
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.queryByText('GEN 1:1')).not.toBeInTheDocument();
  });

  it('renders a Previous token button and a Next token button', () => {
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeInTheDocument();
  });

  it('renders a non-word token via InertTokenChip within the strip', () => {
    const book = makeMixedBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens', () => {
    const book = makeWordFreeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('notifies the parent of the initially-focused token on mount when no focus prop is set', () => {
    const book = makeBook();
    const props = requiredProps(book);
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
  });

  it('does not notify the parent on mount when focusedTokenRef is already set', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });

  it('marks the phrase containing focusedTokenRef as focused', () => {
    const book = makeBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    const focusedBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    expect(focusedBox).toHaveAttribute('data-focus-state', 'focused');
  });

  it('falls back to the live focus while the displayed ref names a token this book lacks', () => {
    // Through a book change the displayed ref lags by one fade, briefly naming a token absent from
    // the mounted book. The window must follow the live focus rather than collapsing to phrase 0.
    // Seeded with a foreign ref so the mounted book cannot resolve the displayed value, which is the
    // state that fade leaves behind.
    const otherBook: Book = {
      id: 'MAT',
      bookRef: 'MAT',
      textVersion: '1',
      segments: [
        makeSegment('MAT 1:1', 'Alpha', [makeWordToken('mat-tok-0', 'Alpha')]),
        makeSegment('MAT 1:2', 'Beta', [makeWordToken('mat-tok-1', 'Beta')]),
      ],
    };
    const props = requiredProps(otherBook, { focusedTokenRef: 'tok-2' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    scrollIntoViewMock.mockClear();
    rerender(<ContinuousViewHarness {...props} focusedTokenRef="mat-tok-1" />);

    // The scroll lands on "Beta" (the live focus), never "Alpha" (phrase 0).
    const scrolledTexts = scrollIntoViewMock.mock.contexts.map((el) =>
      el instanceof HTMLElement ? el.textContent : undefined,
    );
    expect(scrolledTexts.some((t) => t?.includes('Beta'))).toBe(true);
    expect(scrolledTexts.some((t) => t?.includes('Alpha'))).toBe(false);
  });

  it('centers the focused group after a book swap', () => {
    // A book swap drops the group ref setters, which are keyed by absolute group index and so name
    // different groups in the new book. Centering afterwards proves the new book's groups took
    // setters of their own rather than inheriting dead ones.
    const otherBook: Book = {
      id: 'MAT',
      bookRef: 'MAT',
      textVersion: '1',
      segments: [
        makeSegment('MAT 1:1', 'Alpha', [makeWordToken('mat-tok-0', 'Alpha')]),
        makeSegment('MAT 1:2', 'Beta', [makeWordToken('mat-tok-1', 'Beta')]),
      ],
    };
    const { rerender } = render(
      <ContinuousViewHarness {...requiredProps(makeBook(), { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    scrollIntoViewMock.mockClear();
    rerender(
      <ContinuousViewHarness {...requiredProps(otherBook, { focusedTokenRef: 'mat-tok-1' })} />,
    );

    const scrolledTexts = scrollIntoViewMock.mock.contexts.map((el) =>
      el instanceof HTMLElement ? el.textContent : undefined,
    );
    expect(scrolledTexts.some((t) => t?.includes('Beta'))).toBe(true);
  });
});

describe('ContinuousView focus changes', () => {
  it('notifies the parent when an out-of-focus phrase box is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    const clickedPhraseBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    if (!clickedPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(clickedPhraseBox);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-2');
  });

  it('does not notify the parent when clicking the already-focused phrase box', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });

  it('does not notify the parent when clicking the group of an already-focused non-first token', async () => {
    // tok-0/tok-1 grouped into one box (keyed by tok-0) with focus on tok-1: clicking the box stays
    // a no-op even though its groupKey differs from focusedTokenRef.
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
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
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    const groupedBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!groupedBox) throw new Error('Expected phrase box wrapper for grouped tokens');

    await userEvent.click(groupedBox);

    expect(props.onFocusedTokenRefChange).not.toHaveBeenCalled();
  });

  it('notifies the parent when clicking a phrase box while nothing is focused', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: undefined });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
  });
});

describe('ContinuousView arrow disabled states', () => {
  it('disables the prev arrow when focus is on the first phrase', () => {
    const book = makeBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
  });

  it('enables the prev arrow when focus is on a non-first phrase', () => {
    const book = makeBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-2' })} />,
      withAnalysisStore,
    );

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeEnabled();
  });

  it('disables the next arrow when focus is on the last phrase', () => {
    const book = makeBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-3' })} />,
      withAnalysisStore,
    );

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });

  it('enables the next arrow when focus is on a non-last phrase', () => {
    const book = makeBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeEnabled();
  });

  it('disables both arrows when the book has a single token', () => {
    const book = makeSingleTokenBook();
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-only' })} />,
      withAnalysisStore,
    );

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });

  it('disables both arrows when the book has no word tokens', () => {
    const book = makeWordFreeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });
});

describe('ContinuousView arrow navigation', () => {
  it('notifies the parent of the next phrase ref when Next is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-1');
  });

  it('notifies the parent of the previous phrase ref when Previous is clicked', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    );

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-0');
  });

  it('crosses verse boundaries via the Next arrow', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('tok-2');
  });

  it('crosses chapter boundaries via the Next arrow', async () => {
    const book = makeTwoChapterBook();
    const props = requiredProps(book, { focusedTokenRef: 'ch1-tok-0' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(props.onFocusedTokenRefChange).toHaveBeenCalledWith('ch2-tok-0');
  });

  it('advances two groups on rapid double-click before re-render', async () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    render(<ContinuousViewHarness {...props} />, withAnalysisStore);
    const next = screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });

    await userEvent.click(next);
    await userEvent.click(next);

    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(1, 'tok-1');
    expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(2, 'tok-2');
  });

  it('steps from a focus it did not choose rather than from its own last target', async () => {
    // A step counts from where the strip is heading, so rapid presses accumulate. A focus the strip
    // did not choose has to reset that count: otherwise the press after one lands a group away from
    // what the reader is looking at.
    jest.useFakeTimers();
    try {
      const book = makeBook();
      const props = requiredProps(book, { focusedTokenRef: 'tok-1' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
      );
      expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(1, 'tok-2');

      // A focus from outside the strip, given the fade it takes to arrive.
      rerender(<ContinuousViewHarness {...props} focusedTokenRef="tok-3" />);
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
      );
      expect(props.onFocusedTokenRefChange).toHaveBeenNthCalledWith(2, 'tok-2');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView scroll behavior', () => {
  it('calls scrollIntoView on initial mount', () => {
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });

  it('uses instant scroll when focusedTokenRef changes externally', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    scrollIntoViewMock.mockClear();
    act(() => {
      jest.useFakeTimers();
    });
    rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: 'tok-3' }} />);
    act(() => {
      jest.advanceTimersByTime(600);
      jest.useRealTimers();
    });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('holds the group centered on animation frames after an external jump within the active segment', () => {
    // An external jump within the already-active segment never flips committedActiveSegmentId, so the
    // scroll effect's own hold loop must keep the group pinned while late layout (arc padding
    // settling on the slid window) shifts the strip after the instant snap.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    act(() => {
      jest.useFakeTimers();
    });
    try {
      // tok-1 shares GEN 1:1 with tok-0, so the active segment is unchanged by this jump.
      rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: 'tok-1' }} />);
      // Complete the fade-out (RECENTER_FADE_MS) so the displayed focus updates and the instant
      // snap fires.
      scrollIntoViewMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(510);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'auto', inline: 'center' }),
      );

      // Frames within the hold window keep re-centering after the snap.
      scrollIntoViewMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(50);
      });
      expect(scrollIntoViewMock).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'auto', inline: 'center' }),
      );

      // Past the deadline the loop stops scheduling further frames.
      act(() => {
        jest.advanceTimersByTime(500);
      });
      scrollIntoViewMock.mockClear();
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-centers the focused group when the strip content reflows after the initial hold window', () => {
    // Glosses/morpheme rows/arcs settle asynchronously over many frames; content widening to the
    // left of the focus shifts the focused box sideways. The hold observes the content row and
    // re-centers on each reflow, so a resize after the initial quiet window still snaps to center.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;

    try {
      const book = makeBook();
      const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // tok-1 shares GEN 1:1 with tok-0, so the active segment is unchanged: only the scroll
        // effect's own hold loop keeps the group pinned.
        rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: 'tok-1' }} />);
        act(() => {
          jest.advanceTimersByTime(510);
        });

        // Let the initial quiet window fully lapse.
        act(() => {
          jest.advanceTimersByTime(1000);
        });
        scrollIntoViewMock.mockClear();

        // A late content reflow fires the content-row observer; the hold must re-center in response.
        act(() => {
          const observer = resizeObserverInstances.at(-1);
          if (!observer) throw new Error('Expected the hold to observe the content row');
          observer.callback([], { disconnect() {}, observe() {}, unobserve() {} });
          jest.advanceTimersByTime(16);
        });

        expect(scrollIntoViewMock).toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'auto', inline: 'center' }),
        );
      } finally {
        jest.useRealTimers();
      }
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('keeps the content-row observer connected after the quiet window so a late reflow still re-centers', () => {
    // The dominant strip-width reflow (gloss-placeholder resolution / arc settle) can land after the
    // hold's 200ms quiet window lapses. The observer must remain connected for the full hard-deadline
    // window, restarting the re-center loop whenever a late reflow fires.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;

    try {
      const book = makeBook();
      const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Drive the hold loop via an external jump so it runs under fake-timer control (jsdom rAF on
        // the initial real-timer mount is not deterministically advanceable). tok-1 shares GEN 1:1
        // with tok-0, so there's no committed-active-segment flip: only the scroll effect's own hold
        // pins the group, exercising the same observer lifetime as the initial mount.
        rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: 'tok-1' }} />);
        // Complete the fade-out (RECENTER_FADE_MS) so the instant snap + hold start.
        act(() => {
          jest.advanceTimersByTime(510);
        });

        // Let the quiet window (LINK_SLOT_TRANSITION_MS) fully lapse so the tick loop goes idle —
        // but stay well within HOLD_CENTERED_MAX_MS.
        act(() => {
          jest.advanceTimersByTime(400);
        });

        // The active (latest) observer must still be connected to catch a reflow that lands this
        // late. Superseded holds torn down during the fade/rerender are earlier instances; the last
        // one is the live hold.
        const activeObserver = resizeObserverInstances.at(-1);
        if (!activeObserver) throw new Error('Expected the hold to create a content-row observer');
        expect(activeObserver.disconnected).toBe(false);

        // A late content reflow fires the still-connected observer; the hold re-centers in response.
        scrollIntoViewMock.mockClear();
        act(() => {
          activeObserver.callback([], { disconnect() {}, observe() {}, unobserve() {} });
          jest.advanceTimersByTime(16);
        });
        expect(scrollIntoViewMock).toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'auto', inline: 'center' }),
        );
      } finally {
        jest.useRealTimers();
      }
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('snaps the link slots (no transition) during an external jump so they do not slide after the fade-in', () => {
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { container, rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    act(() => {
      jest.useFakeTimers();
    });
    // External nav into the other verse: the active segment commits instantly behind the fade, so
    // the slots snap to their new widths rather than animating (which would slide the boxes).
    rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: 'tok-3' }} />);

    const slotWrapper = container.querySelector('[data-testid="link-slot-icon"]');
    if (!(slotWrapper instanceof HTMLElement)) throw new Error('Expected a link-slot icon wrapper');
    expect(slotWrapper.style.transitionDuration).toBe('0ms');

    act(() => {
      jest.advanceTimersByTime(600);
      jest.useRealTimers();
    });
  });

  it('smooth-scrolls for internal nav once the parent echoes the ref back synchronously', async () => {
    // The smooth-scroll path needs the displayed focus to agree with the prop and the strip to be
    // visible, which only happens with a real (stateful) parent reflecting the ref change back, so
    // simulate one here rather than a jest.fn() that never updates the prop.
    const book = makeBook();
    const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
    function Parent() {
      const [ref, setRef] = useState<string | undefined>('tok-0');
      return (
        <ContinuousViewHarness
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
    // Wait for the initial fade-in (strip visible) before navigating; the smooth path is only taken
    // while the strip is already visible.
    await waitFor(() =>
      expect(screen.getByTestId('strip-fade-wrapper').className).toContain('tw:opacity-100'),
    );
    scrollIntoViewMock.mockClear();

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

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
   */
  function renderHideInactiveCrossing(): () => boolean {
    const book = makeBook();
    const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
    function Parent() {
      const [ref, setRef] = useState<string | undefined>('tok-1');
      return (
        <ContinuousViewHarness
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
    // Returns true when the tok-0/tok-1 link icon is rendered and its wrapper is visible. Suppressed
    // icons stay mounted but hidden via opacity:0, so query the wrapper's style, not spy calls.
    return () => {
      const icon = document.querySelector<HTMLElement>(
        '[data-prev-ref="tok-0"][data-next-ref="tok-1"]',
      );
      if (!icon) return false;
      return icon.parentElement?.style.opacity !== '0';
    };
  }

  it('keeps the old segment’s link icon until the scroll settles, then drops it on scrollend', async () => {
    // With hideInactiveLinkButtons on, adding/removing icons mid-scroll would shift every box and
    // break the glide. The view defers the active-segment switch until the scroll settles (the
    // container's `scrollend`), so the old segment keeps its icon through the animation.
    const inSegmentIconMounted = renderHideInactiveCrossing();
    await waitFor(() =>
      expect(screen.getByTestId('strip-fade-wrapper').className).toContain('tw:opacity-100'),
    );
    // GEN 1:1 is active, so its in-segment slot (between tok-0 and tok-1) shows a link icon.
    expect(inSegmentIconMounted()).toBe(true);

    // Step into GEN 1:2. The GEN 1:1 link icon must remain while the scroll animates (no relayout).
    tokenLinkIconSpy.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );
    expect(inSegmentIconMounted()).toBe(true);

    // On `scrollend` (fired on the clipping viewport that actually scrolls), the active segment
    // switches to GEN 1:2 and the GEN 1:1 icon disappears (its in-segment slot is now suppressed).
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

    fireEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );
    expect(inSegmentIconMounted()).toBe(true);

    tokenLinkIconSpy.mockClear();
    act(() => {
      screen.getByTestId('token-strip').dispatchEvent(new Event('scrollend'));
    });
    expect(inSegmentIconMounted()).toBe(false);
  });

  it('commits the deferred relayout via the fallback timeout when scrollend never fires', () => {
    // Browsers without `scrollend` (or when the target was already centered) still commit via a
    // backstop timeout. Fake timers are installed before render so every timer is captured.
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
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
      });
      // Still present while the (fake-timer) scroll is mid-flight; no scrollend is dispatched.
      expect(inSegmentIconMounted()).toBe(true);

      tokenLinkIconSpy.mockClear();
      act(() => {
        // Advance past the fallback timeout so the backstop commits the relayout.
        jest.advanceTimersByTime(700);
      });
      expect(inSegmentIconMounted()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('defers the reconcile to the scroll settle when a boundary edit lands mid-glide', () => {
    // A boundary edit that changes the focused token's segment id mid-glide must not commit the
    // active segment early (that would flip committedActiveSegmentId and truncate the glide into a
    // jump); the reconcile defers to the scroll's settle. Probe: with the old segment still
    // committed, its in-segment link icon stays mounted through the edit until the scroll settles.
    const book = makeBook();
    const merged = resegmentBook(book, { removedVerseStarts: ['tok-2'], addedStarts: [] });
    const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
    const mergedLookups = buildLookups(merged);
    let applyBoundaryEdit: () => void = () => {};
    /** Stateful parent that starts on the verse book and swaps to the merged book on demand. */
    function Parent() {
      const [ref, setRef] = useState<string | undefined>('tok-1');
      const [edited, setEdited] = useState(false);
      applyBoundaryEdit = () => setEdited(true);
      const lookups = edited ? mergedLookups : { tokenSegmentMap, tokenDocOrder, wordTokenByRef };
      return (
        <ContinuousViewHarness
          book={edited ? merged : book}
          editPhraseSegmentId={undefined}
          focusedTokenRef={ref}
          onFocusedTokenRefChange={setRef}
          phraseMode={{ kind: 'view' }}
          setPhraseMode={jest.fn()}
          tokenSegmentMap={lookups.tokenSegmentMap}
          tokenDocOrder={lookups.tokenDocOrder}
          wordTokenByRef={lookups.wordTokenByRef}
          viewOptions={{ ...allFalseViewOptions, hideInactiveLinkButtons: true }}
        />
      );
    }
    /** Whether the tok-0/tok-1 link icon (in GEN 1:1) is mounted and visible. */
    const inSegmentIconMounted = () => {
      const icon = document.querySelector<HTMLElement>(
        '[data-prev-ref="tok-0"][data-next-ref="tok-1"]',
      );
      return !!icon && icon.parentElement?.style.opacity !== '0';
    };
    jest.useFakeTimers();
    try {
      render(<Parent />, withAnalysisStore);
      act(() => {
        jest.runOnlyPendingTimers();
      });
      expect(inSegmentIconMounted()).toBe(true);

      // Step into GEN 1:2 (internal nav) — the scroll is now animating and its commit is pending.
      act(() => {
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
      });
      expect(inSegmentIconMounted()).toBe(true);

      // Boundary edit mid-glide: merge GEN 1:2 into GEN 1:1. Token refs survive so focus is
      // unchanged; the reconcile defers rather than commit-and-relayout, so the old segment's
      // in-segment icon stays mounted.
      act(() => {
        applyBoundaryEdit();
      });
      expect(inSegmentIconMounted()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-centers the focused group each frame while the inactive-link slots animate, then stops', () => {
    // After the active segment commits, the inactive-link slots slide open/closed over
    // LINK_SLOT_TRANSITION_MS, shifting every box around the center. The view re-centers on every
    // frame for that window, then tears the loop down once the transition completes.
    jest.useFakeTimers();
    try {
      const inSegmentIconMounted = renderHideInactiveCrossing();
      act(() => {
        jest.runOnlyPendingTimers();
      });
      expect(inSegmentIconMounted()).toBe(true);

      act(() => {
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
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
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />,
      withAnalysisStore,
    );

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'center' }),
    );
  });

  it('re-centers once when simplifyPhrases toggles but not when hideInactiveLinkButtons toggles', () => {
    // Inactive link slots hide via visibility:hidden (not max-width collapse), so toggling
    // hideInactiveLinkButtons doesn't shift layout; simplifyPhrases does, so it re-centers once.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousViewHarness
        {...props}
        viewOptions={{ ...props.viewOptions, hideInactiveLinkButtons: true }}
      />,
    );
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    rerender(
      <ContinuousViewHarness
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
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);
    scrollIntoViewMock.mockClear();

    rerender(
      <ContinuousViewHarness
        {...props}
        viewOptions={{ ...props.viewOptions, showMorphology: true }}
      />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', inline: 'center' }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });
});

describe('ContinuousView segmentation edits', () => {
  /**
   * Reads the inline opacity of the link-slot wrapper between `prevRef` and `nextRef`, the style
   * `PhraseSlot` uses to suppress link buttons outside the active segment.
   */
  function slotOpacity(container: HTMLElement, prevRef: string, nextRef: string): string {
    const icon = container.querySelector(
      `[data-prev-ref="${prevRef}"][data-next-ref="${nextRef}"]`,
    );
    const wrapper = icon?.parentElement;
    if (!(wrapper instanceof HTMLElement)) throw new Error('Expected a link-slot wrapper span');
    return wrapper.style.opacity;
  }

  it('keeps the focused segment link buttons active when a merge changes the focused token segment id', () => {
    const book = makeBook();
    const props = {
      ...requiredProps(book, { focusedTokenRef: 'tok-2' }),
      viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true },
    };
    const { container, rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    // Focus sits in GEN 1:2, so the slot between its two tokens is active and visible.
    expect(slotOpacity(container, 'tok-2', 'tok-3')).toBe('1');

    // Merge GEN 1:2 into GEN 1:1. Token refs survive, so focus stays put, but the focused token's
    // segment id changes.
    const merged = resegmentBook(book, { removedVerseStarts: ['tok-2'], addedStarts: [] });
    rerender(<ContinuousViewHarness {...{ ...props, book: merged, ...buildLookups(merged) }} />);

    // The committed active segment must follow the merge; a stale id would suppress every link
    // button until the next navigation.
    expect(slotOpacity(container, 'tok-2', 'tok-3')).toBe('1');
  });
});

describe('ContinuousView split marker', () => {
  /**
   * Renders ContinuousView wrapped in the segmentation and Alt-held providers so the shared
   * split-gap marker can be exercised in the horizontal strip.
   *
   * @param altHeld - Whether Alt is held (defaults to held, so the marker appears).
   */
  function renderStrip(altHeld = true) {
    const book = makeBook();
    const dispatch = { merge: jest.fn(), split: jest.fn(), move: jest.fn() };
    const segmentById = new Map(book.segments.map((seg) => [seg.id, seg]));
    const segmentOrder = new Map(book.segments.map((seg, i) => [seg.id, i]));
    const value: SegmentationContextValue = {
      dispatch,
      segmentById,
      segmentOrder,
      formerBoundaries: new Map(),
      straddledBoundaryRefs: new Set(),
    };
    render(
      <SegmentationProvider value={value}>
        <AltHeldProvider value={altHeld}>
          <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'tok-0' })} />
        </AltHeldProvider>
      </SegmentationProvider>,
      withAnalysisStore,
    );
    return dispatch;
  }

  it('reveals a split marker on an intra-segment gap while Alt is held', () => {
    renderStrip(true);
    expect(screen.getAllByTestId('boundary-split-marker').length).toBeGreaterThan(0);
  });

  it('reveals no split marker while Alt is not held', () => {
    renderStrip(false);
    expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
  });

  it('dispatches a split on an Alt+click of the strip marker', () => {
    const dispatch = renderStrip(true);
    // The gap between "In" (tok-0) and "the" (tok-1) inside GEN 1:1 splits before the second word.
    fireEvent.click(screen.getAllByTestId('boundary-split-marker')[0], { altKey: true });
    expect(dispatch.split).toHaveBeenCalledWith('tok-1');
  });
});

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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    const prev = screen.getByRole('button', {
      name: '%interlinearizer_continuousView_previousToken%',
    });
    expect(prev.textContent).toContain('→');
  });

  it('uses left-pointing arrow for Next in RTL', () => {
    document.documentElement.dir = 'rtl';
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    const next = screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });
    expect(next.textContent).toContain('←');
  });

  it('uses left-pointing arrow for Previous in LTR', () => {
    document.documentElement.dir = 'ltr';
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    const prev = screen.getByRole('button', {
      name: '%interlinearizer_continuousView_previousToken%',
    });
    expect(prev.textContent).toContain('←');
  });
});

describe('ContinuousView phrase window', () => {
  it('renders the focused phrase from a large book', () => {
    const book = makeLargeBook(300);
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
      withAnalysisStore,
    );

    expect(screen.getByText('word150')).toBeInTheDocument();
  });

  it('does not render tokens that fall outside the rendered window', () => {
    const book = makeLargeBook(300);
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-0' })} />,
      withAnalysisStore,
    );

    // tok-299 is well outside the rendered phrase window.
    expect(screen.queryByText('word299')).not.toBeInTheDocument();
  });

  /** Links two tokens far enough apart that only one of them falls inside the starting window. */
  function linkFarApartTokens(): void {
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-far',
      status: 'approved',
      tokens: [
        { tokenRef: 'large-tok-150', surfaceText: 'word150' },
        { tokenRef: 'large-tok-190', surfaceText: 'word190' },
      ],
    };
    phraseLinkMap.set('large-tok-150', phraseLink);
    phraseLinkMap.set('large-tok-190', phraseLink);
  }

  it('mounts the far fragment of a discontiguous phrase the window touches', () => {
    // An arc runs between two mounted phrase boxes, so a fragment left outside the window would
    // take the whole arc with it and leave the visible fragment with no phrase cue at all.
    linkFarApartTokens();
    const book = makeLargeBook(300);
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
      withAnalysisStore,
    );

    expect(screen.getByText('word190')).toBeInTheDocument();
  });

  it('widens no further than the phrase span it is covering', () => {
    linkFarApartTokens();
    const book = makeLargeBook(300);
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
      withAnalysisStore,
    );

    expect(screen.queryByText('word200')).not.toBeInTheDocument();
  });

  it('re-centers when a new phrase link pulls the window start back behind the focus', () => {
    // Widening start-ward mounts groups ahead of the focus at an unchanged scroll offset, the same
    // shift a resize causes — but the window size is unchanged, so a size-keyed correction misses it.
    const book = makeLargeBook(300);
    const props = requiredProps(book, { focusedTokenRef: 'large-tok-150' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    scrollIntoViewMock.mockClear();
    addPhraseLinkWithNewIdentity({
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-back',
      status: 'approved',
      tokens: [
        { tokenRef: 'large-tok-110', surfaceText: 'word110' },
        { tokenRef: 'large-tok-145', surfaceText: 'word145' },
      ],
    });
    rerender(<ContinuousViewHarness {...props} />);

    expect(screen.getByText('word110')).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('leaves an unlinked token at the same distance outside the window', () => {
    const book = makeLargeBook(300);
    render(
      <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
      withAnalysisStore,
    );

    expect(screen.queryByText('word190')).not.toBeInTheDocument();
  });

  it('re-centers the focused group when a viewport resize widens the window', () => {
    // The focus never moves here, so no focus-keyed centering path fires; without the window-keyed
    // one the groups mounting ahead of the focus carry it off the strip.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;

    try {
      const book = makeLargeBook(300);
      render(
        <ContinuousViewHarness {...requiredProps(book, { focusedTokenRef: 'large-tok-150' })} />,
        withAnalysisStore,
      );

      // jsdom lays nothing out, so the geometry the window measures is supplied: a viewport wide
      // enough to ask for more groups, over groups spaced a fixed pitch apart.
      const viewport = screen.getByTestId('strip-scroll-viewport');
      const stripRow = screen.getByTestId('token-strip');
      const mountedGroups = () => stripRow.querySelectorAll('[data-phrase-group="true"]').length;
      Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 2000 });
      stripRow.querySelectorAll('[data-phrase-group="true"]').forEach((group, index) => {
        group.getBoundingClientRect = () => ({
          left: index * 100,
          right: index * 100,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: index * 100,
          y: 0,
          toJSON: () => ({}),
        });
      });

      const groupsBeforeResize = mountedGroups();
      scrollIntoViewMock.mockClear();

      // Only the render window observes the clipping viewport; the centering hold and the arc pass
      // watch content elements, so firing this one exercises the window path alone.
      const windowObserver = resizeObserverInstances.find((o) => o.targets.includes(viewport));
      if (!windowObserver) throw new Error('Expected the render window to observe the viewport');
      jest.useFakeTimers();
      act(() => {
        windowObserver.callback([], { disconnect() {}, observe() {}, unobserve() {} });
        // The measurement waits a frame, which jsdom schedules on a timer.
        jest.advanceTimersByTime(16);
      });

      expect(mountedGroups()).toBeGreaterThan(groupsBeforeResize);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'nearest',
        inline: 'center',
      });
    } finally {
      jest.useRealTimers();
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('re-centers after a window change whose focus move left the start clamped at the book start', () => {
    // A focus step whose start stays clamped at 0 leaves the window-keyed correction dormant, so
    // the focus index it compares against has to stay current without it running.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;
    const stubObserver = { disconnect() {}, observe() {}, unobserve() {} };

    try {
      const book = makeLargeBook(300);
      // Focused close enough to the book start that the widened window's start clamps to 0.
      const props = requiredProps(book, { focusedTokenRef: 'large-tok-12' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      const viewport = screen.getByTestId('strip-scroll-viewport');
      const stripRow = screen.getByTestId('token-strip');
      const layOutGroups = () => {
        stripRow.querySelectorAll('[data-phrase-group="true"]').forEach((group, index) => {
          group.getBoundingClientRect = () => ({
            left: index * 100,
            right: index * 100,
            top: 0,
            bottom: 0,
            width: 0,
            height: 0,
            x: index * 100,
            y: 0,
            toJSON: () => ({}),
          });
        });
      };

      const setViewportWidth = (value: number) => {
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value });
      };
      const fireWindowObserver = () => {
        const windowObserver = resizeObserverInstances.find(
          (o) => o.targets.includes(viewport) && !o.disconnected,
        );
        if (!windowObserver) throw new Error('Expected the render window to observe the viewport');
        act(() => {
          windowObserver.callback([], stubObserver);
          // The measurement waits a frame, which jsdom schedules on a timer.
          jest.advanceTimersByTime(16);
        });
      };

      layOutGroups();
      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Widen so the window asks for more groups per side than the focus has ahead of it, which
        // pins the start at 0.
        setViewportWidth(2000);
        fireWindowObserver();
        layOutGroups();

        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
        const emitted = props.onFocusedTokenRefChange.mock.calls.at(-1)?.[0];
        const nextRef = typeof emitted === 'string' ? emitted : undefined;
        expect(nextRef).toBe('large-tok-13');
        rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: nextRef }} />);
        layOutGroups();

        // Let the step's own glide settle, so the deferred-correction path is not what answers the
        // narrowing below. Long enough to outrun the timeout that backstops `scrollend`.
        act(() => {
          jest.advanceTimersByTime(1000);
        });

        // Narrow the window under a now-stationary focus. This unmounts groups ahead of the focus
        // and moves the start off 0, so the strip needs re-centering.
        scrollIntoViewMock.mockClear();
        setViewportWidth(400);
        fireWindowObserver();

        // Two centerings: the window effect's own correction, then the hold that keeps it there as
        // the newly-mounted groups lay out. Losing the baseline drops the first and leaves only the
        // hold, so the count is what distinguishes a corrected strip from an uncorrected one.
        const centeredGroups = scrollIntoViewMock.mock.instances.map((el: unknown) =>
          el instanceof HTMLElement ? el.textContent : undefined,
        );
        expect(centeredGroups).toEqual(['word13', 'word13']);
      } finally {
        act(() => {
          jest.useRealTimers();
        });
      }
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('stops holding the pre-resize group centered once the reader navigates away', () => {
    // A navigation slides the window, which is itself a content resize — so a hold left over from
    // the window change restarts its loop, instant-scrolls back to the group the reader just left,
    // and parks the strip there.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;
    const stubObserver = { disconnect() {}, observe() {}, unobserve() {} };

    try {
      const book = makeLargeBook(300);
      const props = requiredProps(book, { focusedTokenRef: 'large-tok-150' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      // jsdom lays nothing out, so the geometry the window measures is supplied: a viewport wide
      // enough to ask for more groups, over groups spaced a fixed pitch apart.
      const viewport = screen.getByTestId('strip-scroll-viewport');
      const stripRow = screen.getByTestId('token-strip');
      Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 2000 });
      const layOutGroups = () => {
        stripRow.querySelectorAll('[data-phrase-group="true"]').forEach((group, index) => {
          group.getBoundingClientRect = () => ({
            left: index * 100,
            right: index * 100,
            top: 0,
            bottom: 0,
            width: 0,
            height: 0,
            x: index * 100,
            y: 0,
            toJSON: () => ({}),
          });
        });
      };
      layOutGroups();

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Widen the window, which arms the hold on the currently-focused group.
        const windowObserver = resizeObserverInstances.find((o) => o.targets.includes(viewport));
        if (!windowObserver) throw new Error('Expected the render window to observe the viewport');
        act(() => {
          windowObserver.callback([], stubObserver);
        });
        layOutGroups();

        // Navigate one phrase forward while that hold is still alive, echoing the new ref back the
        // way the parent does so the strip treats it as internal navigation.
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
        const emitted = props.onFocusedTokenRefChange.mock.calls.at(-1)?.[0];
        const nextRef = typeof emitted === 'string' ? emitted : undefined;
        expect(nextRef).toBe('large-tok-151');
        rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: nextRef }} />);

        scrollIntoViewMock.mockClear();
        // Report the window slide's own reflow, then run out the frames a restarted hold would use.
        resizeObserverInstances
          .filter((o) => o.targets.includes(stripRow) && !o.disconnected)
          .forEach((observer) => {
            act(() => {
              observer.callback([], stubObserver);
            });
          });
        act(() => {
          // Comfortably past the hold's quiet period, so every frame it would use has run.
          jest.advanceTimersByTime(300);
        });

        const centeredGroups = scrollIntoViewMock.mock.instances.map((el: unknown) =>
          el instanceof HTMLElement ? el.textContent : undefined,
        );
        expect(centeredGroups).not.toContain('word150');
      } finally {
        act(() => {
          jest.useRealTimers();
        });
      }
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });

  it('lets a smooth glide finish when the window resizes mid-scroll, re-centering once it settles', () => {
    // The pitch sample is centered on the focus, so an ordinary arrow step can re-derive the window
    // mid-glide. Centering instantly then would land the strip on the target before the animation
    // ran and pin it there, turning the glide into a snap.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;
    const stubObserver = { disconnect() {}, observe() {}, unobserve() {} };

    try {
      const book = makeLargeBook(300);
      const props = requiredProps(book, { focusedTokenRef: 'large-tok-150' });
      const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

      // jsdom lays nothing out, so the geometry the window measures is supplied: a viewport wide
      // enough to ask for more groups, over groups spaced a fixed pitch apart.
      const viewport = screen.getByTestId('strip-scroll-viewport');
      const stripRow = screen.getByTestId('token-strip');
      Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 2000 });
      stripRow.querySelectorAll('[data-phrase-group="true"]').forEach((group, index) => {
        group.getBoundingClientRect = () => ({
          left: index * 100,
          right: index * 100,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
          x: index * 100,
          y: 0,
          toJSON: () => ({}),
        });
      });

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Echoing the emitted ref back the way the parent does is what makes the strip treat this
        // as internal navigation, which is the only path that glides rather than snapping.
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
        const emitted = props.onFocusedTokenRefChange.mock.calls.at(-1)?.[0];
        const nextRef = typeof emitted === 'string' ? emitted : undefined;
        rerender(<ContinuousViewHarness {...{ ...props, focusedTokenRef: nextRef }} />);

        scrollIntoViewMock.mockClear();
        const windowObserver = resizeObserverInstances.find((o) => o.targets.includes(viewport));
        if (!windowObserver) throw new Error('Expected the render window to observe the viewport');
        act(() => {
          windowObserver.callback([], stubObserver);
          jest.advanceTimersByTime(16);
        });

        expect(scrollIntoViewMock).not.toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'auto' }),
        );

        // jsdom never fires `scrollend`, so the settle arrives via the fallback timeout.
        act(() => {
          jest.advanceTimersByTime(700);
        });
        expect(scrollIntoViewMock).toHaveBeenCalledWith(
          expect.objectContaining({ behavior: 'auto' }),
        );
      } finally {
        act(() => {
          jest.useRealTimers();
        });
      }
    } finally {
      global.ResizeObserver = originalResizeObserver;
    }
  });
});

describe('ContinuousView phrase grouping', () => {
  it('groups adjacent tokens of the same phrase into a single PhraseBox', () => {
    phraseLinkMap.set('tok-0', {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    });
    phraseLinkMap.set('tok-1', {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    });
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    const phraseBoxes = document.querySelectorAll('[data-phrase-box="true"]');
    // Two tokens grouped → one box; plus the two free tokens from segment 2 → 3 total.
    expect(phraseBoxes).toHaveLength(3);
  });

  it('shows the gloss input on only the first fragment of a discontiguous phrase', () => {
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

    const phraseBoxes = document.querySelectorAll('[data-phrase-id="phrase-1"]');
    expect(phraseBoxes).toHaveLength(2);
    expect(phraseBoxes[0]).toHaveAttribute('data-show-gloss', 'true');
    expect(phraseBoxes[1]).toHaveAttribute('data-show-gloss', 'false');
  });

  it('clears the hovered phrase highlight when the pointer leaves the token strip', async () => {
    // tok-0/tok-1 grouped into one hoverable phrase so hovering it sets hoveredPhraseId (forwarded
    // to ArcOverlay); leaving the strip must reset it to undefined.
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

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
    // A click Next stamps the ref internally-originated; when the parent echoes it back, the
    // isInternal branch applies it immediately (no fade-out). The external branch would defer the
    // display update behind a fade timeout, leaving 'In' (tok-0) focused right after the rerender.
    const book = makeBook();
    const props = requiredProps(book, { focusedTokenRef: 'tok-0' });
    const { rerender } = render(<ContinuousViewHarness {...props} />, withAnalysisStore);

    // Sanity: tok-0's box ('In') is focused before the click.
    expect(screen.getByText('In').closest('[data-phrase-box="true"]')).toHaveAttribute(
      'data-focus-state',
      'focused',
    );

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );
    // Reflect the new ref back as a prop change; the click stamped it internal, so it applies at once.
    rerender(<ContinuousViewHarness {...props} focusedTokenRef="tok-1" />);

    // The displayed focus moved synchronously to tok-1's box ('the') — the internal path.
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
      ...FIXTURE_STAMPS,
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
      <ContinuousViewHarness
        {...requiredProps(book)}
        focusedTokenRef="tok-0"
        onFocusedTokenRefChange={onFocusedTokenRefChange}
      />,
      withAnalysisStore,
    );

    // Switch to edit mode for phrase-1.
    rerender(
      <ContinuousViewHarness
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
      ...FIXTURE_STAMPS,
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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);

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
      ...FIXTURE_STAMPS,
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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);
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
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);
    await userEvent.click(screen.getByTestId('arc-split-btn'));
    expect(deletePhrase).not.toHaveBeenCalled();
  });

  it('computes candidatePhraseIds from non-empty candidateTokenRefs', () => {
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    mockCandidateTokenRefs.current = new Set(['tok-0']);
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);
    // The hovered candidate ref (tok-0) resolves to its phrase, forwarded to ArcOverlay.
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute(
      'data-candidate-phrase-ids',
      'phrase-1',
    );
  });

  it('computes an empty candidatePhraseIds set when no candidate tokens are hovered', () => {
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    phraseLinkMap.set('tok-0', phraseLink);
    // No hovered candidate refs: the phrase exists, but nothing should resolve to it.
    mockCandidateTokenRefs.current = new Set();
    const book = makeBook();
    render(<ContinuousViewHarness {...requiredProps(book)} />, withAnalysisStore);
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute('data-candidate-phrase-ids', '');
  });
});
