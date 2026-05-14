/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import type { Book, Segment } from 'interlinearizer';
import Interlinearizer from '../../components/Interlinearizer';

// Store captured props so tests can inspect what Interlinearizer passes down
let capturedContinuousViewProps: Record<string, unknown> = {};

type CapturedSegmentViewProps = {
  segment: Segment;
  displayMode?: string;
  isActive?: boolean;
  onClick?: (ref: { book: string; chapter: number; verse: number }) => void;
};
let capturedSegmentViewPropsList: CapturedSegmentViewProps[] = [];

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedContinuousViewProps = props;
    return <div data-testid="continuous-view" />;
  },
}));

jest.mock('../../components/SegmentView', () => ({
  __esModule: true,
  SegmentView: ({ segment, ...rest }: CapturedSegmentViewProps) => {
    capturedSegmentViewPropsList.push({ segment, ...rest });
    return <div data-testid="segment-view" data-segment-id={segment.id} />;
  },
  default: ({ segment, ...rest }: CapturedSegmentViewProps) => {
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

    capturedSegmentViewPropsList[1].onClick?.({ book: 'GEN', chapter: 1, verse: 2 });

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
});
