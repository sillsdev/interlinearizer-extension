import type { UseWebViewStateHook } from '@papi/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

type RecordDismissalOptions = {
  /** The records the banner reports for the loaded book. */
  records: readonly string[];
  /** The book `records` were found in, `undefined` while no book's records are observable. */
  observedBookRef: string | undefined;
  /** Bumped by every wholesale draft replacement (New / Open / Wipe). */
  draftVersion: number;
  /** The WebView-state key the dismissal is stored under, one per banner. */
  stateKey: string;
  /** Scopes the dismissal to one tab. */
  useWebViewState: UseWebViewStateHook;
};

type RecordDismissal = {
  /** The records the user has not dismissed the banner for. */
  undismissed: readonly string[];
  /** Dismisses the banner for exactly the records it is currently reporting. */
  onDismiss: () => void;
};

/**
 * Tracks which of a banner's records the user has dismissed it for.
 *
 * A dismissal names the records it covered rather than setting a flag, so a later edit raising
 * further records raises the banner again while a shrinking set leaves it down. It is dropped when
 * the draft is replaced wholesale, and singly when a record clears, on the grounds that either
 * makes the next one a record the user has not seen.
 */
export default function useRecordDismissal({
  records,
  observedBookRef,
  draftVersion,
  stateKey,
  useWebViewState,
}: RecordDismissalOptions): RecordDismissal {
  /**
   * The records the user has dismissed the banner for — an acknowledgement of a message, tab-scoped
   * rather than persisted into the draft alongside the analysis.
   */
  const [dismissed, setDismissed] = useWebViewState<readonly string[]>(stateKey, []);

  const undismissed = useMemo(() => {
    const dismissedSet = new Set(dismissed);
    return records.filter((record) => !dismissedSet.has(record));
  }, [records, dismissed]);

  /**
   * The stored list spans the whole draft while a loaded book reports only its own records, so a
   * dismissal has to leave every other book's acknowledgement standing.
   */
  const onDismiss = useCallback(() => {
    setDismissed([...new Set([...dismissed, ...records])]);
  }, [dismissed, records, setDismissed]);

  /**
   * The draft the dismissal acknowledged, so a wholesale replacement drops it: the acknowledgement
   * was of one draft's message, and a replacement raising the same record is one the user has not
   * seen.
   */
  const dismissedDraftVersionRef = useRef(draftVersion);
  /** Whether the dismissal has just been dropped wholesale, leaving nothing to drop singly. */
  const draftReplacedRef = useRef(false);
  useEffect(() => {
    // Skipping the mount pass leaves a dismissal restored with the tab in place.
    if (dismissedDraftVersionRef.current === draftVersion) return;
    dismissedDraftVersionRef.current = draftVersion;
    draftReplacedRef.current = true;
    setDismissed([]);
  }, [draftVersion, setDismissed]);

  /**
   * Drops a dismissed record once it clears, so raising it again raises the banner rather than
   * carrying the earlier acknowledgement across.
   *
   * Only a clearing seen in this tab counts: a dismissal restored alongside the tab names records
   * from whatever the draft looked like when it was made, so absence alone implies no clearing.
   *
   * A clearing is only observable in the book that owns the record: a book that never reports one,
   * like an unloaded or import view, says nothing about whether it cleared.
   */
  const observedRecordsRef = useRef(new Map<string, readonly string[]>());
  useEffect(() => {
    if (!observedBookRef) return;
    const observed = observedRecordsRef.current;
    const previous = observed.get(observedBookRef);
    observed.set(observedBookRef, records);
    if (draftReplacedRef.current) {
      draftReplacedRef.current = false;
      return;
    }
    if (previous === undefined) return;
    const stillRaised = new Set(records);
    const cleared = previous.filter((record) => !stillRaised.has(record));
    if (cleared.length === 0) return;
    const clearedSet = new Set(cleared);
    setDismissed(dismissed.filter((record) => !clearedSet.has(record)));
  }, [records, dismissed, setDismissed, observedBookRef]);

  return { undismissed, onDismiss };
}
