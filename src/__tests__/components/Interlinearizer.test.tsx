/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import type { Book, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { useState } from 'react';
import Interlinearizer from '../../components/Interlinearizer';
import { InterlinearNavProvider } from '../../components/InterlinearNavContext';
import type { SegmentDisplayMode } from '../../components/SegmentView';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import { defaultScrRef, GEN_1_1_BOOK } from '../test-helpers';

jest.mock('lucide-react', () => ({
  __esModule: true,
  /**
   * Stub for the LocateFixed icon; renders a minimal SVG so icon-presence assertions work.
   *
   * @returns An SVG element with `data-testid="locate-fixed-icon"`.
   */
  LocateFixed: () => <svg data-testid="locate-fixed-icon" />,
}));

/**
 * Props captured from ContinuousView renders so tests can assert on what Interlinearizer passes
 * down.
 */
type CapturedContinuousViewProps = {
  /** The full tokenized book. */
  book: Book;
  /** The `Token.ref` string of the currently focused token, if any. */
  focusedTokenRef: string | undefined;
  /** Called when the strip changes focus via arrow nav or click. */
  onFocusedTokenRefChange: (ref: string) => void;
  /** Token ref → segment id lookup. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Word token ref → token lookup. */
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
};
let capturedContinuousViewProps: CapturedContinuousViewProps | undefined;

/** Props captured from SegmentView renders so tests can assert on what Interlinearizer passes down. */
type CapturedSegmentViewProps = {
  /** The segment the component is asked to render. */
  segment: Segment;
  /** Controls whether tokens are rendered as chips or as raw baseline text. */
  displayMode: SegmentDisplayMode;
  /** The `Token.ref` string of the currently focused token, if any. */
  focusedTokenRef: string | undefined;
  /** Whether this segment corresponds to the currently active verse. */
  isActive: boolean;
  /** Called when the user selects a token. */
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  /** PhraseId currently hovered anywhere in the interlinearizer. */
  hoveredPhraseId: string | undefined;
  /** Called when the pointer enters or leaves a phrase box. */
  onHoverPhrase: (phraseId: string | undefined) => void;
};
let capturedSegmentViewPropsList: CapturedSegmentViewProps[] = [];

/** Stable spy for `updatePhrase` — reset between tests via resetMocks. */
const mockUpdatePhrase = jest.fn();

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  /**
   * Pass-through provider stub that renders children directly, keeping AnalysisStore.tsx out of
   * scope.
   *
   * @param props - Component props.
   * @param props.children - Child nodes to render.
   * @returns The children unchanged.
   */
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
    return children;
  },
  /**
   * Returns a fixed empty gloss string for any token.
   *
   * @returns An empty string.
   */
  useGloss: () => '',
  /**
   * Returns a no-op dispatch function.
   *
   * @returns A function that accepts any arguments and does nothing.
   */
  useGlossDispatch: () => () => {},
  /**
   * Returns an empty map; cross-segment arc logic is a layout effect that no-ops in jsdom.
   *
   * @returns An empty `Map`.
   */
  usePhraseLinkMap: () => new Map(),
  usePhraseLinkByIdMap: () => new Map(),
  usePhraseDispatch: () => ({
    createPhrase: () => {},
    updatePhrase: (...args: Parameters<typeof mockUpdatePhrase>) => mockUpdatePhrase(...args),
    deletePhrase: () => {},
  }),
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: CapturedContinuousViewProps) => {
    capturedContinuousViewProps = props;
    return (
      <div data-focused-token-ref={props.focusedTokenRef ?? ''} data-testid="continuous-view" />
    );
  },
}));

jest.mock('../../components/SegmentView', () => ({
  __esModule: true,
  /**
   * Named export stub for SegmentView; captures received props and renders a minimal div.
   *
   * @param props - The props passed by Interlinearizer.
   * @param props.segment - The segment being rendered.
   * @param props.isActive - Whether this segment is the active verse.
   * @param props.hoveredPhraseId - PhraseId currently hovered.
   * @param props.onHoverPhrase - Hover callback.
   * @param props.rest - Any additional props forwarded from the parent.
   * @returns A div with `data-testid="segment-view"` and the segment id.
   */
  SegmentView: ({
    segment,
    isActive,
    hoveredPhraseId,
    onHoverPhrase,
    ...rest
  }: CapturedSegmentViewProps) => {
    capturedSegmentViewPropsList.push({
      segment,
      isActive,
      hoveredPhraseId,
      onHoverPhrase,
      ...rest,
    });
    return (
      <div
        aria-current={isActive ? 'true' : undefined}
        data-testid="segment-view"
        data-segment-id={segment.id}
      />
    );
  },
  /**
   * Default export stub for SegmentView; captures received props and renders a minimal div.
   *
   * @param props - The props passed by Interlinearizer.
   * @param props.segment - The segment being rendered.
   * @param props.isActive - Whether this segment is the active verse.
   * @param props.hoveredPhraseId - PhraseId currently hovered.
   * @param props.onHoverPhrase - Hover callback.
   * @param props.rest - Any additional props forwarded from the parent.
   * @returns A div with `data-testid="segment-view"` and the segment id.
   */
  default: ({
    segment,
    isActive,
    hoveredPhraseId,
    onHoverPhrase,
    ...rest
  }: CapturedSegmentViewProps) => {
    capturedSegmentViewPropsList.push({
      segment,
      isActive,
      hoveredPhraseId,
      onHoverPhrase,
      ...rest,
    });
    return (
      <div
        aria-current={isActive ? 'true' : undefined}
        data-testid="segment-view"
        data-segment-id={segment.id}
      />
    );
  },
}));

jest.mock('../../components/controls/EditPhraseControls', () => ({
  __esModule: true,
  /**
   * Minimal EditPhraseControls stub exposing the done button the toolbar tests assert on.
   *
   * @returns A stub div carrying the `done-edit-btn` test id.
   */
  default: () => (
    <div data-testid="edit-phrase-controls">
      <button data-testid="done-edit-btn" type="button">
        Done
      </button>
    </div>
  ),
}));

jest.mock('../../components/modals/UnlinkPhraseConfirm', () => ({
  __esModule: true,
  /**
   * Minimal UnlinkPhraseConfirm stub exposing the confirm container the toolbar tests assert on.
   *
   * @returns A stub div carrying the `unlink-confirm` test id.
   */
  default: () => <div data-testid="unlink-confirm" />,
}));

/** Pre-built Book with no segments — used by the no-verse-data test. */
const GEN_EMPTY_BOOK: Book = { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments: [] };

/**
 * Builds a GEN book with `count` single-token verses in chapter 1. Used to exercise the segment
 * window's recenter fade, which only triggers when the new active verse is outside the rendered
 * window — impossible with the small fixtures above.
 *
 * @param count - Number of verses to generate.
 * @returns A {@link Book} with `count` chapter-1 segments.
 */
function makeLargeBook(count: number): Book {
  const segments: Segment[] = [];
  for (let v = 1; v <= count; v += 1) {
    segments.push({
      id: `GEN 1:${v}`,
      startRef: { book: 'GEN', chapter: 1, verse: v },
      endRef: { book: 'GEN', chapter: 1, verse: v },
      baselineText: 'word',
      tokens: [
        {
          ref: `GEN 1:${v}:0`,
          surfaceText: 'word',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 4,
        },
      ],
    });
  }
  return { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments };
}

/** Book with two segments in GEN 1 — used by chapter-display tests. */
const GEN_1_MULTI_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          ref: 'GEN 1:1:0',
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
      baselineText: 'And the earth.',
      tokens: [
        {
          ref: 'GEN 1:2:0',
          surfaceText: 'And',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 3,
        },
      ],
    },
  ],
};

/**
 * Two-chapter GEN book: chapter 1 has verses 1-2, chapter 2 has verses 1-2. Used to exercise the
 * focus-reseed guard when the host echoes a click back at chapter granularity (verse-0 / first
 * verse), which a verse-exact guard would misread as the chapter's first segment.
 */
const GEN_TWO_CHAPTER_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [1, 2].flatMap((chapter) =>
    [1, 2].map((verse) => ({
      id: `GEN ${chapter}:${verse}`,
      startRef: { book: 'GEN', chapter, verse },
      endRef: { book: 'GEN', chapter, verse },
      baselineText: 'Word.',
      tokens: [
        {
          ref: `GEN ${chapter}:${verse}:0`,
          surfaceText: 'Word',
          writingSystem: 'en',
          type: 'word' as const,
          charStart: 0,
          charEnd: 4,
        },
      ],
    })),
  ),
};

/**
 * Wraps an `<Interlinearizer>` element in an {@link InterlinearNavProvider} so the component's
 * `useInterlinearNav` call resolves. `Interlinearizer` now writes the reference through the
 * context's `navigate` (which calls the scroll-group hook's setter), so navigation assertions hang
 * off the `navigate` spy supplied here rather than a `setScrRef` prop.
 *
 * @param ui - The `<Interlinearizer>` element to wrap.
 * @param navigate - Spy wired as the scroll-group hook's setter; receives the reference each
 *   `navigate` call writes. Defaults to a noop.
 * @returns The element wrapped in a nav provider.
 */
function withNav(ui: ReactNode, navigate: (r: SerializedVerseRef) => void = () => {}): ReactNode {
  const scrollGroupHook = (): [
    SerializedVerseRef,
    (r: SerializedVerseRef) => void,
    number | undefined,
    (id: number | undefined) => void,
  ] => [defaultScrRef, navigate, undefined, () => {}];
  return (
    <InterlinearNavProvider useWebViewScrollGroupScrRef={scrollGroupHook}>
      {ui}
    </InterlinearNavProvider>
  );
}

/**
 * Renders an Interlinearizer component with sensible defaults, allowing individual props to be
 * overridden per test. Wrapped in an {@link InterlinearNavProvider} via {@link withNav}; `navigate`
 * is the spy that captures references the component writes through the context.
 *
 * @param options - Partial props to merge over the defaults.
 * @returns The render result from @testing-library/react.
 */
function renderInterlinearizer({
  book = GEN_1_1_BOOK,
  continuousScroll = false,
  scrRef = defaultScrRef,
  navigate = () => {},
  hideInactiveLinkButtons = false,
  simplifyPhrases = false,
  chapterLabelInVerse = false,
}: {
  book?: Book;
  continuousScroll?: boolean;
  scrRef?: SerializedVerseRef;
  navigate?: (r: SerializedVerseRef) => void;
  hideInactiveLinkButtons?: boolean;
  simplifyPhrases?: boolean;
  chapterLabelInVerse?: boolean;
} = {}) {
  return render(
    withNav(
      <Interlinearizer
        book={book}
        continuousScroll={continuousScroll}
        scrRef={scrRef}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={hideInactiveLinkButtons}
        simplifyPhrases={simplifyPhrases}
        chapterLabelInVerse={chapterLabelInVerse}
      />,
      navigate,
    ),
  );
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView; stub it globally so components that call it don't throw.
  Element.prototype.scrollIntoView = jest.fn();
});

describe('Interlinearizer', () => {
  beforeEach(() => {
    capturedContinuousViewProps = undefined;
    capturedSegmentViewPropsList = [];
  });

  it('renders a SegmentView when the tokenized book has a segment for the current reference', () => {
    renderInterlinearizer();

    expect(screen.getAllByTestId('segment-view')).toHaveLength(1);
  });

  it('shows a no-verse message when the tokenized book has no segments at all', () => {
    renderInterlinearizer({ book: GEN_EMPTY_BOOK });

    expect(screen.getByText(/no verse data for gen 1\./i)).toBeInTheDocument();
  });

  it('renders a SegmentView for every segment in the current chapter', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
    expect(capturedSegmentViewPropsList[0].segment.id).toBe('GEN 1:1');
    expect(capturedSegmentViewPropsList[1].segment.id).toBe('GEN 1:2');
  });

  it('passes isActive=true only to the segment matching the current verse', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });

    // defaultScrRef is GEN 1:1
    expect(capturedSegmentViewPropsList[0].isActive).toBe(true);
    expect(capturedSegmentViewPropsList[1].isActive).toBeFalsy();
  });

  it('renders all segments when navigating to a title reference (verse 0)', () => {
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, scrRef: titleRef });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
  });

  it('calls setScrRef with the segment ref when a segment fires onSelect', () => {
    const mockNavigate = jest.fn();
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, navigate: mockNavigate });

    capturedSegmentViewPropsList[1].onSelect?.({ book: 'GEN', chapter: 1, verse: 2 });

    expect(mockNavigate).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes displayMode="baseline-text" to all SegmentViews when continuousScroll is true', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, continuousScroll: true });

    capturedSegmentViewPropsList.forEach((p) => expect(p.displayMode).toBe('baseline-text'));
  });

  it('renders ContinuousView when continuousScroll is true', () => {
    renderInterlinearizer({ continuousScroll: true });

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();
  });

  it('does not render ContinuousView when continuousScroll is false', () => {
    renderInterlinearizer({ continuousScroll: false });

    expect(screen.queryByTestId('continuous-view')).not.toBeInTheDocument();
  });

  it('renders ContinuousView above the chapter segment rows when both are present', () => {
    const { container } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
    });

    const continuousView = screen.getByTestId('continuous-view');
    const allElements = Array.from(
      container.querySelectorAll('[data-testid="continuous-view"], [data-testid="segment-view"]'),
    );
    expect(allElements[0]).toBe(continuousView);
  });

  it('calls setScrRef with the segment ref when a token is clicked', () => {
    const mockNavigate = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      navigate: mockNavigate,
    });

    act(() => {
      capturedSegmentViewPropsList[1].onSelect?.(
        { book: 'GEN', chapter: 1, verse: 2 },
        'GEN 1:2:0',
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes the clicked token through to ContinuousView as focusedTokenRef', () => {
    jest.useFakeTimers();
    try {
      // Render in token-chip mode first so onSelect is available on SegmentView props.
      const { rerender } = renderInterlinearizer({
        book: GEN_1_MULTI_BOOK,
        continuousScroll: false,
      });

      const { onSelect } = capturedSegmentViewPropsList[1];
      if (typeof onSelect !== 'function') throw new Error('Expected onSelect to be a function');

      act(() => {
        onSelect({ book: 'GEN', chapter: 1, verse: 2 }, 'GEN 1:2:0');
      });

      // Switch to continuous-scroll mode so ContinuousView is rendered and its props captured. The
      // strip mount is gated behind the recenter fade, so advance past it.
      capturedSegmentViewPropsList = [];
      rerender(
        withNav(
          <Interlinearizer
            book={GEN_1_MULTI_BOOK}
            continuousScroll
            scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            hideInactiveLinkButtons={false}
            simplifyPhrases={false}
            chapterLabelInVerse={false}
          />,
        ),
      );
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

      if (!capturedContinuousViewProps)
        throw new Error('Expected ContinuousView to have been rendered');
      expect(capturedContinuousViewProps.focusedTokenRef).toBe('GEN 1:2:0');
    } finally {
      jest.useRealTimers();
    }
  });

  it('updates scrRef when ContinuousView reports focus moving into a different verse', () => {
    const mockNavigate = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
      navigate: mockNavigate,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      // GEN 1:2:0 belongs to verse 2, which differs from the current scrRef (verse 1).
      onFocusedTokenRefChange('GEN 1:2:0');
    });

    expect(mockNavigate).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('does not echo scrRef when the focused token belongs to a different book than scrRef', () => {
    // During an external book change scrRef names the new book before its data loads, so the
    // mounted book (and its focused token) still belong to the previous book. The echo-back effect
    // must not fire that stale book's verse back as scrRef. Here the mounted book is GEN but scrRef
    // names EXO, so a GEN focus move must not call setScrRef.
    const mockNavigate = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
      scrRef: { book: 'EXO', chapterNum: 1, verseNum: 1 },
      navigate: mockNavigate,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    mockNavigate.mockClear();
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      // GEN 1:2:0 is in book GEN, which differs from the current scrRef's book (EXO).
      onFocusedTokenRefChange('GEN 1:2:0');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not update scrRef when ContinuousView focus stays within the current verse', () => {
    const mockNavigate = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      navigate: mockNavigate,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    mockNavigate.mockClear();
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      onFocusedTokenRefChange('GEN 1:1:0');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('carries the strip focus into segment view when switching off continuousScroll', () => {
    jest.useFakeTimers();
    try {
      const { rerender } = renderInterlinearizer({
        book: GEN_1_MULTI_BOOK,
        continuousScroll: true,
      });

      if (!capturedContinuousViewProps)
        throw new Error('Expected ContinuousView to have been rendered');
      const { onFocusedTokenRefChange } = capturedContinuousViewProps;

      act(() => {
        onFocusedTokenRefChange('GEN 1:2:0');
      });

      // Switch to segment view — Interlinearizer should carry the strip focus over. The display mode
      // is gated behind the recenter fade, so advance past it for the segments to render in
      // token-chip mode with the focus applied.
      capturedSegmentViewPropsList = [];
      rerender(
        withNav(
          <Interlinearizer
            book={GEN_1_MULTI_BOOK}
            continuousScroll={false}
            scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            hideInactiveLinkButtons={false}
            simplifyPhrases={false}
            chapterLabelInVerse={false}
          />,
        ),
      );
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

      const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 1:2:0');
      expect(focused).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the active-verse first word when switching off continuousScroll with no strip position', () => {
    jest.useFakeTimers();
    try {
      // Start in continuous mode without ContinuousView ever calling onFocusPhraseIndexChange.
      const { rerender } = renderInterlinearizer({
        book: GEN_1_MULTI_BOOK,
        continuousScroll: true,
        scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      });

      // Switch to segment view without any strip position having been reported.
      capturedSegmentViewPropsList = [];
      rerender(
        withNav(
          <Interlinearizer
            book={GEN_1_MULTI_BOOK}
            continuousScroll={false}
            scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            hideInactiveLinkButtons={false}
            simplifyPhrases={false}
            chapterLabelInVerse={false}
          />,
        ),
      );
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

      // The fallback focuses the first word of GEN 1:1 ('GEN 1:1:0').
      const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 1:1:0');
      expect(focused).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves an existing focusedTokenRef when switching off continuousScroll with no strip position', () => {
    // Start in segment mode and focus a specific token.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: false,
    });

    // Click a token to set focusedTokenRef to 'GEN 1:2:0'.
    const { onSelect } = capturedSegmentViewPropsList[1];
    if (typeof onSelect !== 'function') throw new Error('Expected onSelect to be a function');
    act(() => {
      onSelect({ book: 'GEN', chapter: 1, verse: 2 }, 'GEN 1:2:0');
    });

    // Switch to continuous mode (without strip reporting any position).
    capturedSegmentViewPropsList = [];
    rerender(
      withNav(
        <Interlinearizer
          book={GEN_1_MULTI_BOOK}
          continuousScroll
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );

    // Switch back to segment mode — existing focusedTokenRef should be preserved.
    capturedSegmentViewPropsList = [];
    rerender(
      withNav(
        <Interlinearizer
          book={GEN_1_MULTI_BOOK}
          continuousScroll={false}
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );

    // 'GEN 1:2:0' was already focused, so the fallback must not overwrite it.
    const stillFocused = capturedSegmentViewPropsList.find(
      (p) => p.focusedTokenRef === 'GEN 1:2:0',
    );
    expect(stillFocused).toBeDefined();
  });

  it('keeps the clicked token focused when the host echoes the click back as the clicked verse', () => {
    // Active verse starts at GEN 1:1. Click a token in a later chapter/verse (GEN 2:2): focus is set
    // to 'GEN 2:2:0'. The host echoes the navigation back as the actual clicked verse (GEN 2:2). The
    // verse-exact reseed guard must see focus already in the active verse and leave the deliberately
    // clicked token alone — never reseeding to the verse's (here, the only) first word from scratch.
    const { rerender } = renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      continuousScroll: false,
    });

    const clicked = capturedSegmentViewPropsList.find((p) => p.segment.id === 'GEN 2:2');
    if (!clicked || typeof clicked.onSelect !== 'function') {
      throw new Error('Expected an onSelect for the GEN 2:2 segment');
    }
    act(() => {
      clicked.onSelect?.({ book: 'GEN', chapter: 2, verse: 2 }, 'GEN 2:2:0');
    });

    // Host delivers the echo of the actual clicked verse.
    capturedSegmentViewPropsList = [];
    rerender(
      withNav(
        <Interlinearizer
          book={GEN_TWO_CHAPTER_BOOK}
          continuousScroll={false}
          scrRef={{ book: 'GEN', chapterNum: 2, verseNum: 2 }}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );

    // Focus must remain on the deliberately clicked token.
    const stillFocused = capturedSegmentViewPropsList.find(
      (p) => p.focusedTokenRef === 'GEN 2:2:0',
    );
    expect(stillFocused).toBeDefined();
  });

  it('reseeds focus to the first word of the active verse on an external within-chapter jump', () => {
    // A genuine external jump within a long chapter (here GEN 2:1 → GEN 2:2) must move focus to the
    // newly-named verse — a chapter-wide guard would wrongly strand focus on the old verse. Focus
    // starts at the active verse's first word; after the jump it must point at the new verse's word.
    // The segment view's focus highlight lags through the recenter fade, so advance past it.
    jest.useFakeTimers();
    try {
      const { rerender } = renderInterlinearizer({
        book: GEN_TWO_CHAPTER_BOOK,
        scrRef: { book: 'GEN', chapterNum: 2, verseNum: 1 },
        continuousScroll: false,
      });

      capturedSegmentViewPropsList = [];
      rerender(
        withNav(
          <Interlinearizer
            book={GEN_TWO_CHAPTER_BOOK}
            continuousScroll={false}
            scrRef={{ book: 'GEN', chapterNum: 2, verseNum: 2 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            hideInactiveLinkButtons={false}
            simplifyPhrases={false}
            chapterLabelInVerse={false}
          />,
        ),
      );
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

      const reseeded = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 2:2:0');
      expect(reseeded).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('renders an inline chapter header above the first verse of each chapter', () => {
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      continuousScroll: false,
    });

    // One header per chapter, rendered by the list (not inside SegmentView) at each boundary.
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    expect(screen.queryByText('Chapter 3')).not.toBeInTheDocument();
  });

  it('omits inline chapter headers when chapterLabelInVerse is set', () => {
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      continuousScroll: false,
      chapterLabelInVerse: true,
    });

    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Chapter 2')).not.toBeInTheDocument();
  });

  it('tags each inline chapter header with its chapter number for snap targeting', () => {
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      continuousScroll: false,
    });

    expect(screen.getByText('Chapter 1')).toHaveAttribute('data-chapter-start', '1');
    expect(screen.getByText('Chapter 2')).toHaveAttribute('data-chapter-start', '2');
  });

  it('highlights the first verse of a chapter when the reference names verse 0 (the heading)', () => {
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 2, verseNum: 0 },
      continuousScroll: false,
    });

    // Verse 0 names the chapter heading, which is not a verse; the active-verse marker still lands
    // on the chapter's first segment so a verse stays highlighted.
    const activeIds = new Set(
      capturedSegmentViewPropsList.filter((p) => p.isActive).map((p) => p.segment.id),
    );
    expect([...activeIds]).toEqual(['GEN 2:1']);
  });

  it('scrolls the chapter heading to the top when the reference names verse 0', () => {
    const scrollSpy = jest.spyOn(Element.prototype, 'scrollIntoView');
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 2, verseNum: 0 },
      continuousScroll: false,
    });

    // The snap targets the chapter-2 heading element rather than the active verse-1 segment.
    const heading = screen.getByText('Chapter 2');
    expect(scrollSpy.mock.contexts).toContain(heading);
  });

  it('renders the snap-to-active-verse button when segments are present', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });

    expect(screen.getByRole('button', { name: /scroll to active verse/i })).toBeInTheDocument();
  });

  it('does not render the snap-to-active-verse button when there are no segments', () => {
    renderInterlinearizer({ book: GEN_EMPTY_BOOK });

    expect(
      screen.queryByRole('button', { name: /scroll to active verse/i }),
    ).not.toBeInTheDocument();
  });

  it('snap button fades, recenters, then scrolls the active segment to the top', () => {
    jest.useFakeTimers();
    try {
      renderInterlinearizer({ book: GEN_1_1_BOOK });

      act(() => {
        screen.getByRole('button', { name: /scroll to active verse/i }).click();
      });

      // The button always fade-recenters (so a verse outside the window still comes into view), so the
      // snap only lands after the fade timeout rebuilds the window behind the curtain.
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });

      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'start',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves focusedTokenRef undefined when switching off continuousScroll with no strip position and no matching segment', () => {
    // scrRef points to verse 99 which does not exist in GEN_1_MULTI_BOOK.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 99 },
    });

    capturedSegmentViewPropsList = [];
    rerender(
      withNav(
        <Interlinearizer
          book={GEN_1_MULTI_BOOK}
          continuousScroll={false}
          scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 99 }}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );

    // No segment matches verse 99 so focusedTokenRef stays undefined for all views.
    capturedSegmentViewPropsList.forEach((p) => expect(p.focusedTokenRef).toBeUndefined());
  });

  it('renders EditPhraseControls toolbar when phraseMode is edit', () => {
    render(
      withNav(
        <Interlinearizer
          book={GEN_1_1_BOOK}
          continuousScroll={false}
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{
            kind: 'edit',
            phraseId: 'phrase-1',
            originalTokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
          }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );
    expect(screen.getByTestId('done-edit-btn')).toBeInTheDocument();
  });

  it('renders UnlinkPhraseConfirm toolbar when phraseMode is confirm-unlink', () => {
    render(
      withNav(
        <Interlinearizer
          book={GEN_1_1_BOOK}
          continuousScroll={false}
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{ kind: 'confirm-unlink', phraseId: 'phrase-1' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );
    expect(screen.getByTestId('unlink-confirm')).toBeInTheDocument();
  });

  it('calls updatePhrase with originalTokens and resets to view mode when revert:true is set', () => {
    const setPhraseMode = jest.fn();
    const originalTokens = [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }];
    render(
      withNav(
        <Interlinearizer
          book={GEN_1_1_BOOK}
          continuousScroll={false}
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens, revert: true }}
          setPhraseMode={setPhraseMode}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );
    expect(mockUpdatePhrase).toHaveBeenCalledWith('phrase-1', originalTokens);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('calls updatePhrase and resets to view mode even when the phrase has 0 tokens (all removed)', () => {
    const setPhraseMode = jest.fn();
    render(
      withNav(
        <Interlinearizer
          book={GEN_1_1_BOOK}
          continuousScroll={false}
          scrRef={defaultScrRef}
          analysisLanguage="und"
          phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: [], revert: true }}
          setPhraseMode={setPhraseMode}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />,
      ),
    );
    expect(mockUpdatePhrase).toHaveBeenCalledWith('phrase-1', []);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('fades the segment list out while recentering on a far-away verse, then back in', () => {
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(60);
      const props = {
        book,
        continuousScroll: false,
        analysisLanguage: 'und',
        phraseMode: { kind: 'view' } as const,
        setPhraseMode: () => {},
        hideInactiveLinkButtons: false,
        simplifyPhrases: false,
        chapterLabelInVerse: false,
      };
      const { container, rerender } = render(
        withNav(
          <Interlinearizer {...props} scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }} />,
        ),
      );

      // The inner list-fade wrapper (distinguished by tw:gap-2) is the one that fades for external
      // navigation; the outer interlinearizer wrapper only fades on a continuous-scroll toggle.
      const list = container.querySelector('.tw\\:gap-2.tw\\:transition-opacity');
      expect(list).toHaveStyle({ opacity: '1' });

      // Navigate far past the rendered window so the hook fades out before rebuilding.
      act(() => {
        rerender(
          withNav(
            <Interlinearizer {...props} scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 50 }} />,
          ),
        );
      });
      expect(container.querySelector('.tw\\:gap-2.tw\\:transition-opacity')).toHaveStyle({
        opacity: '0',
      });

      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });
      expect(container.querySelector('.tw\\:gap-2.tw\\:transition-opacity')).toHaveStyle({
        opacity: '1',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not fade the segment list when navigation is originated by an internal segment click', () => {
    jest.useFakeTimers();
    const book = makeLargeBook(60);

    // Stateful wrapper so a segment click's navigate flows back as the scrRef prop, exercising the
    // internal-nav classification that suppresses the recenter fade. `setRef` is wired as the
    // context's navigate sink (via withNav), so `navigate(ref, 'internal')` updates the prop here.
    let updateRef: (r: SerializedVerseRef) => void = () => {};
    /**
     * Stateful wrapper that feeds its own `ref` state as the `scrRef` prop to
     * {@link Interlinearizer}, letting `updateRef` simulate navigate calls from outside the
     * component tree.
     *
     * @returns The wrapped Interlinearizer element.
     */
    function Wrapper() {
      const [ref, setRef] = useState<SerializedVerseRef>({
        book: 'GEN',
        chapterNum: 1,
        verseNum: 1,
      });
      updateRef = setRef;
      return (
        <Interlinearizer
          book={book}
          continuousScroll={false}
          scrRef={ref}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          hideInactiveLinkButtons={false}
          simplifyPhrases={false}
          chapterLabelInVerse={false}
        />
      );
    }
    try {
      const { container } = render(withNav(<Wrapper />, (r) => updateRef(r)));

      // Click a segment far down the list (still mounted) — an internal nav, so no fade.
      const select = capturedSegmentViewPropsList.find((p) => p.segment.id === 'GEN 1:7')?.onSelect;
      if (typeof select !== 'function')
        throw new Error('Expected GEN 1:7 onSelect to be a function');
      act(() => select({ book: 'GEN', chapter: 1, verse: 7 }, 'GEN 1:7:0'));

      expect(container.querySelector('.tw\\:transition-opacity')).toHaveStyle({ opacity: '1' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('fades the whole interlinearizer out and back in across a continuous-scroll toggle', () => {
    jest.useFakeTimers();
    try {
      const book = makeLargeBook(60);
      const props = {
        book,
        analysisLanguage: 'und',
        scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
        phraseMode: { kind: 'view' } as const,
        setPhraseMode: () => {},
        hideInactiveLinkButtons: false,
        simplifyPhrases: false,
        chapterLabelInVerse: false,
      };
      const { container, rerender } = render(
        withNav(<Interlinearizer {...props} continuousScroll={false} />),
      );

      // The outer wrapper (tw:flex-1, distinct from the inner list's tw:gap-2 wrapper) starts opaque.
      const outer = container.querySelector('.tw\\:flex-1.tw\\:transition-opacity');
      expect(outer).toHaveStyle({ opacity: '1' });

      // Toggle continuous scroll on: the whole view fades out until the mode swap lands at midpoint.
      act(() => {
        rerender(withNav(<Interlinearizer {...props} continuousScroll />));
      });
      expect(container.querySelector('.tw\\:flex-1.tw\\:transition-opacity')).toHaveStyle({
        opacity: '0',
      });

      // At the recenter midpoint the rendered mode catches up and the view fades back in.
      act(() => {
        jest.advanceTimersByTime(RECENTER_FADE_MS);
      });
      expect(container.querySelector('.tw\\:flex-1.tw\\:transition-opacity')).toHaveStyle({
        opacity: '1',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
