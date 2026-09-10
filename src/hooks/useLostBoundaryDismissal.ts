import type { UseWebViewStateHook } from '@papi/core';
import type { Book, SegmentationDelta } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { lostAnchors } from '../utils/segmentation';

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
  /** The anchors the loaded source text no longer carries and the user has not dismissed. */
  undismissedLostBoundaries: readonly string[];
  /** Dismisses the banner for exactly the anchors it is currently reporting. */
  onDismiss: () => void;
};

/**
 * Finds the draft's segment boundaries the loaded source text no longer carries an anchor for — a
 * loss that reverts those regions to one segment per verse, silently without this — and tracks
 * which of them the user has dismissed the banner for.
 *
 * A dismissal names the anchors it covered rather than setting a flag, so a later edit that strands
 * further boundaries raises the banner again while a shrinking loss leaves it down. It is dropped
 * when the draft is replaced wholesale, and per-anchor when an anchor recovers, on the grounds that
 * either makes the next loss one the user has not seen.
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
    () => (verseBook && !isImportView ? lostAnchors(verseBook, segmentation) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version counters track segmentation, a ref value
    [verseBook, segmentationVersion, draftVersion, isDraftLoading, isImportView],
  );

  /**
   * The lost-boundary anchors the user has dismissed the banner for — an acknowledgement of a
   * message, tab-scoped rather than persisted into the draft alongside the analysis.
   */
  const [dismissedLostBoundaries, setDismissedLostBoundaries] = useWebViewState<readonly string[]>(
    'dismissedLostBoundaries',
    [],
  );

  const undismissedLostBoundaries = useMemo(() => {
    const dismissed = new Set(dismissedLostBoundaries);
    return lostBoundaries.filter((ref) => !dismissed.has(ref));
  }, [lostBoundaries, dismissedLostBoundaries]);

  /**
   * The stored list spans the whole draft while a loaded book reports only its own anchors, so a
   * dismissal has to leave every other book's acknowledgement standing.
   */
  const onDismiss = useCallback(() => {
    setDismissedLostBoundaries([...new Set([...dismissedLostBoundaries, ...lostBoundaries])]);
  }, [dismissedLostBoundaries, lostBoundaries, setDismissedLostBoundaries]);

  /**
   * The draft the dismissal acknowledged, so a wholesale replacement drops it: the acknowledgement
   * was of one draft's message, and a replacement stranding the same anchor is a loss the user has
   * not seen.
   */
  const dismissedDraftVersionRef = useRef(draftVersion);
  /** Whether the dismissal has just been dropped wholesale, leaving nothing to drop per-anchor. */
  const draftReplacedRef = useRef(false);
  useEffect(() => {
    // Skipping the mount pass leaves a dismissal restored with the tab in place.
    if (dismissedDraftVersionRef.current === draftVersion) return;
    dismissedDraftVersionRef.current = draftVersion;
    draftReplacedRef.current = true;
    setDismissedLostBoundaries([]);
  }, [draftVersion, setDismissedLostBoundaries]);

  /**
   * Drops a dismissed anchor once it recovers, so stranding it again raises the banner rather than
   * carrying the earlier acknowledgement across the recovery.
   *
   * Only a recovery seen in this tab counts: a dismissal restored alongside the tab names anchors
   * from whatever the source looked like when it was made, so absence alone implies no recovery.
   *
   * A recovery is only observable in the book that owns the anchor: a book that never reports an
   * anchor, like an unloaded or import view, says nothing about whether it came back.
   */
  const observedLostBoundariesRef = useRef(new Map<string, readonly string[]>());
  useEffect(() => {
    const observableBookRef = isImportView ? undefined : verseBook?.bookRef;
    if (!observableBookRef) return;
    const observed = observedLostBoundariesRef.current;
    const previous = observed.get(observableBookRef);
    observed.set(observableBookRef, lostBoundaries);
    if (draftReplacedRef.current) {
      draftReplacedRef.current = false;
      return;
    }
    if (previous === undefined) return;
    const stillLost = new Set(lostBoundaries);
    const recovered = previous.filter((ref) => !stillLost.has(ref));
    if (recovered.length === 0) return;
    const recoveredSet = new Set(recovered);
    setDismissedLostBoundaries(dismissedLostBoundaries.filter((ref) => !recoveredSet.has(ref)));
  }, [
    lostBoundaries,
    dismissedLostBoundaries,
    setDismissedLostBoundaries,
    verseBook,
    isImportView,
  ]);

  return { undismissedLostBoundaries, onDismiss };
}
