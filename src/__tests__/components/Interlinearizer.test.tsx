/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import type { Book, ScriptureRef, Segment } from 'interlinearizer';
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
  /** When set, the strip jumps to this phrase index. */
  activePhraseIndex: number | undefined;
  /** Verse coordinate used to scroll the strip. */
  activeVerse: ScriptureRef;
  /** The full tokenized book. */
  book: Book;
  /** Called when the focused phrase index changes. */
  onFocusPhraseIndexChange: (index: number) => void;
  /** Called when arrow navigation moves focus into a new verse. */
  onVerseChange: (verse: ScriptureRef) => void;
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
};
let capturedSegmentViewPropsList: CapturedSegmentViewProps[] = [];

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
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: CapturedContinuousViewProps) => {
    capturedContinuousViewProps = props;
    return (
      <div
        data-active-phrase-index={
          props.activePhraseIndex === undefined ? undefined : String(props.activePhraseIndex)
        }
        data-testid="continuous-view"
      />
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
   * @param props.rest - Any additional props forwarded from the parent.
   * @returns A div with `data-testid="segment-view"` and the segment id.
   */
  SegmentView: ({ segment, isActive, ...rest }: CapturedSegmentViewProps) => {
    capturedSegmentViewPropsList.push({ segment, isActive, ...rest });
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
   * @param props.rest - Any additional props forwarded from the parent.
   * @returns A div with `data-testid="segment-view"` and the segment id.
   */
  default: ({ segment, isActive, ...rest }: CapturedSegmentViewProps) => {
    capturedSegmentViewPropsList.push({ segment, isActive, ...rest });
    return (
      <div
        aria-current={isActive ? 'true' : undefined}
        data-testid="segment-view"
        data-segment-id={segment.id}
      />
    );
  },
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
}: {
  book?: Book;
  chapterSegments?: Book['segments'];
  continuousScroll?: boolean;
  scrRef?: SerializedVerseRef;
  setScrRef?: (r: SerializedVerseRef) => void;
} = {}) {
  return render(
    <Interlinearizer
      book={book}
      chapterSegments={chapterSegments}
      continuousScroll={continuousScroll}
      scrRef={scrRef}
      setScrRef={setScrRef}
      analysisLanguage="und"
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

  it('passes activePhraseIndex to ContinuousView matching the clicked token', () => {
    // Render in token-chip mode first so onSelect is available on SegmentView props.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: false,
    });

    // GEN 1:2 word token is phrase index 1 (after GEN 1:1's one word token at index 0).
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
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
      />,
    );

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    expect(capturedContinuousViewProps.activePhraseIndex).toBe(1);
  });

  it('calls setScrRef when ContinuousView emits onVerseChange', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ continuousScroll: true, setScrRef: mockSetScrRef });

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onVerseChange } = capturedContinuousViewProps;

    onVerseChange({ book: 'GEN', chapter: 2, verse: 3 });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 2, verseNum: 3 });
  });

  it('does not update activePhraseIndex when ContinuousView emits onFocusPhraseIndexChange', () => {
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusPhraseIndexChange } = capturedContinuousViewProps;

    act(() => {
      onFocusPhraseIndexChange(1);
    });

    // Re-render in continuous mode — just verifying the callback does not throw and updates state.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
      />,
    );

    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    expect(capturedContinuousViewProps.activePhraseIndex).toBeUndefined();
  });

  it('carries the strip phrase position into segment view when switching off continuousScroll', () => {
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      chapterSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    // Simulate ContinuousView reporting that phrase index 1 (GEN 1:2's token) is in view.
    if (!capturedContinuousViewProps)
      throw new Error('Expected ContinuousView to have been rendered');
    const { onFocusPhraseIndexChange } = capturedContinuousViewProps;

    act(() => {
      onFocusPhraseIndexChange(1);
    });

    // Switch to segment view — Interlinearizer should carry over phrase index 1 as the focus.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        chapterSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
        analysisLanguage="und"
      />,
    );

    // The token at phrase index 1 is 'GEN 1:2:0'; it should now be the focusedTokenRef.
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
      />,
    );

    // No segment matches verse 99 so focusedTokenRef stays undefined for all views.
    capturedSegmentViewPropsList.forEach((p) => expect(p.focusedTokenRef).toBeUndefined());
  });
});
