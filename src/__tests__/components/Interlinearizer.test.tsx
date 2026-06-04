/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import type { Book, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import Interlinearizer from '../../components/Interlinearizer';
import type { SegmentDisplayMode } from '../../components/SegmentView';
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
 * Renders an Interlinearizer component with sensible defaults, allowing individual props to be
 * overridden per test.
 *
 * @param options - Partial props to merge over the defaults.
 * @returns The render result from @testing-library/react.
 */
function renderInterlinearizer({
  book = GEN_1_1_BOOK,
  chapterSegments = GEN_1_1_BOOK.segments,
  continuousScroll = false,
  scrRef = defaultScrRef,
  setScrRef = () => {},
  hideInactiveLinkButtons = false,
  simplifyPhrases = false,
}: {
  book?: Book;
  chapterSegments?: Book['segments'];
  continuousScroll?: boolean;
  scrRef?: SerializedVerseRef;
  setScrRef?: (r: SerializedVerseRef) => void;
  hideInactiveLinkButtons?: boolean;
  simplifyPhrases?: boolean;
} = {}) {
  return render(
    <Interlinearizer
      book={book}
      chapterSegments={chapterSegments}
      continuousScroll={continuousScroll}
      scrRef={scrRef}
      setScrRef={setScrRef}
      analysisLanguage="und"
      phraseMode={{ kind: 'view' }}
      setPhraseMode={() => {}}
      hideInactiveLinkButtons={hideInactiveLinkButtons}
      simplifyPhrases={simplifyPhrases}
    />,
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
    renderInterlinearizer({ chapterSegments: GEN_EMPTY_BOOK.segments });

    expect(screen.getByText(/no verse data for gen 1\./i)).toBeInTheDocument();
  });

  it('renders a SegmentView for every segment in the current chapter', () => {
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
    expect(capturedSegmentViewPropsList[0].segment.id).toBe('GEN 1:1');
    expect(capturedSegmentViewPropsList[1].segment.id).toBe('GEN 1:2');
  });

  it('passes isActive=true only to the segment matching the current verse', () => {
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments });

    // defaultScrRef is GEN 1:1
    expect(capturedSegmentViewPropsList[0].isActive).toBe(true);
    expect(capturedSegmentViewPropsList[1].isActive).toBeFalsy();
  });

  it('renders all segments when navigating to a title reference (verse 0)', () => {
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments, scrRef: titleRef });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
  });

  it('calls setScrRef with the segment ref when a segment fires onSelect', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments, setScrRef: mockSetScrRef });

    capturedSegmentViewPropsList[1].onSelect?.({ book: 'GEN', chapter: 1, verse: 2 });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes displayMode="baseline-text" to all SegmentViews when continuousScroll is true', () => {
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments, continuousScroll: true });

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
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    const continuousView = screen.getByTestId('continuous-view');
    const allElements = Array.from(
      container.querySelectorAll('[data-testid="continuous-view"], [data-testid="segment-view"]'),
    );
    expect(allElements[0]).toBe(continuousView);
  });

  it('calls setScrRef with the segment ref when a token is clicked', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      setScrRef: mockSetScrRef,
    });

    act(() => {
      capturedSegmentViewPropsList[1].onSelect?.(
        { book: 'GEN', chapter: 1, verse: 2 },
        'GEN 1:2:0',
      );
    });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes the clicked token through to ContinuousView as focusedTokenRef', () => {
    // Render in token-chip mode first so onSelect is available on SegmentView props.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: false,
    });

    const { onSelect } = capturedSegmentViewPropsList[1];
    if (typeof onSelect !== 'function') throw new Error('Expected onSelect to be a function');

    act(() => {
      onSelect({ book: 'GEN', chapter: 1, verse: 2 }, 'GEN 1:2:0');
    });

    // Switch to continuous-scroll mode so ContinuousView is rendered and its props captured.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    expect(capturedContinuousViewProps.focusedTokenRef).toBe('GEN 1:2:0');
  });

  it('updates scrRef when ContinuousView reports focus moving into a different verse', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      setScrRef: mockSetScrRef,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      // GEN 1:2:0 belongs to verse 2, which differs from the current scrRef (verse 1).
      onFocusedTokenRefChange('GEN 1:2:0');
    });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('does not update scrRef when ContinuousView focus stays within the current verse', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
      setScrRef: mockSetScrRef,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    mockSetScrRef.mockClear();
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      onFocusedTokenRefChange('GEN 1:1:0');
    });

    expect(mockSetScrRef).not.toHaveBeenCalled();
  });

  it('carries the strip focus into segment view when switching off continuousScroll', () => {
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusedTokenRefChange } = capturedContinuousViewProps;

    act(() => {
      onFocusedTokenRefChange('GEN 1:2:0');
    });

    // Switch to segment view — Interlinearizer should carry the strip focus over.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 2 }}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 1:2:0');
    expect(focused).toBeDefined();
  });

  it('falls back to the active-verse first word when switching off continuousScroll with no strip position', () => {
    // Start in continuous mode without ContinuousView ever calling onFocusPhraseIndexChange.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
    });

    // Switch to segment view without any strip position having been reported.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    // The fallback focuses the first word of GEN 1:1 ('GEN 1:1:0').
    const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenRef === 'GEN 1:1:0');
    expect(focused).toBeDefined();
  });

  it('preserves an existing focusedTokenRef when switching off continuousScroll with no strip position', () => {
    // Start in segment mode and focus a specific token.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
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
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    // Switch back to segment mode — existing focusedTokenRef should be preserved.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    // 'GEN 1:2:0' was already focused, so the fallback must not overwrite it.
    const stillFocused = capturedSegmentViewPropsList.find(
      (p) => p.focusedTokenRef === 'GEN 1:2:0',
    );
    expect(stillFocused).toBeDefined();
  });

  it('renders the snap-to-active-verse button when segments are present', () => {
    renderInterlinearizer({ chapterSegments: GEN_1_MULTI_BOOK.segments });

    expect(screen.getByRole('button', { name: /scroll to active verse/i })).toBeInTheDocument();
  });

  it('does not render the snap-to-active-verse button when there are no segments', () => {
    renderInterlinearizer({ chapterSegments: GEN_EMPTY_BOOK.segments });

    expect(
      screen.queryByRole('button', { name: /scroll to active verse/i }),
    ).not.toBeInTheDocument();
  });

  it('snap button calls scrollIntoView on the active segment', () => {
    renderInterlinearizer({ chapterSegments: GEN_1_1_BOOK.segments });

    act(() => {
      screen.getByRole('button', { name: /scroll to active verse/i }).click();
    });

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it('leaves focusedTokenRef undefined when switching off continuousScroll with no strip position and no matching segment', () => {
    // scrRef points to verse 99 which does not exist in GEN_1_MULTI_BOOK.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 99 },
    });

    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 99 }}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'view' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );

    // No segment matches verse 99 so focusedTokenRef stays undefined for all views.
    capturedSegmentViewPropsList.forEach((p) => expect(p.focusedTokenRef).toBeUndefined());
  });

  it('renders EditPhraseControls toolbar when phraseMode is edit', () => {
    render(
      <Interlinearizer
        book={GEN_1_1_BOOK}
        chapterSegments={GEN_1_1_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
        }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );
    expect(screen.getByTestId('done-edit-btn')).toBeInTheDocument();
  });

  it('renders UnlinkPhraseConfirm toolbar when phraseMode is confirm-unlink', () => {
    render(
      <Interlinearizer
        book={GEN_1_1_BOOK}
        chapterSegments={GEN_1_1_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'confirm-unlink', phraseId: 'phrase-1' }}
        setPhraseMode={() => {}}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );
    expect(screen.getByTestId('unlink-confirm')).toBeInTheDocument();
  });

  it('calls updatePhrase with originalTokens and resets to view mode when revert:true is set', () => {
    const setPhraseMode = jest.fn();
    const originalTokens = [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }];
    render(
      <Interlinearizer
        book={GEN_1_1_BOOK}
        chapterSegments={GEN_1_1_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens, revert: true }}
        setPhraseMode={setPhraseMode}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );
    expect(mockUpdatePhrase).toHaveBeenCalledWith('phrase-1', originalTokens);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('calls updatePhrase and resets to view mode even when the phrase has 0 tokens (all removed)', () => {
    const setPhraseMode = jest.fn();
    render(
      <Interlinearizer
        book={GEN_1_1_BOOK}
        chapterSegments={GEN_1_1_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
        phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: [], revert: true }}
        setPhraseMode={setPhraseMode}
        hideInactiveLinkButtons={false}
        simplifyPhrases={false}
      />,
    );
    expect(mockUpdatePhrase).toHaveBeenCalledWith('phrase-1', []);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });
});
