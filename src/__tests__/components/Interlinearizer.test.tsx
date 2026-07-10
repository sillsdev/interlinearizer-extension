/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Book, PhraseAnalysisLink, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import Interlinearizer from '../../components/Interlinearizer';
import { InterlinearNavProvider } from '../../components/InterlinearNavContext';
import {
  useSegmentation,
  type SegmentationContextValue,
  type SegmentationDispatch,
} from '../../components/SegmentationStore';
import type { SegmentDisplayMode } from '../../components/SegmentView';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import { defaultScrRef, GEN_1_1_BOOK, type ScrollGroupTuple } from '../test-helpers';
import { allFalseViewOptions } from './test-helpers';

jest.mock('lucide-react', () => ({
  __esModule: true,
  /**
   * Stub for the LocateFixed icon; renders a minimal SVG so icon-presence assertions work.
   *
   * @returns An SVG element with `data-testid="locate-fixed-icon"`.
   */
  LocateFixed: () => <svg data-testid="locate-fixed-icon" />,
  /**
   * Stub for the Merge icon used by the between-rows merge control.
   *
   * @returns An SVG element with `data-testid="merge-icon"`.
   */
  Merge: () => <svg data-testid="merge-icon" />,
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

/**
 * The segmentation context value seen by the (stubbed) ContinuousView — carries the force-break
 * wrapped dispatch built by InterlinearizerInner, so tests can invoke its methods directly.
 */
let capturedSegmentation: SegmentationContextValue | undefined;

/** Props captured from SegmentView renders so tests can assert on what Interlinearizer passes down. */
type CapturedSegmentViewProps = {
  /** The segment the component is asked to render. */
  segment: Segment;
  /** Per-verse-start inline superscript labels (chapter-qualified at a chapter transition). */
  verseStartLabels?: readonly string[];
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

/** Stable spies for `createPhrase` / `deletePhrase`, asserted on by the force-break tests. */
const mockCreatePhrase = jest.fn();
const mockDeletePhrase = jest.fn();

/**
 * Phrase-link-by-id map served by the mocked `usePhraseLinkByIdGetter`. Force-break tests seed it
 * with phrases that straddle a boundary; cleared in the top-level `beforeEach`.
 */
const mockPhraseLinkById = new Map<string, PhraseAnalysisLink>();

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
  /**
   * Returns the test-owned phrase-link map so straddled-boundary tests can seed phrases the
   * component's `straddledBoundaryRefs` memo sees.
   *
   * @returns The current phrase-link-by-id map.
   */
  usePhraseLinkByIdMap: () => mockPhraseLinkById,
  /**
   * Returns a getter over the test-owned phrase-link map so force-break tests can seed straddling
   * phrases.
   *
   * @returns A function returning the current map.
   */
  usePhraseLinkByIdGetter: () => () => mockPhraseLinkById,
  usePhraseDispatch: () => ({
    createPhrase: (...args: Parameters<typeof mockCreatePhrase>) => mockCreatePhrase(...args),
    updatePhrase: (...args: Parameters<typeof mockUpdatePhrase>) => mockUpdatePhrase(...args),
    deletePhrase: (...args: Parameters<typeof mockDeletePhrase>) => mockDeletePhrase(...args),
  }),
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  /**
   * ContinuousView stub; captures its props and the segmentation context (the wrapped,
   * force-breaking dispatch) so tests can invoke the dispatch directly.
   *
   * @param props - The props passed by Interlinearizer.
   * @returns A minimal div carrying the focused token ref.
   */
  default: function ContinuousViewStub(props: CapturedContinuousViewProps) {
    capturedContinuousViewProps = props;
    capturedSegmentation = useSegmentation();
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
  default: function MockSegmentView({
    segment,
    isActive,
    hoveredPhraseId,
    onHoverPhrase,
    ...rest
  }: CapturedSegmentViewProps) {
    capturedSegmentViewPropsList.push({
      segment,
      isActive,
      hoveredPhraseId,
      onHoverPhrase,
      ...rest,
    });
    // Surface the Alt-held context so the wiring test can confirm Interlinearizer feeds it from
    // useAltHeld. Read lazily (not via an outer import) because jest.mock factories are hoisted.
    // eslint-disable-next-line global-require, @typescript-eslint/no-require-imports
    const { useAltHeldValue } = require('../../components/AltHeldContext');
    return (
      <div
        aria-current={isActive ? 'true' : undefined}
        data-alt-held={String(useAltHeldValue())}
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

/**
 * A fixture book whose segments may omit `verseStarts` (filled in by
 * {@link withDefaultVerseStarts}).
 */
type BookWithOptionalVerseStarts = Omit<Book, 'segments'> & {
  segments: (Omit<Segment, 'verseStarts'> & Partial<Pick<Segment, 'verseStarts'>>)[];
};

/**
 * Fills in a default single `verseStarts` entry (offset 0, number from `startRef.verse`) on any
 * hand-built fixture segment that lacks one, so the fixtures satisfy the `Segment` shape without
 * every literal repeating the boilerplate. Segments that already carry `verseStarts` (e.g. produced
 * by `resegmentBook`) are left untouched.
 *
 * @param book - The fixture book to normalize; its segments may omit `verseStarts`.
 * @returns The book with every segment carrying at least one verse start.
 */
function withDefaultVerseStarts(book: BookWithOptionalVerseStarts): Book {
  return {
    ...book,
    segments: book.segments.map((seg) =>
      seg.verseStarts
        ? { ...seg, verseStarts: seg.verseStarts }
        : {
            ...seg,
            verseStarts: [
              { charStart: 0, number: String(seg.startRef.verse), chapter: seg.startRef.chapter },
            ],
          },
    ),
  };
}

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
      verseStarts: [{ charStart: 0, number: String(v), chapter: 1 }],
    });
  }
  return { id: 'GEN', bookRef: 'GEN', textVersion: 'v1', segments };
}

/** Book with two segments in GEN 1 — used by chapter-display tests. */
const GEN_1_MULTI_BOOK: Book = withDefaultVerseStarts({
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
});

/**
 * Two-chapter GEN book: chapter 1 has verses 1-2, chapter 2 has verses 1-2. Used to exercise the
 * focus-reseed guard when the host echoes a click back at chapter granularity (verse-0 / first
 * verse), which a verse-exact guard would misread as the chapter's first segment.
 */
const GEN_TWO_CHAPTER_BOOK: Book = withDefaultVerseStarts({
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
});

/**
 * GEN book whose verse 1 has two word tokens (so it can be split into portions "1a"/"1b") and verse
 * 2 one word. The default one-segment-per-verse form; {@link GEN_V1_SPLIT_BOOK} is its split
 * counterpart.
 */
const GEN_SPLITTABLE_V1_BOOK: Book = withDefaultVerseStarts({
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In beginning.',
      tokens: [
        {
          ref: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
        {
          ref: 'GEN 1:1:3',
          surfaceText: 'beginning',
          writingSystem: 'en',
          type: 'word',
          charStart: 3,
          charEnd: 12,
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
});

/**
 * {@link GEN_SPLITTABLE_V1_BOOK} with verse 1 split before its second word, so verse 1 becomes two
 * portions ("1a" = segment `GEN 1:1` holding `GEN 1:1:0`; "1b" = segment `GEN 1:1:3` holding `GEN
 * 1:1:3`). Both portions' verse ranges contain verse 1, so a verse-1 navigation resolves to the
 * first portion — the condition behind the non-first-portion focus bug.
 */
const GEN_V1_SPLIT_BOOK: Book = resegmentBook(withDefaultVerseStarts(GEN_SPLITTABLE_V1_BOOK), {
  removedVerseStarts: [],
  addedStarts: ['GEN 1:1:3'],
});

/** GEN book whose chapter 1 opens with a verse-0 superscription segment before verse 1. */
const GEN_SUPERSCRIPTION_BOOK: Book = withDefaultVerseStarts({
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:0',
      startRef: { book: 'GEN', chapter: 1, verse: 0 },
      endRef: { book: 'GEN', chapter: 1, verse: 0 },
      baselineText: 'A song.',
      tokens: [
        {
          ref: 'GEN 1:0:0',
          surfaceText: 'A',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 1,
        },
      ],
    },
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
  ],
});

/**
 * Wraps an `<Interlinearizer>` element in an {@link InterlinearNavProvider} so the component's
 * `useInterlinearNav` call resolves. `Interlinearizer` writes the reference through the context's
 * `navigate` (which calls the scroll-group hook's setter), so navigation assertions hang off the
 * `navigate` spy supplied here.
 *
 * @param ui - The `<Interlinearizer>` element to wrap.
 * @param navigate - Spy wired as the scroll-group hook's setter; receives the reference each
 *   `navigate` call writes. Defaults to a noop.
 * @returns The element wrapped in a nav provider.
 */
function withNav(ui: ReactNode, navigate: (r: SerializedVerseRef) => void = () => {}): ReactNode {
  const scrollGroupHook = (): ScrollGroupTuple => [
    defaultScrRef,
    navigate,
    undefined,
    () => {},
    undefined,
  ];
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
  showMorphology = false,
  showFreeTranslation = false,
  segmentationDispatch,
  formerBoundaries,
}: {
  book?: Book;
  continuousScroll?: boolean;
  scrRef?: SerializedVerseRef;
  navigate?: (r: SerializedVerseRef) => void;
  hideInactiveLinkButtons?: boolean;
  simplifyPhrases?: boolean;
  showMorphology?: boolean;
  showFreeTranslation?: boolean;
  segmentationDispatch?: SegmentationDispatch;
  formerBoundaries?: ReadonlyMap<string, string>;
} = {}) {
  return render(
    withNav(
      <Interlinearizer
        book={withDefaultVerseStarts(book)}
        continuousScroll={continuousScroll}
        segmentationDispatch={segmentationDispatch}
        formerBoundaries={formerBoundaries}
        scrRef={scrRef}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        viewOptions={{
          hideInactiveLinkButtons,
          simplifyPhrases,
          showMorphology,
          showFreeTranslation,
        }}
      />,
      navigate,
    ),
  );
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView; stub it globally so components that call it don't throw.
  Element.prototype.scrollIntoView = jest.fn();
  // The phrase-link map is a plain Map (not a jest mock), so resetMocks does not clear it.
  mockPhraseLinkById.clear();
  capturedSegmentation = undefined;
  // resetMocks clears the shared useLocalizedStrings implementation the between-rows merge
  // control's label relies on; re-establish the key-to-itself mapping.
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}),
      false,
    ]);
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

  it('passes per-verse-start superscript labels to the segment views', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });

    // Verse 1 opens the book's first chapter, so its superscript is chapter-qualified; verse 2 is
    // a bare number.
    expect(capturedSegmentViewPropsList[0].verseStartLabels).toEqual(['1:1']);
    expect(capturedSegmentViewPropsList[1].verseStartLabels).toEqual(['2']);
  });

  it('passes a superscript label for every absorbed verse start of a merged segment', () => {
    const merged = resegmentBook(withDefaultVerseStarts(GEN_1_MULTI_BOOK), {
      removedVerseStarts: ['GEN 1:2:0'],
      addedStarts: [],
    });
    renderInterlinearizer({ book: merged });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(1);
    // The merged segment absorbs verses 1 and 2; verse 1 opens the chapter so it is qualified.
    expect(capturedSegmentViewPropsList[0].verseStartLabels).toEqual(['1:1', '2']);
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

  it('renders all segments when the reference names a verse absent from the data', () => {
    const missingVerseRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 99 };
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, scrRef: missingVerseRef });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
  });

  it('calls navigate with the segment ref when a segment fires onSelect', () => {
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

  it('calls navigate with the segment ref when a token is clicked', () => {
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

  it('writes a verse-0 reference to the host when a verse-0 token is selected', () => {
    // Selecting a superscription token navigates the host to verse 0 like any other verse; the
    // 'internal' origin records a nav marker so the segment window skips the recenter fade for our
    // own move. Default scrRef is GEN 1:1, so this is a real verse change.
    const mockNavigate = jest.fn();
    renderInterlinearizer({ book: GEN_SUPERSCRIPTION_BOOK, navigate: mockNavigate });

    act(() => {
      capturedSegmentViewPropsList[0].onSelect?.(
        { book: 'GEN', chapter: 1, verse: 0 },
        'GEN 1:0:0',
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 0 });
  });

  it('writes a verse-0 reference to the host when a verse-0 token is focused from the strip', () => {
    const mockNavigate = jest.fn();
    renderInterlinearizer({
      book: GEN_SUPERSCRIPTION_BOOK,
      continuousScroll: true,
      navigate: mockNavigate,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      onFocusedTokenRefChange('GEN 1:0:0');
    });

    expect(mockNavigate).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 0 });
    expect(capturedContinuousViewProps.focusedTokenRef).toBe('GEN 1:0:0');
  });

  it('moves the active-segment highlight to a verse-0 segment when its token is focused', () => {
    renderInterlinearizer({
      book: GEN_SUPERSCRIPTION_BOOK,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
    });

    // Active verse (1) is highlighted; the verse-0 superscription is not, yet.
    const before = Object.fromEntries(
      capturedSegmentViewPropsList.map((p) => [p.segment.id, p.isActive]),
    );
    expect(before['GEN 1:0']).toBeFalsy();
    expect(before['GEN 1:1']).toBe(true);

    const { onSelect } = capturedSegmentViewPropsList[0];
    capturedSegmentViewPropsList = [];
    act(() => {
      onSelect({ book: 'GEN', chapter: 1, verse: 0 }, 'GEN 1:0:0');
    });

    // Focusing the superscription's token moves the active highlight onto its segment.
    const after = Object.fromEntries(
      capturedSegmentViewPropsList.map((p) => [p.segment.id, p.isActive]),
    );
    expect(after['GEN 1:0']).toBe(true);
    expect(after['GEN 1:1']).toBeFalsy();
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
            viewOptions={{ ...allFalseViewOptions }}
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
    // names EXO, so a GEN focus move must not call navigate.
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
            viewOptions={{ ...allFalseViewOptions }}
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
            viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
            viewOptions={{ ...allFalseViewOptions }}
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

  it('keeps focus on a clicked non-first portion of a split verse', () => {
    // Verse 1 is split into portions "1a" (GEN 1:1) and "1b" (GEN 1:1:3). Focus starts on verse 2.
    // Clicking a token in "1b" sets focus to 'GEN 1:1:3' and navigates to verse 1. The host echoes
    // verse 1 back, firing the reseed effect: its guard must recognize that the focused token
    // already sits in a segment (portion "1b") containing verse 1 and leave it alone — rather than
    // reseeding to the *first* portion ("1a") and snapping focus to that portion's first word.
    const { rerender } = render(
      withNav(
        <Interlinearizer
          book={GEN_V1_SPLIT_BOOK}
          continuousScroll={false}
          scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          viewOptions={{ ...allFalseViewOptions }}
        />,
      ),
    );

    const secondPortion = capturedSegmentViewPropsList.find((p) => p.segment.id === 'GEN 1:1:3');
    if (!secondPortion || typeof secondPortion.onSelect !== 'function') {
      throw new Error('Expected an onSelect for the "1b" split portion (GEN 1:1:3)');
    }
    act(() => {
      secondPortion.onSelect?.({ book: 'GEN', chapter: 1, verse: 1 }, 'GEN 1:1:3');
    });

    // Host delivers the echo of the clicked verse (verse 1).
    capturedSegmentViewPropsList = [];
    rerender(
      withNav(
        <Interlinearizer
          book={GEN_V1_SPLIT_BOOK}
          continuousScroll={false}
          scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }}
          analysisLanguage="und"
          phraseMode={{ kind: 'view' }}
          setPhraseMode={() => {}}
          viewOptions={{ ...allFalseViewOptions }}
        />,
      ),
    );

    // Focus stays on the deliberately clicked "1b" token, not reseeded to "1a"'s first word.
    const stillFocused = capturedSegmentViewPropsList.find(
      (p) => p.focusedTokenRef === 'GEN 1:1:3',
    );
    expect(stillFocused).toBeDefined();
    const reseededToFirstPortion = capturedSegmentViewPropsList.find(
      (p) => p.focusedTokenRef === 'GEN 1:1:0',
    );
    expect(reseededToFirstPortion).toBeUndefined();
  });

  it('reseeds focus out of a split portion on an external jump to a verse it does not contain', () => {
    // The negative counterpart to the split-portion focus test: focus sits in portion "1b"
    // (GEN 1:1:3), which contains verse 1 but not verse 2. A genuine external jump to verse 2 lands
    // outside the focused token's segment, so the containment guard must let the reseed run and move
    // focus to verse 2's first word — proving the guard is verse-exact and not merely chapter-wide.
    // The segment view's focus highlight lags through the recenter fade, so advance past it.
    jest.useFakeTimers();
    try {
      const { rerender } = render(
        withNav(
          <Interlinearizer
            book={GEN_V1_SPLIT_BOOK}
            continuousScroll={false}
            scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            viewOptions={{ ...allFalseViewOptions }}
          />,
        ),
      );

      // Focus the second portion so focus sits off the verse's first word.
      const secondPortion = capturedSegmentViewPropsList.find((p) => p.segment.id === 'GEN 1:1:3');
      if (!secondPortion || typeof secondPortion.onSelect !== 'function') {
        throw new Error('Expected an onSelect for the "1b" split portion (GEN 1:1:3)');
      }
      act(() => {
        secondPortion.onSelect?.({ book: 'GEN', chapter: 1, verse: 1 }, 'GEN 1:1:3');
      });

      // External jump to verse 2 — a verse the focused portion does not contain.
      capturedSegmentViewPropsList = [];
      rerender(
        withNav(
          <Interlinearizer
            book={GEN_V1_SPLIT_BOOK}
            continuousScroll={false}
            scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
            analysisLanguage="und"
            phraseMode={{ kind: 'view' }}
            setPhraseMode={() => {}}
            viewOptions={{ ...allFalseViewOptions }}
          />,
        ),
      );
      act(() => jest.advanceTimersByTime(RECENTER_FADE_MS));

      const reseeded = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 1:2:0');
      expect(reseeded).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * Makes the segment `topSegmentId` the topmost one touching the container's top edge, so the
   * pinned-chapter overlay resolves it deterministically in jsdom (which otherwise reports every
   * rect as zero). Every `[data-segment-id]` before the target is placed fully above the top edge
   * (negative bottom); the target and those after it sit at/below it. The container reports top 0.
   * Restored automatically by `restoreMocks`.
   *
   * @param orderedSegmentIds - Segment ids in document order.
   * @param topSegmentId - The segment id to place flush against the container top.
   */
  function positionSegmentAtTop(orderedSegmentIds: string[], topSegmentId: string): void {
    const targetIndex = orderedSegmentIds.indexOf(topSegmentId);
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(
      this: HTMLElement,
    ): DOMRect {
      const segmentId = this.getAttribute('data-segment-id');
      // Container (and any non-segment element) reports top 0. A segment before the target sits
      // fully above the top edge; the target and later segments sit at or below it.
      const index = segmentId ? orderedSegmentIds.indexOf(segmentId) : -1;
      const top = index >= 0 && index < targetIndex ? -20 : 0;
      return {
        top,
        bottom: top + 10,
        left: 0,
        right: 0,
        width: 0,
        height: 10,
        x: 0,
        y: top,
        toJSON() {},
      };
    });
  }

  it('pins a book-and-chapter header for the chapter at the top of the list', () => {
    positionSegmentAtTop(['GEN 1:1', 'GEN 1:2', 'GEN 2:1', 'GEN 2:2'], 'GEN 1:1');
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      continuousScroll: false,
    });

    // A single pinned overlay (not a header per chapter) shows the localized book name plus the
    // chapter of the topmost visible segment.
    expect(screen.getByText('Genesis 1')).toBeInTheDocument();
    expect(screen.queryByText('Genesis 2')).not.toBeInTheDocument();
  });

  it('pins the chapter of the top segment even when that chapter starts merged mid-segment', () => {
    // Merge GEN 2:1 into GEN 1:2, so the segment containing chapter 2's first token starts in
    // chapter 1. Scrolling so that merged segment is at the top pins its start chapter (1) — the
    // overlay follows the topmost segment, and a merged chapter start reads as its host's chapter.
    const merged = resegmentBook(withDefaultVerseStarts(GEN_TWO_CHAPTER_BOOK), {
      removedVerseStarts: ['GEN 2:1:0'],
      addedStarts: [],
    });
    positionSegmentAtTop(['GEN 1:1', 'GEN 1:2', 'GEN 2:2'], 'GEN 1:1');
    renderInterlinearizer({
      book: merged,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      continuousScroll: false,
    });

    expect(screen.getByText('Genesis 1')).toBeInTheDocument();
  });

  it('pins the later chapter when a later-chapter segment is at the top of the list', () => {
    positionSegmentAtTop(['GEN 1:1', 'GEN 1:2', 'GEN 2:1', 'GEN 2:2'], 'GEN 2:1');
    renderInterlinearizer({
      book: GEN_TWO_CHAPTER_BOOK,
      scrRef: { book: 'GEN', chapterNum: 2, verseNum: 1 },
      continuousScroll: false,
    });

    expect(screen.getByText('Genesis 2')).toBeInTheDocument();
    expect(screen.queryByText('Genesis 1')).not.toBeInTheDocument();
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
          viewOptions={{ ...allFalseViewOptions }}
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
        viewOptions: { ...allFalseViewOptions },
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
          viewOptions={{ ...allFalseViewOptions }}
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

      // Target the inner list wrapper (tw:gap-2) — the one that fades on external nav via isFaded —
      // matching the positive-fade test above. The bare .tw:transition-opacity selector would return
      // the outer mode-toggle wrapper instead, whose opacity is never driven here, masking a regressed
      // (non-suppressed) recenter fade of the list.
      expect(container.querySelector('.tw\\:gap-2.tw\\:transition-opacity')).toHaveStyle({
        opacity: '1',
      });
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
        viewOptions: { ...allFalseViewOptions },
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

// ---------------------------------------------------------------------------
// Segmentation dispatch force-break wrapper + between-rows merge control
// ---------------------------------------------------------------------------

describe('segmentation dispatch force-break', () => {
  /**
   * Builds a raw segmentation-dispatch spy; the wrapped dispatch the views receive must delegate
   * every call to it.
   *
   * @returns A dispatch whose methods are jest spies.
   */
  function makeRawDispatch(): SegmentationDispatch {
    return { merge: jest.fn(), split: jest.fn(), move: jest.fn() };
  }

  /**
   * Renders with continuous scroll on (so the stubbed ContinuousView captures the segmentation
   * context) and returns the wrapped dispatch.
   *
   * @param raw - The raw dispatch handed to the component.
   * @param book - The book fixture to render.
   * @returns The wrapped dispatch captured from the segmentation context.
   */
  function renderAndCaptureDispatch(raw: SegmentationDispatch, book: Book): SegmentationDispatch {
    renderInterlinearizer({ book, continuousScroll: true, segmentationDispatch: raw });
    const dispatch = capturedSegmentation?.dispatch;
    if (!dispatch) throw new Error('expected a captured segmentation dispatch');
    return dispatch;
  }

  it('passes merge straight through without touching phrases', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0']));
    const dispatch = renderAndCaptureDispatch(raw, GEN_1_MULTI_BOOK);
    dispatch.merge('GEN 1:2:0');
    expect(raw.merge).toHaveBeenCalledWith('GEN 1:2:0');
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockDeletePhrase).not.toHaveBeenCalled();
  });

  it('force-breaks a two-token phrase straddling a split boundary (deletes it), then splits', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0']));
    const dispatch = renderAndCaptureDispatch(raw, GEN_1_MULTI_BOOK);
    dispatch.split('GEN 1:2:0');
    // Both halves of the straddled two-token phrase are single tokens, so the phrase is deleted.
    expect(mockDeletePhrase).toHaveBeenCalledWith('p1');
    expect(raw.split).toHaveBeenCalledWith('GEN 1:2:0');
    // The break lands before the boundary write so no consumer observes a straddling phrase.
    expect(mockDeletePhrase.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(raw.split).mock.invocationCallOrder[0],
    );
  });

  it('force-breaks a longer straddling phrase into its two sides at the boundary', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set(
      'p1',
      makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0', 'GEN 1:3:0', 'GEN 1:4:0']),
    );
    const dispatch = renderAndCaptureDispatch(raw, makeLargeBook(4));
    dispatch.split('GEN 1:3:0');
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'GEN 1:1:0', surfaceText: 'GEN 1:1:0' },
      { tokenRef: 'GEN 1:2:0', surfaceText: 'GEN 1:2:0' },
    ]);
    expect(mockCreatePhrase).toHaveBeenCalledWith([
      { tokenRef: 'GEN 1:3:0', surfaceText: 'GEN 1:3:0' },
      { tokenRef: 'GEN 1:4:0', surfaceText: 'GEN 1:4:0' },
    ]);
    expect(raw.split).toHaveBeenCalledWith('GEN 1:3:0');
  });

  it('leaves phrases alone when the split boundary cuts none of them', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:3:0', 'GEN 1:4:0']));
    const dispatch = renderAndCaptureDispatch(raw, makeLargeBook(4));
    dispatch.split('GEN 1:3:0');
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockDeletePhrase).not.toHaveBeenCalled();
    expect(raw.split).toHaveBeenCalledWith('GEN 1:3:0');
  });

  it('force-breaks at the destination boundary of a move', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0']));
    const dispatch = renderAndCaptureDispatch(raw, GEN_1_MULTI_BOOK);
    dispatch.move('GEN 1:1:0', 'GEN 1:2:0');
    expect(mockDeletePhrase).toHaveBeenCalledWith('p1');
    expect(raw.move).toHaveBeenCalledWith('GEN 1:1:0', 'GEN 1:2:0');
  });

  it('skips the force-break when the boundary ref is unknown to the book', () => {
    const raw = makeRawDispatch();
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0']));
    const dispatch = renderAndCaptureDispatch(raw, GEN_1_MULTI_BOOK);
    dispatch.split('EXO 9:9:9');
    expect(mockDeletePhrase).not.toHaveBeenCalled();
    expect(raw.split).toHaveBeenCalledWith('EXO 9:9:9');
  });
});

/** Presses (or releases) Alt so Alt-gated boundary controls reveal (or hide) their buttons. */
function setAltHeld(held: boolean): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { altKey: held }));
  });
}

describe('between-rows merge control', () => {
  it('renders an inert blank gap (no rail, no merge button) between rows while Alt is not held', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });
    // Two rows -> exactly one gap between them. Until Alt is held it is a blank inert spacer: no rail
    // and no button, so the segment cards read as distinct and hovering the gap does nothing.
    expect(screen.getAllByTestId('segment-row-gap')).toHaveLength(1);
    expect(screen.queryByTestId('segment-merge-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('segment-merge-btn')).not.toBeInTheDocument();
  });

  it('reveals the solid rail and merge button while Alt is held and merges on click', () => {
    const raw: SegmentationDispatch = { merge: jest.fn(), split: jest.fn(), move: jest.fn() };
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, segmentationDispatch: raw });
    setAltHeld(true);
    const buttons = screen.getAllByTestId('segment-merge-btn');
    // The rail and button mount into the same reserved gap height, so the row gap never changes size.
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByTestId('segment-merge-indicator')).toHaveLength(1);
    expect(screen.queryByTestId('segment-row-gap')).not.toBeInTheDocument();
    fireEvent.click(buttons[0]);
    // Merging removes the boundary at the lower segment's first token.
    expect(raw.merge).toHaveBeenCalledWith('GEN 1:2:0');
  });

  it('renders no merge affordance when only one segment row is mounted', () => {
    renderInterlinearizer({ book: GEN_1_1_BOOK });
    expect(screen.queryByTestId('segment-row-gap')).not.toBeInTheDocument();
    expect(screen.queryByTestId('segment-merge-indicator')).not.toBeInTheDocument();
    setAltHeld(true);
    expect(screen.queryByTestId('segment-merge-btn')).not.toBeInTheDocument();
  });

  it('does not tint the adjacent rows on merge-button hover (the preview is removed)', () => {
    const { container } = renderInterlinearizer({ book: GEN_1_MULTI_BOOK });
    setAltHeld(true);
    const button = screen.getByTestId('segment-merge-btn');
    fireEvent.mouseEnter(button);
    // The adjacent-row tint/outline preview is gone; the button keeps only its own hover style.
    expect(container.getElementsByClassName('tw:ring-ring/60')).toHaveLength(0);
  });

  it('labels the merge button with the concise merge string and the split-hint tooltip', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });
    setAltHeld(true);
    const button = screen.getByTestId('segment-merge-btn');
    expect(button).toHaveAttribute('aria-label', '%interlinearizer_boundaryControl_merge%');
    expect(button).toHaveAttribute('title', '%interlinearizer_boundaryControl_mergeHint%');
  });
});

describe('Alt-held wiring', () => {
  it('feeds the Alt-held state through context to the views', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK });
    // The context reads false before any Alt press.
    expect(screen.getAllByTestId('segment-view')[0]).toHaveAttribute('data-alt-held', 'false');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true }));
    });
    expect(screen.getAllByTestId('segment-view')[0]).toHaveAttribute('data-alt-held', 'true');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { altKey: false }));
    });
    expect(screen.getAllByTestId('segment-view')[0]).toHaveAttribute('data-alt-held', 'false');
  });
});

describe('focus preservation across segmentation edits', () => {
  /** GEN book whose verse 1 has two word tokens and verse 2 one — lets focus sit off a verse start. */
  const GEN_TWO_TOKEN_V1_BOOK: Book = withDefaultVerseStarts({
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: 'v1',
    segments: [
      {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: 'In beginning.',
        tokens: [
          {
            ref: 'GEN 1:1:0',
            surfaceText: 'In',
            writingSystem: 'en',
            type: 'word',
            charStart: 0,
            charEnd: 2,
          },
          {
            ref: 'GEN 1:1:3',
            surfaceText: 'beginning',
            writingSystem: 'en',
            type: 'word',
            charStart: 3,
            charEnd: 12,
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
  });

  /**
   * Builds the wrapped `<Interlinearizer>` element used by these tests, so the initial render and
   * the post-edit rerender share identical props apart from the book.
   *
   * @param book - The (re)segmented book to render.
   * @param scrRef - The active scripture reference.
   * @returns The element wrapped in a nav provider.
   */
  function interlinearizerEl(book: Book, scrRef: SerializedVerseRef): ReactNode {
    return withNav(
      <Interlinearizer
        book={withDefaultVerseStarts(book)}
        continuousScroll
        scrRef={scrRef}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        viewOptions={allFalseViewOptions}
      />,
    );
  }

  it('keeps the focused token when a merge removes the active verse segment start', () => {
    const scrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 2 };
    const { rerender } = render(interlinearizerEl(GEN_1_MULTI_BOOK, scrRef));
    expect(capturedContinuousViewProps?.focusedTokenRef).toBe('GEN 1:2:0');
    // Merge verse 2 into verse 1 — the exact transform the loader applies on a boundary edit. No
    // segment starts at the active verse afterwards, but the focused token still exists.
    const merged = resegmentBook(GEN_1_MULTI_BOOK, {
      removedVerseStarts: ['GEN 1:2:0'],
      addedStarts: [],
    });
    rerender(interlinearizerEl(merged, scrRef));
    expect(capturedContinuousViewProps?.focusedTokenRef).toBe('GEN 1:2:0');
  });

  it('keeps a deliberately-focused token across a merge into the active verse', () => {
    const scrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
    const { rerender } = render(interlinearizerEl(GEN_TWO_TOKEN_V1_BOOK, scrRef));
    act(() => capturedContinuousViewProps?.onFocusedTokenRefChange('GEN 1:1:3'));
    expect(capturedContinuousViewProps?.focusedTokenRef).toBe('GEN 1:1:3');
    // Merge verse 2 into verse 1; the active verse's segment survives (same start), so the
    // deliberately-focused token must not be clobbered back to the verse's first word.
    const merged = resegmentBook(GEN_TWO_TOKEN_V1_BOOK, {
      removedVerseStarts: ['GEN 1:2:0'],
      addedStarts: [],
    });
    rerender(interlinearizerEl(merged, scrRef));
    expect(capturedContinuousViewProps?.focusedTokenRef).toBe('GEN 1:1:3');
  });
});

describe('former boundaries', () => {
  it('provides the supplied formerBoundaries map to the views through the segmentation context', () => {
    // Anchor word ref → removed default start ref (distinct when the verse opens with punctuation).
    const formerBoundaries: ReadonlyMap<string, string> = new Map([['GEN 1:2:1', 'GEN 1:2:0']]);
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      continuousScroll: true,
      formerBoundaries,
    });
    expect(capturedSegmentation?.formerBoundaries).toBe(formerBoundaries);
  });

  it('defaults formerBoundaries to an empty map when the loader supplies none', () => {
    renderInterlinearizer({ book: GEN_1_MULTI_BOOK, continuousScroll: true });
    expect(capturedSegmentation?.formerBoundaries?.size).toBe(0);
  });
});

describe('straddled boundary refs', () => {
  /**
   * Renders with continuous scroll on (so the stubbed ContinuousView captures the segmentation
   * context) and returns the straddled-boundary set the component computed. Phrase links must be
   * seeded into `mockPhraseLinkById` before calling.
   *
   * @param book - The book fixture to render.
   * @returns The `straddledBoundaryRefs` set captured from the segmentation context.
   */
  function renderAndCaptureStraddled(book: Book): ReadonlySet<string> {
    renderInterlinearizer({ book, continuousScroll: true });
    const straddled = capturedSegmentation?.straddledBoundaryRefs;
    if (!straddled) throw new Error('expected a captured straddled-boundary set');
    return straddled;
  }

  it('blocks the word refs strictly inside a contiguous three-word phrase', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0', 'GEN 1:3:0']));
    const straddled = renderAndCaptureStraddled(makeLargeBook(4));
    // A boundary before the 2nd or 3rd word would cut the phrase.
    expect(straddled.has('GEN 1:2:0')).toBe(true);
    expect(straddled.has('GEN 1:3:0')).toBe(true);
  });

  it('does not block the phrase-leading word ref or the word after the phrase', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:2:0', 'GEN 1:3:0']));
    const straddled = renderAndCaptureStraddled(makeLargeBook(4));
    // A boundary before the phrase's first word or after its last word leaves it intact.
    expect(straddled.has('GEN 1:1:0')).toBe(false);
    expect(straddled.has('GEN 1:4:0')).toBe(false);
  });

  it('blocks the gap word ref inside a discontiguous phrase', () => {
    // The phrase spans words 1 and 3; word 2 sits in the gap, but a boundary before it would still
    // put the phrase's halves in different segments.
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['GEN 1:1:0', 'GEN 1:3:0']));
    const straddled = renderAndCaptureStraddled(makeLargeBook(4));
    expect(straddled.has('GEN 1:2:0')).toBe(true);
  });

  it('exposes an empty set when no phrase links exist', () => {
    const straddled = renderAndCaptureStraddled(makeLargeBook(4));
    expect(straddled.size).toBe(0);
  });
});

describe('segmentationVersion pass-through', () => {
  /**
   * Builds the wrapped `<Interlinearizer>` element for the pass-through tests, varying only the
   * book and segmentation version between renders.
   *
   * @param book - The (re)segmented book to render.
   * @param segmentationVersion - The boundary-edit counter forwarded to the segment window.
   * @returns The element wrapped in a nav provider.
   */
  function versionedEl(book: Book, segmentationVersion: number): ReactNode {
    return withNav(
      <Interlinearizer
        book={book}
        continuousScroll={false}
        scrRef={defaultScrRef}
        segmentationVersion={segmentationVersion}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        viewOptions={{ ...allFalseViewOptions }}
      />,
    );
  }

  it('redraws in place without a recenter fade when a boundary edit bumps segmentationVersion', () => {
    const { container, rerender } = render(versionedEl(GEN_1_MULTI_BOOK, 0));
    const merged = resegmentBook(GEN_1_MULTI_BOOK, {
      removedVerseStarts: ['GEN 1:2:0'],
      addedStarts: [],
    });
    act(() => {
      rerender(versionedEl(merged, 1));
    });
    // Were the prop dropped on the way to the segment window, the segments-identity change would be
    // classified as a re-tokenization and fade the list out.
    expect(container.querySelector('.tw\\:gap-2.tw\\:transition-opacity')).toHaveStyle({
      opacity: '1',
    });
  });

  it('fades the list for a segments change without a segmentationVersion bump', () => {
    jest.useFakeTimers();
    try {
      const { container, rerender } = render(versionedEl(GEN_1_MULTI_BOOK, 0));
      const merged = resegmentBook(GEN_1_MULTI_BOOK, {
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: [],
      });
      act(() => {
        rerender(versionedEl(merged, 0));
      });
      // Same segments change, same version: a re-tokenization, so the recenter fade runs. This
      // guards the positive case above against passing vacuously in a setup where fades never fire.
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
});
