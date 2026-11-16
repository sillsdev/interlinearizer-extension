import type { UseWebViewStateHook } from '@papi/core';
import type { SegmentPages } from '../types/segment-pages';
import useRecordDismissal from './useRecordDismissal';

type LostBoundaryDismissalOptions = {
  /** The loaded book's pages, `undefined` while none is loaded. */
  pages: SegmentPages | undefined;
  /** Bumped by every wholesale draft replacement (New / Open / Discard). */
  draftVersion: number;
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

const NONE: readonly string[] = [];

/**
 * Reports the draft's segment boundaries that the loaded source text no longer carries, as the
 * book's outline names them. Unreported, such a loss silently reverts those regions to one segment
 * per verse.
 *
 * Also tracks which of them the user has dismissed the banner for; a boundary that recovers drops
 * out of the dismissal.
 */
export default function useLostBoundaryDismissal({
  pages,
  draftVersion,
  isImportView,
  useWebViewState,
}: LostBoundaryDismissalOptions): LostBoundaryDismissal {
  const { undismissed, onDismiss } = useRecordDismissal({
    records: (!isImportView && pages?.boundaries.lostBoundaries) || NONE,
    observedBookRef: isImportView ? undefined : pages?.bookRef,
    draftVersion,
    stateKey: 'dismissedLostBoundaries',
    useWebViewState,
  });

  return { undismissedLostBoundaries: undismissed, onDismiss };
}
