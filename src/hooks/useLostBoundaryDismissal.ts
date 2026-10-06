import type { UseWebViewStateHook } from '@papi/core';
import type { Book, SegmentationDelta } from 'interlinearizer';
import { useMemo } from 'react';
import { lostBoundaries as findLostBoundaries } from '../utils/segmentation';
import useRecordDismissal from './useRecordDismissal';

type LostBoundaryDismissalOptions = {
  /** The verse-tokenized loaded book, `undefined` while none is loaded. */
  verseBook: Book | undefined;
  /** The draft's boundary edits, whose anchors are the ones checked against the source. */
  segmentation: SegmentationDelta | undefined;
  /** Bumped by every boundary edit. */
  segmentationVersion: number;
  /** Bumped by every wholesale draft replacement (New / Open / Wipe). */
  draftVersion: number;
  /** Whether the initial draft load is still outstanding, which bumps neither counter. */
  isDraftLoading: boolean;
  /** Whether a read-only Paratext 9 import is showing, which the draft's boundaries never reach. */
  isImportView: boolean;
  /** Scopes the dismissal to one tab. */
  useWebViewState: UseWebViewStateHook;
};

type LostBoundaryDismissal = {
  /** The boundaries the loaded source text no longer carries and the user has not dismissed. */
  undismissedLostBoundaries: readonly string[];
  /** Dismisses the banner for exactly the boundaries it is currently reporting. */
  onDismiss: () => void;
};

/**
 * Finds the draft's segment boundaries the loaded source text no longer carries — a loss that
 * reverts those regions to one segment per verse, silently without this — and tracks which of them
 * the user has dismissed the banner for, a boundary that recovers dropping out of the dismissal.
 */
export default function useLostBoundaryDismissal({
  verseBook,
  segmentation,
  segmentationVersion,
  draftVersion,
  isDraftLoading,
  isImportView,
  useWebViewState,
}: LostBoundaryDismissalOptions): LostBoundaryDismissal {
  // Keying on the draft itself would re-run the search after every gloss auto-save, which replaces
  // its identity without touching the boundaries.
  const lostBoundaries = useMemo(
    () => (verseBook && !isImportView ? findLostBoundaries(verseBook, segmentation) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version counters track segmentation, a ref value
    [verseBook, segmentationVersion, draftVersion, isDraftLoading, isImportView],
  );

  const { undismissed, onDismiss } = useRecordDismissal({
    records: lostBoundaries,
    observedBookRef: isImportView ? undefined : verseBook?.bookRef,
    draftVersion,
    stateKey: 'dismissedLostBoundaries',
    useWebViewState,
  });

  return { undismissedLostBoundaries: undismissed, onDismiss };
}
