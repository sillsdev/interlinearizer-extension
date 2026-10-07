/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { Book, SegmentationDelta } from 'interlinearizer';
import useLostBoundaryDismissal from '../../hooks/useLostBoundaryDismissal';
import useRecordDismissal from '../../hooks/useRecordDismissal';
import { GEN_1_1_BOOK, makeSegment, makeWebViewState, makeWordToken } from '../test-helpers';

// Passing every record through leaves these tests asserting on what the hook finds.
jest.mock('../../hooks/useRecordDismissal');

/** A two-verse book, with a mid-verse token, that the deltas below anchor into. */
const TWO_VERSE_BOOK: Book = {
  ...GEN_1_1_BOOK,
  segments: [
    makeSegment('GEN 1:1', 'Alpha beta.', [
      makeWordToken('GEN 1:1:0', 'Alpha'),
      makeWordToken('GEN 1:1:6', 'beta', 6),
    ]),
    makeSegment('GEN 1:2', 'Gamma.', [makeWordToken('GEN 1:2:0', 'Gamma')]),
  ],
};

/** The hook options a test varies; the rest stay fixed. */
type HookInput = {
  verseBook?: Book | undefined;
  segmentation: SegmentationDelta | undefined;
  isImportView?: boolean;
};

/** Renders the hook on {@link TWO_VERSE_BOOK} unless the input names another book or none. */
function renderDismissal(input: HookInput) {
  return renderHook(() =>
    useLostBoundaryDismissal({
      verseBook: 'verseBook' in input ? input.verseBook : TWO_VERSE_BOOK,
      segmentation: input.segmentation,
      segmentationVersion: 0,
      draftVersion: 0,
      isDraftLoading: false,
      isImportView: input.isImportView ?? false,
      useWebViewState: makeWebViewState(),
    }),
  );
}

describe('useLostBoundaryDismissal', () => {
  beforeEach(() => {
    jest
      .mocked(useRecordDismissal)
      .mockImplementation(({ records }) => ({ undismissed: records, onDismiss: jest.fn() }));
  });

  describe('finding the lost anchors', () => {
    it('reports the anchors the source no longer carries', () => {
      const { result } = renderDismissal({
        segmentation: {
          removedVerseStarts: ['GEN 1:9:0'],
          addedStarts: [{ tokenRef: 'GEN 1:1:99', surfaceText: 'beta' }],
        },
      });

      expect(result.current.undismissedLostBoundaries).toEqual(['GEN 1:9:0', 'GEN 1:1:99']);
    });

    it('reports nothing when every anchor still resolves', () => {
      const { result } = renderDismissal({
        segmentation: {
          removedVerseStarts: ['GEN 1:2:0'],
          addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
        },
      });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });

    it('reports nothing for the default segmentation', () => {
      const { result } = renderDismissal({ segmentation: undefined });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });

    it('reports nothing while no book is loaded', () => {
      const { result } = renderDismissal({
        verseBook: undefined,
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
      });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });

    it('reports nothing for an import view, which the draft boundaries never reach', () => {
      const { result } = renderDismissal({
        isImportView: true,
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
      });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });

    it('ignores anchors in a book other than the loaded one', () => {
      const { result } = renderDismissal({
        segmentation: {
          removedVerseStarts: ['EXO 1:5:0'],
          addedStarts: [{ tokenRef: 'EXO 1:1:6', surfaceText: 'beta' }],
        },
      });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });
  });

  it('observes no book in an import view, which says nothing about a recovery', () => {
    renderDismissal({ isImportView: true, segmentation: undefined });

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({ observedBookRef: undefined }),
    );
  });

  it('observes the loaded book', () => {
    renderDismissal({ segmentation: undefined });

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({ observedBookRef: 'GEN' }),
    );
  });
});
