/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import useLostBoundaryDismissal from '../../hooks/useLostBoundaryDismissal';
import useRecordDismissal from '../../hooks/useRecordDismissal';
import type { SegmentPages } from '../../types/segment-pages';
import { GEN_1_1_BOOK, makeWebViewState, segmentPagesOf } from '../test-helpers';

// Passing every record through leaves these tests asserting on what the hook finds.
jest.mock('../../hooks/useRecordDismissal');

/** Pages of GEN whose outline names `lostBoundaries` as lost. */
function pagesLosing(lostBoundaries: readonly string[]): SegmentPages {
  const pages = segmentPagesOf(GEN_1_1_BOOK);
  return { ...pages, boundaries: { ...pages.boundaries, lostBoundaries } };
}

/** Renders the hook over `pages`, the draft's view unless `isImportView`. */
function renderDismissal(pages: SegmentPages | undefined, isImportView = false) {
  return renderHook(() =>
    useLostBoundaryDismissal({
      pages,
      draftVersion: 0,
      isImportView,
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

  it("reports the boundaries that the book's outline names as lost", () => {
    const { result } = renderDismissal(pagesLosing(['GEN 1:9:0', 'GEN 1:1:99']));

    expect(result.current.undismissedLostBoundaries).toEqual(['GEN 1:9:0', 'GEN 1:1:99']);
  });

  it('reports nothing while no book is loaded', () => {
    const { result } = renderDismissal(undefined);

    expect(result.current.undismissedLostBoundaries).toEqual([]);
  });

  it('reports nothing for an import view, which the draft boundaries never reach', () => {
    const { result } = renderDismissal(pagesLosing(['GEN 1:9:0']), true);

    expect(result.current.undismissedLostBoundaries).toEqual([]);
  });

  it('observes no book in an import view, which says nothing about a recovery', () => {
    renderDismissal(pagesLosing([]), true);

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({ observedBookRef: undefined }),
    );
  });

  it('observes the loaded book', () => {
    renderDismissal(pagesLosing([]));

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({ observedBookRef: 'GEN' }),
    );
  });
});
