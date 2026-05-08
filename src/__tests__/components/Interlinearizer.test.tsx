/** @file Unit tests for components/Interlinearizer.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import type { SerializedVerseRef } from '@sillsdev/scripture';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book } from 'interlinearizer';
import Interlinearizer from '../../components/Interlinearizer';

// Store captured props so tests can simulate callbacks
let capturedContinuousViewProps: Record<string, unknown> = {};

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedContinuousViewProps = props;
    return <div data-testid="continuous-view" />;
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

/** Book with a non-word (punctuation) token — exercises the non-word chip branch. */
const GEN_1_1_PUNCTUATION_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: '.',
      tokens: [
        {
          id: 'GEN 1:1:0',
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
  });

  it('renders token chips when the tokenized book has a segment for the current reference', () => {
    renderInterlinearizer();

    expect(screen.getByText('In')).toBeInTheDocument();
  });

  it('shows a no-verse message when the tokenized book has no segments at all', () => {
    renderInterlinearizer({ bookSegments: GEN_EMPTY_BOOK.segments });

    expect(screen.getByText(/no verse data for gen 1\./i)).toBeInTheDocument();
  });

  it('renders all segments in the current chapter', () => {
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments });

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('And')).toBeInTheDocument();
  });

  it('highlights only the segment matching the current verse', () => {
    const { container } = renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments });

    // defaultScrRef is GEN 1:1, so verse 1 is active
    const activeSegments = container.querySelectorAll('button[aria-current="true"]');
    expect(activeSegments).toHaveLength(1);
  });

  it('shows all chapter segments when navigating to a title reference (verse 0)', () => {
    const titleRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 0 };
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, scrRef: titleRef });

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('And')).toBeInTheDocument();
  });

  it('renders non-word tokens as muted chips', () => {
    renderInterlinearizer({ bookSegments: GEN_1_1_PUNCTUATION_BOOK.segments });

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('calls setScrRef with the segment ref when a verse box is clicked', async () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, setScrRef: mockSetScrRef });

    await userEvent.click(screen.getByText('And'));

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 2 });
  });

  it('renders segments in baseline-text mode when continuousScroll is true', () => {
    renderInterlinearizer({ continuousScroll: true });

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();
  });

  it('renders all chapter segments in baseline-text mode when continuousScroll is true', () => {
    renderInterlinearizer({ bookSegments: GEN_1_MULTI_BOOK.segments, continuousScroll: true });

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
    expect(screen.getByText('And the earth.')).toBeInTheDocument();
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
      container.querySelectorAll('[data-testid="continuous-view"], button[aria-current]'),
    );
    expect(allElements[0]).toBe(continuousView);
  });

  it('calls setScrRef when ContinuousView emits onVerseChange', () => {
    const mockSetScrRef = jest.fn();
    renderInterlinearizer({ continuousScroll: true, setScrRef: mockSetScrRef });

    expect(screen.getByTestId('continuous-view')).toBeInTheDocument();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-type-assertion/no-type-assertion
    const onVerseChange = capturedContinuousViewProps.onVerseChange as any;
    expect(onVerseChange).toBeDefined();

    onVerseChange({ book: 'GEN', chapter: 2, verse: 3 });

    expect(mockSetScrRef).toHaveBeenCalledWith({ book: 'GEN', chapterNum: 2, verseNum: 3 });
  });
});
