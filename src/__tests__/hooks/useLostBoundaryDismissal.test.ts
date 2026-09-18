/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { Book, SegmentationDelta } from 'interlinearizer';
import useLostBoundaryDismissal from '../../hooks/useLostBoundaryDismissal';
import { GEN_1_1_BOOK, makeSegment, makeWebViewState, makeWordToken } from '../test-helpers';

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

/** {@link TWO_VERSE_BOOK} with the verse carrying the anchor the deltas below remove. */
const THREE_VERSE_BOOK: Book = {
  ...TWO_VERSE_BOOK,
  segments: [
    ...TWO_VERSE_BOOK.segments,
    makeSegment('GEN 1:3', 'Delta.', [makeWordToken('GEN 1:3:0', 'Delta')]),
  ],
};

/** Another book entirely, whose own anchors are all intact. */
const OTHER_BOOK: Book = {
  ...TWO_VERSE_BOOK,
  id: 'EXO',
  bookRef: 'EXO',
  segments: [makeSegment('EXO 1:1', 'Epsilon.', [makeWordToken('EXO 1:1:0', 'Epsilon')])],
};

/** The hook options a test varies between renders; the rest stay fixed. */
type HookInput = {
  verseBook?: Book | undefined;
  segmentation?: SegmentationDelta | undefined;
  draftVersion?: number;
  isImportView?: boolean;
};

/**
 * Renders the hook on {@link TWO_VERSE_BOOK} with one WebView-state store held across rerenders, so
 * a dismissal persists exactly as it does for a tab. Rerendering takes the whole input afresh
 * rather than a patch, keeping each step's book and delta stated where it is asserted on.
 */
function renderDismissal(initial: HookInput, webViewSeed: Record<string, unknown> = {}) {
  const useWebViewState = makeWebViewState(webViewSeed);
  const { result, rerender } = renderHook(
    (input: HookInput) =>
      useLostBoundaryDismissal({
        verseBook: 'verseBook' in input ? input.verseBook : TWO_VERSE_BOOK,
        segmentation: input.segmentation,
        segmentationVersion: 0,
        draftVersion: input.draftVersion ?? 0,
        isDraftLoading: false,
        isImportView: input.isImportView ?? false,
        useWebViewState,
      }),
    { initialProps: initial },
  );
  return { result, rerenderWith: (input: HookInput) => act(() => rerender(input)) };
}

describe('useLostBoundaryDismissal', () => {
  describe('finding the lost anchors', () => {
    it('reports the anchors the source no longer carries', () => {
      const { result } = renderDismissal({
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: ['GEN 1:1:99'] },
      });

      expect(result.current.undismissedLostBoundaries).toEqual(['GEN 1:9:0', 'GEN 1:1:99']);
    });

    it('reports nothing when every anchor still resolves', () => {
      const { result } = renderDismissal({
        segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: ['GEN 1:1:6'] },
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
        segmentation: { removedVerseStarts: ['EXO 1:5:0'], addedStarts: ['EXO 1:1:6'] },
      });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });
  });

  describe('dismissal', () => {
    it('clears the flag for exactly the anchors it was raised for', () => {
      const { result } = renderDismissal({
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
      });

      act(() => result.current.onDismiss());

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });

    it('stays down while the same anchors stay lost', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      // A source edit re-tokenizes to a fresh Book carrying the same text.
      rerenderWith({ verseBook: { ...TWO_VERSE_BOOK }, segmentation });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });

    it('stays down for a tab whose stored dismissal covers every lost anchor', () => {
      const { result } = renderDismissal(
        { segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: ['GEN 1:1:99'] } },
        { dismissedLostBoundaries: ['GEN 1:9:0', 'GEN 1:1:99'] },
      );

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });

    it('comes back for an anchor lost after the dismissal, reporting only that one', () => {
      // The stored dismissal covers one of the two anchors the loaded source strands.
      const { result } = renderDismissal(
        { segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: ['GEN 1:1:99'] } },
        { dismissedLostBoundaries: ['GEN 1:9:0'] },
      );

      expect(result.current.undismissedLostBoundaries).toEqual(['GEN 1:1:99']);
    });

    it('keeps another book’s dismissal when dismissing in this one', () => {
      // One delta spans the draft, so each book's dismissal covers only the anchors it reports.
      const segmentation = { removedVerseStarts: ['GEN 1:9:0', 'EXO 1:9:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      rerenderWith({ verseBook: OTHER_BOOK, segmentation });
      expect(result.current.undismissedLostBoundaries).toEqual(['EXO 1:9:0']);
      act(() => result.current.onDismiss());

      rerenderWith({ verseBook: { ...TWO_VERSE_BOOK }, segmentation });

      expect(result.current.undismissedLostBoundaries).toEqual([]);
    });

    it('stays down when an anchor comes back but the rest are dismissed', () => {
      // 'GEN 1:2:0' resolves in this book, so only the dismissed anchor is still lost.
      const { result } = renderDismissal(
        { segmentation: { removedVerseStarts: ['GEN 1:9:0', 'GEN 1:2:0'], addedStarts: [] } },
        { dismissedLostBoundaries: ['GEN 1:9:0', 'GEN 1:1:99'] },
      );

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });
  });

  describe('dropping a spent dismissal', () => {
    it('comes back when a recovered anchor is stranded again', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:3:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      rerenderWith({ verseBook: THREE_VERSE_BOOK, segmentation });
      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);

      // The recovery ended the loss the dismissal acknowledged, so losing it again is a fresh one.
      rerenderWith({ verseBook: { ...TWO_VERSE_BOOK }, segmentation });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(true);
    });

    it('keeps a dismissal across a visit to another book', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      // The other book reports none of GEN's anchors, which is not the same as their recovery.
      rerenderWith({ verseBook: OTHER_BOOK, segmentation });
      rerenderWith({ verseBook: { ...TWO_VERSE_BOOK }, segmentation });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });

    it('comes back when the anchor recovers in its own book after a visit elsewhere', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:3:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      rerenderWith({ verseBook: OTHER_BOOK, segmentation });
      // Back in GEN the anchor resolves, so the dismissal it covered is spent.
      rerenderWith({ verseBook: THREE_VERSE_BOOK, segmentation });
      rerenderWith({ verseBook: { ...TWO_VERSE_BOOK }, segmentation });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(true);
    });

    it('reads no recovery from an import view, which reports no anchors of its own', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      rerenderWith({ isImportView: true, segmentation });
      rerenderWith({ segmentation });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });

    it('drops the dismissal when the draft is replaced wholesale', () => {
      const segmentation = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] };
      const { result, rerenderWith } = renderDismissal({ segmentation });
      act(() => result.current.onDismiss());

      // The replacement carries the same delta, so the same anchor is lost afresh.
      rerenderWith({ segmentation, draftVersion: 1 });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(true);
    });

    it('drops the dismissal when a replacement keeps one lost anchor and recovers another', () => {
      const { result, rerenderWith } = renderDismissal({
        segmentation: { removedVerseStarts: ['GEN 1:9:0', 'GEN 1:8:0'], addedStarts: [] },
      });
      act(() => result.current.onDismiss());

      // The replacement strands only the first anchor, whose loss the user has not seen in it.
      rerenderWith({
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
        draftVersion: 1,
      });

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(true);
    });

    it('keeps a stored dismissal through the mount pass, so a restored tab stays down', () => {
      const { result } = renderDismissal(
        {
          segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
          // A restored tab mounts at whatever draft version it left off at, not at zero.
          draftVersion: 4,
        },
        { dismissedLostBoundaries: ['GEN 1:9:0'] },
      );

      expect(result.current.undismissedLostBoundaries.length > 0).toBe(false);
    });
  });
});
