/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, PhraseAnalysisLink, Token } from 'interlinearizer';
import type { ComponentProps, ReactNode } from 'react';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import { AltHeldProvider } from '../../components/AltHeldContext';
import ContinuousView from '../../components/ContinuousView';
import {
  createFocusStore,
  FocusStoreProvider,
  type FocusActions,
  type FocusOrigin,
} from '../../components/FocusStore';
import {
  SegmentationProvider,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import { isWordToken } from '../../types/type-guards';
import {
  FIXTURE_STAMPS,
  makePhraseLink,
  makePunctToken,
  makeSegment,
  makeWordToken,
} from '../test-helpers';
import {
  allFalseViewOptions,
  mockKeyAsValueLocalizedStrings,
  withAnalysisStore,
} from './test-helpers';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

/**
 * The intersection-observer Jest stub records instances on the global object and exposes a helper
 * to fire intersections. Declare the shape here so the test reads it without a type assertion.
 */
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var triggerIntersection: (el: Element, isIntersecting: boolean) => void;
}

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

/**
 * Builds a DOMRect reporting the given inline edges, so the window's cull walk has deterministic
 * geometry to read in jsdom, which performs no layout.
 */
function makeRect(left: number, right: number): DOMRect {
  return {
    top: 0,
    bottom: 0,
    left,
    right,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

/** Builds the lookup maps the strip is handed, derived from a Book. */
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

type StripProps = ComponentProps<typeof ContinuousView>;

/** Minimal strip props, so a test states only what it actually varies. */
function requiredProps(book: Book): StripProps {
  const { tokenSegmentMap, tokenDocOrder, wordTokenByRef } = buildLookups(book);
  return {
    book,
    editPhraseSegmentId: undefined,
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
    tokenSegmentMap,
    tokenDocOrder,
    wordTokenByRef,
    viewOptions: { ...allFalseViewOptions },
  };
}

/** What {@link renderStrip} hands back for driving and observing the mounted strip. */
type Strip = {
  /** Every focus the strip wrote, as `(tokenRef, origin)`. */
  focusToken: jest.Mock;
  /** Applies a focus from outside the strip, under the origin it should carry. */
  setFocus: (tokenRef: string | undefined, origin: FocusOrigin) => void;
  /** Re-renders with `next` merged over the strip's props; call with nothing for a plain re-render. */
  update: (next?: Partial<StripProps>) => void;
  container: HTMLElement;
};

/**
 * Mounts the strip over a real focus store seeded with `focus`, so focus arrives and leaves through
 * the store exactly as it does in the app.
 */
function renderStrip(
  book: Book,
  options?: Readonly<{ focus?: string; props?: Partial<StripProps> }>,
): Strip {
  const store = createFocusStore(options?.focus);
  const focusToken = jest.fn((tokenRef: string, origin: FocusOrigin) =>
    store.write(tokenRef, origin),
  );
  const actions: FocusActions = { focusToken, selectSegment: jest.fn() };
  let props: StripProps = { ...requiredProps(book), ...options?.props };
  const element = () => (
    <FocusStoreProvider store={store} actions={actions}>
      <ContinuousView {...props} />
    </FocusStoreProvider>
  );

  const view = render(element(), withAnalysisStore);

  return {
    focusToken,
    container: view.container,
    setFocus: (tokenRef, origin) => {
      act(() => store.write(tokenRef, origin));
    },
    update: (next) => {
      props = { ...props, ...next };
      view.rerender(element());
    },
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
    renderStrip(book);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
    expect(screen.getByText('beginning')).toBeInTheDocument();
    expect(screen.getByText('God')).toBeInTheDocument();
  });

  it('renders an inline verse-number superscript at each verse start', () => {
    const book = makeBook();
    renderStrip(book);

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
    renderStrip(splitBook);

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups.map((s) => s.textContent)).toEqual(['1:1']);
  });

  it('does not render an extension-generated segment separator', () => {
    const book = makeBook();
    renderStrip(book);

    expect(screen.queryByText('GEN 1:1')).not.toBeInTheDocument();
  });

  it('renders a Previous word button and a Next word button', () => {
    const book = makeBook();
    renderStrip(book);

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeInTheDocument();
  });

  it('renders a non-word token via InertTokenChip within the strip', () => {
    const book = makeMixedBook();
    renderStrip(book);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders without crashing when book has no word tokens', () => {
    const book = makeWordFreeBook();
    renderStrip(book);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('names its own focus on mount when nothing resolved one', () => {
    const book = makeBook();
    const strip = renderStrip(book);

    expect(strip.focusToken).toHaveBeenCalledWith('tok-0', 'seed');
  });

  it('names no focus on mount when one is already resolved', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('marks the phrase containing the focused token as focused', () => {
    const book = makeBook();
    renderStrip(book, { focus: 'tok-2' });

    const focusedBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    expect(focusedBox).toHaveAttribute('data-focus-state', 'focused');
  });

  it('falls back to the live focus while the displayed ref names a token this book lacks', () => {
    // Through a book change the displayed ref lags by one fade, briefly naming a token absent from
    // the mounted book. Seeded with such a ref, so the window has to follow the live focus rather
    // than collapse to phrase 0.
    const otherBook: Book = {
      id: 'MAT',
      bookRef: 'MAT',
      textVersion: '1',
      segments: [
        makeSegment('MAT 1:1', 'Alpha', [makeWordToken('mat-tok-0', 'Alpha')]),
        makeSegment('MAT 1:2', 'Beta', [makeWordToken('mat-tok-1', 'Beta')]),
      ],
    };
    const strip = renderStrip(otherBook, { focus: 'tok-2' });

    scrollIntoViewMock.mockClear();
    strip.setFocus('mat-tok-1', 'reseed');

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
    const strip = renderStrip(makeBook(), { focus: 'tok-2' });

    scrollIntoViewMock.mockClear();
    strip.update({ book: otherBook, ...buildLookups(otherBook) });
    strip.setFocus('mat-tok-1', 'reseed');

    const scrolledTexts = scrollIntoViewMock.mock.contexts.map((el) =>
      el instanceof HTMLElement ? el.textContent : undefined,
    );
    expect(scrolledTexts.some((t) => t?.includes('Beta'))).toBe(true);
  });
});

describe('ContinuousView focus changes', () => {
  it('focuses an out-of-focus phrase box when it is clicked', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    const clickedPhraseBox = screen.getByText('beginning').closest('[data-phrase-box="true"]');
    if (!clickedPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(clickedPhraseBox);

    expect(strip.focusToken).toHaveBeenCalledWith('tok-2', 'strip');
  });

  it('moves no focus when the already-focused phrase box is clicked', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('moves no focus when clicking the group of an already-focused non-first token', async () => {
    // tok-0/tok-1 grouped into one box (keyed by tok-0) with focus on tok-1: clicking the box stays
    // a no-op even though its group key differs from the focused token.
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
    const strip = renderStrip(book, { focus: 'tok-1' });

    const groupedBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!groupedBox) throw new Error('Expected phrase box wrapper for grouped tokens');

    await userEvent.click(groupedBox);

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('focuses the clicked phrase box when nothing was focused', async () => {
    const book = makeBook();
    const strip = renderStrip(book);

    const firstPhraseBox = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!firstPhraseBox) throw new Error('Expected phrase box wrapper for token');

    await userEvent.click(firstPhraseBox);

    // The mount seed already put focus on tok-0, so the click adds no move of its own.
    expect(strip.focusToken).toHaveBeenCalledTimes(1);
    expect(strip.focusToken).toHaveBeenCalledWith('tok-0', 'seed');
  });
});

describe('ContinuousView arrow disabled states', () => {
  it('disables the prev arrow when focus is on the first phrase', () => {
    const book = makeBook();
    renderStrip(book, { focus: 'tok-0' });

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
  });

  it('enables the prev arrow when focus is on a non-first phrase', () => {
    const book = makeBook();
    renderStrip(book, { focus: 'tok-2' });

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeEnabled();
  });

  it('disables the next arrow when focus is on the last phrase', () => {
    const book = makeBook();
    renderStrip(book, { focus: 'tok-3' });

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });

  it('enables the next arrow when focus is on a non-last phrase', () => {
    const book = makeBook();
    renderStrip(book, { focus: 'tok-0' });

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeEnabled();
  });

  it('disables both arrows when the book has a single token', () => {
    const book = makeSingleTokenBook();
    renderStrip(book, { focus: 'tok-only' });

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });

  it('disables both arrows when the book has no word tokens', () => {
    const book = makeWordFreeBook();
    renderStrip(book);

    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    ).toBeDisabled();
  });

  it('disables both arrows until the strip adopts a focus it has to travel to', () => {
    // The arrows stay on screen through the fade, so without this a press would step from the
    // incoming focus while the reader is still looking at the group it left.
    jest.useFakeTimers();
    try {
      const strip = renderStrip(makeBook(), { focus: 'tok-1' });
      const prev = () =>
        screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' });
      const next = () =>
        screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });
      expect(next()).not.toBeDisabled();

      strip.setFocus('tok-3', 'list');
      expect(prev()).toBeDisabled();
      expect(next()).toBeDisabled();

      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      expect(prev()).not.toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView arrow navigation', () => {
  it('focuses the next phrase when Next is clicked', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(strip.focusToken).toHaveBeenCalledWith('tok-1', 'strip');
  });

  it('focuses the previous phrase when Previous is clicked', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
    );

    expect(strip.focusToken).toHaveBeenCalledWith('tok-0', 'strip');
  });

  it('crosses verse boundaries via the Next arrow', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(strip.focusToken).toHaveBeenCalledWith('tok-2', 'strip');
  });

  it('crosses chapter boundaries via the Next arrow', async () => {
    const book = makeTwoChapterBook();
    const strip = renderStrip(book, { focus: 'ch1-tok-0' });

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

    expect(strip.focusToken).toHaveBeenCalledWith('ch2-tok-0', 'strip');
  });

  it('advances two groups on rapid double-click before re-render', async () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });
    const next = screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });

    await userEvent.click(next);
    await userEvent.click(next);

    expect(strip.focusToken).toHaveBeenNthCalledWith(1, 'tok-1', 'strip');
    expect(strip.focusToken).toHaveBeenNthCalledWith(2, 'tok-2', 'strip');
  });

  it('steps from the regrouped index after a phrase link moves the focused group', async () => {
    // Linking earlier tokens into one phrase shifts every later group index while moving no focus.
    // A step counting from its own last target would then skip the group beside the focused one.
    const book = makeLargeBook(5);
    const strip = renderStrip(book, { focus: 'large-tok-1' });
    const next = screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });

    // A move the strip made itself, so it is its own last target that a later step could count from.
    await userEvent.click(next);
    expect(strip.focusToken).toHaveBeenNthCalledWith(1, 'large-tok-2', 'strip');

    // Joining the first two tokens pulls the focused token's group index down by one.
    addPhraseLinkWithNewIdentity(
      makePhraseLink('phrase-1', ['large-tok-0', 'large-tok-1'], ['word0', 'word1']),
    );
    strip.update();

    await userEvent.click(next);

    expect(strip.focusToken).toHaveBeenNthCalledWith(2, 'large-tok-3', 'strip');
  });

  it('steps from a focus it did not choose rather than from its own last target', async () => {
    // A step counts from where the strip is heading, so rapid presses accumulate. A focus the strip
    // did not choose has to reset that count, or the press after one lands a group off.
    jest.useFakeTimers();
    try {
      const book = makeBook();
      const strip = renderStrip(book, { focus: 'tok-1' });

      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
      );
      expect(strip.focusToken).toHaveBeenNthCalledWith(1, 'tok-2', 'strip');

      // A focus from outside the strip, given the fade it takes to arrive.
      strip.setFocus('tok-3', 'list');
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_previousToken%' }),
      );
      expect(strip.focusToken).toHaveBeenNthCalledWith(2, 'tok-2', 'strip');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView wheel navigation', () => {
  it('focuses the next phrase on a downward wheel notch', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: 100, deltaX: 0 });

    expect(strip.focusToken).toHaveBeenCalledWith('tok-1', 'strip');
  });

  it('focuses the previous phrase on an upward wheel notch', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: -100, deltaX: 0 });

    expect(strip.focusToken).toHaveBeenCalledWith('tok-0', 'strip');
  });

  it('steps by the horizontal delta when it dominates the gesture', () => {
    // A trackpad swipe reports both axes; the strip travels by whichever the reader meant.
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaX: -100, deltaY: 10 });

    expect(strip.focusToken).toHaveBeenCalledWith('tok-0', 'strip');
  });

  it('moves no focus when the wheel reports no travel on either axis', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-1' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaX: 0, deltaY: 0 });

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('steps no further than the last phrase', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-3' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: 100, deltaX: 0 });

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('steps no earlier than the first phrase', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: -100, deltaX: 0 });

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('takes no step while the strip is mid-jump to a focus it has to travel to', () => {
    // The arrows are disabled through this window; a wheel notch must not slip past the same gate
    // and count from a phrase the reader can no longer see. The book is long enough that the step
    // this asserts against would otherwise land on a real phrase.
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(40);
      const strip = renderStrip(book, { focus: 'large-tok-0' });

      strip.setFocus('large-tok-20', 'list');
      strip.focusToken.mockClear();

      fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: 100, deltaX: 0 });

      expect(strip.focusToken).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('steps again once the jump it was travelling to has landed', () => {
    // The gate is a mid-jump hold, not a lasting refusal: once the fade delivers the new focus the
    // wheel counts from it like any other.
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(40);
      const strip = renderStrip(book, { focus: 'large-tok-0' });

      strip.setFocus('large-tok-20', 'list');
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });
      strip.focusToken.mockClear();

      fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: 100, deltaX: 0 });

      expect(strip.focusToken).toHaveBeenCalledWith('large-tok-21', 'strip');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView scroll behavior', () => {
  it('calls scrollIntoView on initial mount', () => {
    const book = makeBook();
    renderStrip(book);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });

  it('uses instant scroll for a focus it did not choose', () => {
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });

    scrollIntoViewMock.mockClear();
    act(() => {
      jest.useFakeTimers();
    });
    strip.setFocus('tok-3', 'reseed');
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
    const strip = renderStrip(book, { focus: 'tok-0' });

    act(() => {
      jest.useFakeTimers();
    });
    try {
      // tok-1 shares GEN 1:1 with tok-0, so the active segment is unchanged by this jump.
      strip.setFocus('tok-1', 'list');
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
      const strip = renderStrip(book, { focus: 'tok-0' });

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // tok-1 shares GEN 1:1 with tok-0, so the active segment is unchanged: only the scroll
        // effect's own hold loop keeps the group pinned.
        strip.setFocus('tok-1', 'list');
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
      const strip = renderStrip(book, { focus: 'tok-0' });

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Drive the hold loop via an external jump so it runs under fake-timer control (jsdom rAF on
        // the initial real-timer mount is not deterministically advanceable). tok-1 shares GEN 1:1
        // with tok-0, so there's no committed-active-segment flip: only the scroll effect's own hold
        // pins the group, exercising the same observer lifetime as the initial mount.
        strip.setFocus('tok-1', 'request');
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
    const strip = renderStrip(book, { focus: 'tok-0' });

    act(() => {
      jest.useFakeTimers();
    });
    // External nav into the other verse: the active segment commits instantly behind the fade, so
    // the slots snap to their new widths rather than animating (which would slide the boxes).
    strip.setFocus('tok-3', 'reseed');

    const slotWrapper = strip.container.querySelector('[data-testid="link-slot-icon"]');
    if (!(slotWrapper instanceof HTMLElement)) throw new Error('Expected a link-slot icon wrapper');
    expect(slotWrapper.style.transitionDuration).toBe('0ms');

    act(() => {
      jest.advanceTimersByTime(600);
      jest.useRealTimers();
    });
  });

  it('reveals the strip after an external jump that lands in the group already displayed', async () => {
    // Both tokens belong to one phrase, so the jump leaves focusPhraseIndex untouched and the
    // scroll effect never re-runs.
    const phraseLink = makePhraseLink('phrase-1', ['tok-2', 'tok-3'], ['beginning', 'God']);
    phraseLinkMap.set('tok-2', phraseLink);
    phraseLinkMap.set('tok-3', phraseLink);
    const strip = renderStrip(makeBook(), { focus: 'tok-2' });
    const stripClass = () => screen.getByTestId('strip-fade-wrapper').className;
    await waitFor(() => expect(stripClass()).toContain('tw:opacity-100'));

    jest.useFakeTimers();
    try {
      strip.setFocus('tok-3', 'list');
      expect(stripClass()).toContain('tw:opacity-0');

      // Let the fade reach its timeout instead of superseding it, so the reveal has to come from
      // the fade completing — the neighboring tests cover the superseded route.
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      expect(stripClass()).toContain('tw:opacity-100');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reveals the strip again when a phrase click supersedes a jump mid-fade', async () => {
    // Opacity does not stop pointer events, so a half-faded phrase box is still clickable.
    const strip = renderStrip(makeBook(), { focus: 'tok-0' });
    const stripClass = () => screen.getByTestId('strip-fade-wrapper').className;
    await waitFor(() => expect(stripClass()).toContain('tw:opacity-100'));

    strip.setFocus('tok-3', 'list');
    expect(stripClass()).toContain('tw:opacity-0');

    const box = screen.getByText('In').closest('[data-phrase-box="true"]');
    if (!box) throw new Error('Expected phrase box wrapper for token');
    await userEvent.click(box);

    expect(stripClass()).toContain('tw:opacity-100');
  });

  it('reveals the strip again when entering a phrase mode supersedes a jump mid-fade', async () => {
    const phraseLink = makePhraseLink('phrase-1', ['tok-2', 'tok-3'], ['beginning', 'God']);
    phraseLinkMap.set('tok-2', phraseLink);
    phraseLinkMap.set('tok-3', phraseLink);
    const strip = renderStrip(makeBook(), { focus: 'tok-0' });
    const stripClass = () => screen.getByTestId('strip-fade-wrapper').className;
    await waitFor(() => expect(stripClass()).toContain('tw:opacity-100'));

    // Glide first: an instant jump's teardown reveals the strip on its way out, which would mask
    // whether superseding does.
    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );
    await waitFor(() => expect(stripClass()).toContain('tw:opacity-100'));

    strip.setFocus('tok-3', 'reseed');
    expect(stripClass()).toContain('tw:opacity-0');

    strip.update({
      phraseMode: { kind: 'edit', phraseId: 'phrase-1', originalTokens: phraseLink.tokens },
    });

    expect(stripClass()).toContain('tw:opacity-100');
  });

  it('smooth-scrolls for a move it made itself', async () => {
    renderStrip(makeBook(), { focus: 'tok-0' });
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
    renderStrip(makeBook(), {
      focus: 'tok-1',
      props: { viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true } },
    });
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
    const mergedLookups = buildLookups(merged);
    /** Whether the tok-0/tok-1 link icon (in GEN 1:1) is mounted and visible. */
    const inSegmentIconMounted = () => {
      const icon = document.querySelector<HTMLElement>(
        '[data-prev-ref="tok-0"][data-next-ref="tok-1"]',
      );
      return !!icon && icon.parentElement?.style.opacity !== '0';
    };
    jest.useFakeTimers();
    try {
      const strip = renderStrip(book, {
        focus: 'tok-1',
        props: { viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true } },
      });
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
        strip.update({ book: merged, ...mergedLookups });
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
    renderStrip(book, { focus: 'tok-0' });

    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest', inline: 'center' }),
    );
  });

  it('re-centers once when simplifyPhrases toggles but not when hideInactiveLinkButtons toggles', () => {
    // Inactive link slots hide via visibility:hidden (not max-width collapse), so toggling
    // hideInactiveLinkButtons doesn't shift layout; simplifyPhrases does, so it re-centers once.
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });
    scrollIntoViewMock.mockClear();

    strip.update({ viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true } });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    strip.update({
      viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true, simplifyPhrases: true },
    });
    expect(scrollIntoViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', inline: 'center' }),
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
  });

  it('re-centers once when showMorphology toggles', () => {
    // Morpheme rows beneath tokens can widen phrase boxes, shifting the strip layout, so the
    // focused group must be snapped back to center when the toggle flips.
    const book = makeBook();
    const strip = renderStrip(book, { focus: 'tok-0' });
    scrollIntoViewMock.mockClear();

    strip.update({ viewOptions: { ...allFalseViewOptions, showMorphology: true } });
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
    const strip = renderStrip(book, {
      focus: 'tok-2',
      props: { viewOptions: { ...allFalseViewOptions, hideInactiveLinkButtons: true } },
    });

    // Focus sits in GEN 1:2, so the slot between its two tokens is active and visible.
    expect(slotOpacity(strip.container, 'tok-2', 'tok-3')).toBe('1');

    // Merge GEN 1:2 into GEN 1:1. Token refs survive, so focus stays put, but the focused token's
    // segment id changes.
    const merged = resegmentBook(book, { removedVerseStarts: ['tok-2'], addedStarts: [] });
    strip.update({ book: merged, ...buildLookups(merged) });

    // The committed active segment must follow the merge; a stale id would suppress every link
    // button until the next navigation.
    expect(slotOpacity(strip.container, 'tok-2', 'tok-3')).toBe('1');
  });
});

describe('ContinuousView split marker', () => {
  /**
   * Renders ContinuousView wrapped in the segmentation and Alt-held providers so the shared
   * split-gap marker can be exercised in the horizontal strip.
   *
   * @param altHeld - Whether Alt is held (defaults to held, so the marker appears).
   */
  function renderSplitMarker(altHeld = true) {
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
          <FocusStoreProvider
            store={createFocusStore('tok-0')}
            actions={{ focusToken: jest.fn(), selectSegment: jest.fn() }}
          >
            <ContinuousView {...requiredProps(book)} />
          </FocusStoreProvider>
        </AltHeldProvider>
      </SegmentationProvider>,
      withAnalysisStore,
    );
    return dispatch;
  }

  it('reveals a split marker on an intra-segment gap while Alt is held', () => {
    renderSplitMarker(true);
    expect(screen.getAllByTestId('boundary-split-marker').length).toBeGreaterThan(0);
  });

  it('reveals no split marker while Alt is not held', () => {
    renderSplitMarker(false);
    expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
  });

  it('dispatches a split on an Alt+click of the strip marker', () => {
    const dispatch = renderSplitMarker(true);
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
    renderStrip(book);

    const prev = screen.getByRole('button', {
      name: '%interlinearizer_continuousView_previousToken%',
    });
    expect(prev.textContent).toContain('→');
  });

  it('uses left-pointing arrow for Next in RTL', () => {
    document.documentElement.dir = 'rtl';
    const book = makeBook();
    renderStrip(book);

    const next = screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' });
    expect(next.textContent).toContain('←');
  });

  it('uses left-pointing arrow for Previous in LTR', () => {
    document.documentElement.dir = 'ltr';
    const book = makeBook();
    renderStrip(book);

    const prev = screen.getByRole('button', {
      name: '%interlinearizer_continuousView_previousToken%',
    });
    expect(prev.textContent).toContain('←');
  });
});

describe('ContinuousView phrase window', () => {
  it('renders the focused phrase from a large book', () => {
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-150' });

    expect(screen.getByText('word150')).toBeInTheDocument();
  });

  it('does not render tokens that fall outside the rendered window', () => {
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-0' });

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
    renderStrip(book, { focus: 'large-tok-150' });

    expect(screen.getByText('word190')).toBeInTheDocument();
  });

  it('widens no further than the phrase span it is covering', () => {
    linkFarApartTokens();
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-150' });

    expect(screen.queryByText('word200')).not.toBeInTheDocument();
  });

  it('re-centers when a new phrase link pulls the window start back behind the focus', () => {
    // Widening start-ward mounts groups ahead of the focus at an unchanged scroll offset, the same
    // shift a resize causes — but the window size is unchanged, so a size-keyed correction misses it.
    const book = makeLargeBook(300);
    const strip = renderStrip(book, { focus: 'large-tok-150' });

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
    strip.update();

    expect(screen.getByText('word110')).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('leaves an unlinked token at the same distance outside the window', () => {
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-150' });

    expect(screen.queryByText('word190')).not.toBeInTheDocument();
  });

  it('re-centers the focused group when the window grows start-ward beneath it', () => {
    // The focus never moves here, so no focus-keyed centering path fires; without the window-keyed
    // one the groups mounting ahead of the focus carry it off the strip.
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-150' });
    const stripRow = screen.getByTestId('token-strip');
    const mountedGroups = () => stripRow.querySelectorAll('[data-phrase-group="true"]').length;

    const groupsBefore = mountedGroups();
    scrollIntoViewMock.mockClear();

    act(() => {
      global.triggerIntersection(screen.getByTestId('strip-leading-sentinel'), true);
    });

    expect(mountedGroups()).toBeGreaterThan(groupsBefore);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center',
    });
  });

  it('re-centers after a window change whose focus move left the start clamped at the book start', () => {
    // A focus step whose start stays clamped at 0 leaves the window-keyed correction dormant, so
    // the focus index it compares against has to stay current without it running.
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(300);
      // Focused close enough to the book start that the window's start clamps to 0, so the step
      // below moves the focus without moving the start.
      const strip = renderStrip(book, { focus: 'large-tok-4' });

      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
      );
      expect(strip.focusToken).toHaveBeenLastCalledWith('large-tok-5', 'strip');
      strip.update();

      // Let the step's own glide settle, so the deferred-correction path is not what answers the
      // window move below. Long enough to outrun the timeout that backstops `scrollend`.
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Move the window's start off 0 under a now-stationary focus, which is what the correction
      // exists to answer. jsdom lays nothing out, so the cull geometry is supplied: only the groups
      // ahead of the focused one sit past the retention margin, so the cull stops at the focus and
      // leaves it mounted for the correction to center.
      const viewport = screen.getByTestId('strip-scroll-viewport');
      viewport.getBoundingClientRect = () => makeRect(0, 1000);
      screen
        .getByTestId('token-strip')
        .querySelectorAll('[data-phrase-group="true"]')
        .forEach((group) => {
          const isBeforeFocus = Number(group.textContent?.replace('word', '')) < 5;
          const left = isBeforeFocus ? -20000 : 100;
          group.getBoundingClientRect = () => makeRect(left, left + 100);
        });

      scrollIntoViewMock.mockClear();
      act(() => {
        global.triggerIntersection(screen.getByTestId('strip-trailing-sentinel'), true);
      });

      // Losing the baseline leaves the correction dormant, so the strip is never re-centered on the
      // group the focus is actually on.
      const centeredGroups = scrollIntoViewMock.mock.instances.map((el: unknown) =>
        el instanceof HTMLElement ? el.textContent : undefined,
      );
      expect(centeredGroups).toContain('word5');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops holding the previously-centered group once the reader navigates away', () => {
    // A navigation slides the window, which is itself a content resize — so a hold left over from
    // the window change restarts its loop, instant-scrolls back to the group the reader just left,
    // and parks the strip there.
    const originalResizeObserver = global.ResizeObserver;
    resizeObserverInstances = [];
    global.ResizeObserver = TrackingResizeObserver;
    const stubObserver = { disconnect() {}, observe() {}, unobserve() {} };

    try {
      const book = makeLargeBook(300);
      const strip = renderStrip(book, { focus: 'large-tok-150' });
      const stripRow = screen.getByTestId('token-strip');

      act(() => {
        jest.useFakeTimers();
      });
      try {
        // Grow the window start-ward, which arms the hold on the currently-focused group.
        act(() => {
          global.triggerIntersection(screen.getByTestId('strip-leading-sentinel'), true);
        });

        // Navigate one phrase forward while that hold is still alive; the strip's own move is the
        // path that glides.
        fireEvent.click(
          screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
        );
        expect(strip.focusToken).toHaveBeenLastCalledWith('large-tok-151', 'strip');
        strip.update();

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

  it('lets a smooth glide finish when the window grows mid-scroll, re-centering once it settles', () => {
    // A sentinel reaching the viewport can grow the window while a step's glide is still animating.
    // Centering instantly then would land the strip on the target before the animation ran and pin
    // it there, turning the glide into a snap.
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(300);
      const strip = renderStrip(book, { focus: 'large-tok-150' });

      // A move the strip makes itself is the only path that glides rather than snapping.
      fireEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
      );
      strip.update();

      scrollIntoViewMock.mockClear();
      act(() => {
        global.triggerIntersection(screen.getByTestId('strip-leading-sentinel'), true);
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
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView free-scroll wheel mode', () => {
  /** Mounts the strip with free-scroll enabled, so a wheel scrolls rather than steps. */
  function renderFreeScrolling(focus: string) {
    const book = makeLargeBook(300);
    return renderStrip(book, {
      focus,
      props: { viewOptions: { ...allFalseViewOptions, freeScrollStrip: true } },
    });
  }

  it('moves no focus on a wheel notch', () => {
    const strip = renderFreeScrolling('large-tok-150');

    fireEvent.wheel(screen.getByTestId('strip-scroll-viewport'), { deltaY: 100, deltaX: 0 });

    expect(strip.focusToken).not.toHaveBeenCalled();
  });

  it('scrolls the viewport forward on a downward wheel notch', () => {
    renderFreeScrolling('large-tok-150');
    const viewport = screen.getByTestId('strip-scroll-viewport');
    viewport.scrollLeft = 0;

    fireEvent.wheel(viewport, { deltaY: 100, deltaX: 0 });

    expect(viewport.scrollLeft).toBeGreaterThan(0);
  });

  it('scrolls the viewport backward on an upward wheel notch', () => {
    renderFreeScrolling('large-tok-150');
    const viewport = screen.getByTestId('strip-scroll-viewport');
    viewport.scrollLeft = 500;

    fireEvent.wheel(viewport, { deltaY: -100, deltaX: 0 });

    expect(viewport.scrollLeft).toBeLessThan(500);
  });

  it('re-centers no focus while the reader scrolls the window along', () => {
    // Centering is what the reader's scroll is competing with: a correction fired by the groups the
    // scroll mounts would drag the strip straight back to the focused phrase.
    renderFreeScrolling('large-tok-150');
    scrollIntoViewMock.mockClear();

    act(() => {
      global.triggerIntersection(screen.getByTestId('strip-leading-sentinel'), true);
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('re-centers the focus again once it moves', () => {
    jest.useFakeTimers();
    try {
      const strip = renderFreeScrolling('large-tok-150');
      scrollIntoViewMock.mockClear();

      // A move from outside the strip, given the fade it takes to arrive.
      strip.setFocus('large-tok-151', 'list');
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      const centeredGroups = scrollIntoViewMock.mock.instances.map((el: unknown) =>
        el instanceof HTMLElement ? el.textContent : undefined,
      );
      expect(centeredGroups).toContain('word151');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ContinuousView return to focus', () => {
  it('mounts the focused group again after the strip has been scrolled past it', () => {
    // The focused group can be culled while the reader scrolls, so the control has to rebuild the
    // window around it rather than scroll to an element that is no longer there.
    const book = makeLargeBook(300);
    renderStrip(book, { focus: 'large-tok-150' });
    const viewport = screen.getByTestId('strip-scroll-viewport');
    viewport.getBoundingClientRect = () => makeRect(0, 1000);
    screen
      .getByTestId('token-strip')
      .querySelectorAll('[data-phrase-group="true"]')
      .forEach((group) => {
        group.getBoundingClientRect = () => makeRect(-20000, -19900);
      });

    act(() => {
      global.triggerIntersection(screen.getByTestId('strip-trailing-sentinel'), true);
    });
    expect(screen.queryByText('word150')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_returnToFocus%' }),
    );

    expect(screen.getByText('word150')).toBeInTheDocument();
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
    renderStrip(book);

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
    renderStrip(book);

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
    renderStrip(book);

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

  it('applies a click-driven focus move immediately, with no fade', async () => {
    // A move the strip made itself takes the internal branch, which applies it at once. The other
    // branch would defer the display update behind a fade timeout, leaving 'In' (tok-0) focused.
    const book = makeBook();
    renderStrip(book, { focus: 'tok-0' });

    // Sanity: tok-0's box ('In') is focused before the click.
    expect(screen.getByText('In').closest('[data-phrase-box="true"]')).toHaveAttribute(
      'data-focus-state',
      'focused',
    );

    await userEvent.click(
      screen.getByRole('button', { name: '%interlinearizer_continuousView_nextToken%' }),
    );

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
    const strip = renderStrip(book, { focus: 'tok-0' });

    // Switch to edit mode for phrase-1.
    strip.update({
      phraseMode: { kind: 'edit', phraseId: 'phrase-1', originalTokens: phraseLink.tokens },
    });
    expect(strip.focusToken).toHaveBeenCalledWith('tok-2', 'strip');
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
    renderStrip(book);

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
    renderStrip(book);
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
    renderStrip(book);
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
    renderStrip(book);
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
    renderStrip(book);
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute('data-candidate-phrase-ids', '');
  });
});
