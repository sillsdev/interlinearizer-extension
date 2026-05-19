/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import type { Book, Segment } from 'interlinearizer';
import Interlinearizer from '../../components/Interlinearizer';

// Store captured props so tests can inspect what Interlinearizer passes down
let capturedContinuousViewProps: Record<string, unknown> = {};

type CapturedSegmentViewProps = {
  segment: Segment;
  displayMode?: string;
  focusedTokenId?: string;
  isActive?: boolean;
  onSelect?: (ref: { book: string; chapter: number; verse: number }, tokenId?: string) => void;
};
let capturedSegmentViewPropsList: CapturedSegmentViewProps[] = [];

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedContinuousViewProps = props;
    return (
      <div
        data-active-phrase-index={
          typeof props.activePhraseIndex === 'number' ? String(props.activePhraseIndex) : undefined
        }
        data-testid="continuous-view"
      />
    );
  },
}));

jest.mock('../../components/SegmentView', () => ({
  __esModule: true,
  SegmentView: ({
    segment,
    ...rest
  }: CapturedSegmentViewProps & { glosses?: Record<string, string> }) => {
    capturedSegmentViewPropsList.push({ segment, ...rest });
    return <div data-testid="segment-view" data-segment-id={segment.id} />;
  },
  default: ({
    segment,
    ...rest
  }: CapturedSegmentViewProps & { glosses?: Record<string, string> }) => {
    capturedSegmentViewPropsList.push({ segment, ...rest });
    return <div data-testid="segment-view" data-segment-id={segment.id} />;
  },
}));

const defaultScrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** Pre-built Book with one GEN 1:1 segment. */
const GEN_1_1_BOOK: Book = {
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
          id: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
      ],
    },
  ],
};

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
          id: 'GEN 1:1:0',
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
          id: 'GEN 1:2:0',
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
  bookSegments = GEN_1_1_BOOK.segments,
  continuousScroll = false,
  scrRef = defaultScrRef,
  setScrRef = () => {},
}: {
  book?: Book;
  bookSegments?: Book['segments'];
  continuousScroll?: boolean;
  scrRef?: SerializedVerseRef;
  setScrRef?: (r: SerializedVerseRef) => void;
} = {}) {
  return render(
    <Interlinearizer
      book={book}
      bookSegments={bookSegments}
      continuousScroll={continuousScroll}
      scrRef={scrRef}
      setScrRef={setScrRef}
    />,
  );
}

describe('Interlinearizer', () => {
  beforeEach(() => {
    capturedContinuousViewProps = {};
    capturedSegmentViewPropsList = [];
  });

  it('renders a SegmentView when the tokenized book has a segment for the current reference', () => {
    renderInterlinearizer();

    expect(screen.getAllByTestId('segment-view')).toHaveLength(1);
  });

  it('shows a no-verse message when the tokenized book has no segments at all', () => {
    renderInterlinearizer({ bookSegments: GEN_EMPTY_BOOK.segments });

    expect(screen.getByText(/no verse data for gen 1\./i)).toBeInTheDocument();
  });

  it('renders a SegmentView for every segment in the current chapter', () => {
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
    expect(capturedSegmentViewPropsList[0].segment.id).toBe('GEN 1:1');
    expect(capturedSegmentViewPropsList[1].segment.id).toBe('GEN 1:2');
  });

  it('passes isActive=true only to the segment matching the current verse', () => {
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments });

    // defaultScrRef is GEN 1:1
    expect(capturedSegmentViewPropsList[0].isActive).toBe(true);
    expect(capturedSegmentViewPropsList[1].isActive).toBeFalsy();
  });

  it('renders all segments when navigating to a title reference (verse 0)', () => {
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, scrRef: titleRef });

    expect(screen.getAllByTestId('segment-view')).toHaveLength(2);
  });

  it('calls setScrRef with the segment ref when a verse box is clicked', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, setScrRef: mockSetScrRef });

    capturedSegmentViewPropsList[1].onSelect?.({ book: 'GEN', chapter: 1, verse: 2 });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes displayMode="baseline-text" to SegmentView when continuousScroll is true', () => {
    renderInterlinearizer({ continuousScroll: true });

    expect(capturedSegmentViewPropsList[0].displayMode).toBe('baseline-text');
  });

  it('passes displayMode="baseline-text" to all SegmentViews when continuousScroll is true', () => {
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, continuousScroll: true });

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
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    const continuousView = screen.getByTestId('continuous-view');
    const allElements = Array.from(
      container.querySelectorAll('[data-testid="continuous-view"], [data-testid="segment-view"]'),
    );
    expect(allElements[0]).toBe(continuousView);
  });

  it('passes onSelect to SegmentView when continuousScroll is false', () => {
    renderInterlinearizer({ continuousScroll: false });

    expect(capturedSegmentViewPropsList[0].onSelect).toBeInstanceOf(Function);
  });

  it('passes onSelect to SegmentView when continuousScroll is true', () => {
    renderInterlinearizer({ continuousScroll: true });

    expect(capturedSegmentViewPropsList[0].onSelect).toBeInstanceOf(Function);
  });

  it('calls setScrRef with the segment ref when a token is clicked', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      setScrRef: mockSetScrRef,
    });

    capturedSegmentViewPropsList[1].onSelect?.({ book: 'GEN', chapter: 1, verse: 2 }, 'GEN 1:2:0');

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('passes activePhraseIndex to ContinuousView matching the clicked token', () => {
    // Render in token-chip mode first so onSelect is available on SegmentView props.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
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
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={defaultScrRef}
        setScrRef={() => {}}
      />,
    );

    expect(capturedContinuousViewProps.activePhraseIndex).toBe(1);
  });

  it('passes onGlossChange to ContinuousView and updates glosses state', () => {
    renderInterlinearizer({ continuousScroll: true });

    const { onGlossChange } = capturedContinuousViewProps;
    if (typeof onGlossChange !== 'function')
      throw new Error('Expected onGlossChange to be a function');

    act(() => {
      onGlossChange('token-1', 'hello');
    });

    expect(capturedContinuousViewProps.glosses).toEqual({ 'token-1': 'hello' });
  });

  it('calls setScrRef when ContinuousView emits onVerseChange', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ continuousScroll: true, setScrRef: mockSetScrRef });

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();

    const { onVerseChange } = capturedContinuousViewProps;
    if (typeof onVerseChange !== 'function')
      throw new Error('Expected onVerseChange to be a function');

    onVerseChange({ book: 'GEN', chapter: 2, verse: 3 });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 2, verseNum: 3 });
  });

  it('updates continuousViewPhraseIndex when ContinuousView emits onFocusPhraseIndexChange', () => {
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    const { onFocusPhraseIndexChange } = capturedContinuousViewProps;
    if (typeof onFocusPhraseIndexChange !== 'function')
      throw new Error('Expected onFocusPhraseIndexChange to be a function');

    act(() => {
      onFocusPhraseIndexChange(1);
    });

    // Re-render in continuous mode — just verifying the callback does not throw and updates state.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={defaultScrRef}
        setScrRef={() => {}}
      />,
    );

    expect(capturedContinuousViewProps.activePhraseIndex).toBeUndefined();
  });

  it('carries the strip phrase position into segment view when switching off continuousScroll', () => {
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
    });

    // Simulate ContinuousView reporting that phrase index 1 (GEN 1:2's token) is in view.
    const { onFocusPhraseIndexChange } = capturedContinuousViewProps;
    if (typeof onFocusPhraseIndexChange !== 'function')
      throw new Error('Expected onFocusPhraseIndexChange to be a function');

    act(() => {
      onFocusPhraseIndexChange(1);
    });

    // Switch to segment view — Interlinearizer should carry over phrase index 1 as the focus.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
      />,
    );

    // The token at phrase index 1 is 'GEN 1:2:0'; it should now be the focusedTokenId.
    const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenId === 'GEN 1:2:0');
    expect(focused).toBeDefined();
  });

  it('falls back to the active-verse first word when switching off continuousScroll with no strip position', () => {
    // Start in continuous mode without ContinuousView ever calling onFocusPhraseIndexChange.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 1 },
    });

    // Switch to segment view without any strip position having been reported.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 1 }}
        setScrRef={() => {}}
      />,
    );

    // The fallback focuses the first word of GEN 1:1 ('GEN 1:1:0').
    const focused = capturedSegmentViewPropsList.find((p) => p.focusedTokenId === 'GEN 1:1:0');
    expect(focused).toBeDefined();
  });

  it('preserves an existing focusedTokenId when switching off continuousScroll with no strip position', () => {
    // Start in segment mode and focus a specific token.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: false,
    });

    // Click a token to set focusedTokenId to 'GEN 1:2:0'.
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
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll
        scrRef={defaultScrRef}
        setScrRef={() => {}}
      />,
    );

    // Switch back to segment mode — existing focusedTokenId should be preserved.
    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={defaultScrRef}
        setScrRef={() => {}}
      />,
    );

    // 'GEN 1:2:0' was already focused, so the fallback must not overwrite it.
    const stillFocused = capturedSegmentViewPropsList.find((p) => p.focusedTokenId === 'GEN 1:2:0');
    expect(stillFocused).toBeDefined();
  });

  it('leaves focusedTokenId undefined when switching off continuousScroll with no strip position and no matching segment', () => {
    // scrRef points to verse 99 which does not exist in GEN_1_MULTI_BOOK.
    const { rerender } = renderInterlinearizer({
      book: GEN_1_MULTI_BOOK,
      bookSegments: GEN_1_MULTI_BOOK.segments,
      continuousScroll: true,
      scrRef: { book: 'GEN', chapterNum: 1, verseNum: 99 },
    });

    capturedSegmentViewPropsList = [];
    rerender(
      <Interlinearizer
        book={GEN_1_MULTI_BOOK}
        bookSegments={GEN_1_MULTI_BOOK.segments}
        continuousScroll={false}
        scrRef={{ book: 'GEN', chapterNum: 1, verseNum: 99 }}
        setScrRef={() => {}}
      />,
    );

    // No segment matches verse 99 so focusedTokenId stays undefined for all views.
    capturedSegmentViewPropsList.forEach((p) => expect(p.focusedTokenId).toBeUndefined());
  });
});
