import { useCallback, useState } from 'react';
import useLatestRef from './useLatestRef';

/** An action held back until the reader agrees to give up every unsaved draft it would drop. */
type HeldAction<Action> = Readonly<{
  /** What the ask names the draft as given up for. */
  action: Action;
  /** The rows the held action would drop. */
  analysisIds: readonly string[];
  /** Rows whose drafts the reader already agreed to discard. */
  confirmedIds: readonly string[];
  run: () => void;
}>;

/**
 * The ask waiting on the reader to give up an unsaved draft, with the controls raising and
 * answering it.
 */
export type DraftDiscardGate<Action> = Readonly<{
  /** The ask awaiting the reader, naming the row whose draft it asks about. */
  asking: Readonly<{ action: Action; analysisId: string }> | undefined;
  /**
   * Runs `run` once the reader has agreed to give up every unsaved draft on `analysisIds`, asking
   * about each in turn, or at once when none holds one.
   */
  request: (action: Action, analysisIds: readonly string[], run: () => void) => void;
  /** Discards the draft asked about and resumes the held action. */
  confirm: () => void;
  /** Abandons the held action, keeping every draft. */
  cancel: () => void;
}>;

/**
 * Holds back an action that would drop rows holding unsaved drafts until the reader agrees to give
 * up each draft — a discard being a decision per draft rather than one taken for all of them.
 */
export default function useDraftDiscardGate<Action>(
  hasUnsavedDraft: (analysisId: string) => boolean,
  discardDraft: (analysisId: string) => void,
): DraftDiscardGate<Action> {
  const [asking, setAsking] = useState<(HeldAction<Action> & { analysisId: string }) | undefined>(
    undefined,
  );

  // Read at each step rather than at the request, so a draft saved or canceled meanwhile is not
  // asked about.
  const hasUnsavedDraftRef = useLatestRef(hasUnsavedDraft);

  const proceed = useCallback(
    (held: HeldAction<Action>) => {
      const analysisId = held.analysisIds.find(
        (id) => !held.confirmedIds.includes(id) && hasUnsavedDraftRef.current(id),
      );
      if (analysisId !== undefined) {
        setAsking({ ...held, analysisId });
        return;
      }
      setAsking(undefined);
      held.run();
    },
    [hasUnsavedDraftRef],
  );

  const request = useCallback(
    (action: Action, analysisIds: readonly string[], run: () => void) =>
      proceed({ action, analysisIds, confirmedIds: [], run }),
    [proceed],
  );

  const confirm = useCallback(() => {
    /* v8 ignore next -- unreachable: the ask that calls this shows only while one is held */
    if (!asking) return;
    discardDraft(asking.analysisId);
    proceed({ ...asking, confirmedIds: [...asking.confirmedIds, asking.analysisId] });
  }, [asking, discardDraft, proceed]);

  const cancel = useCallback(() => setAsking(undefined), []);

  return {
    asking: asking && { action: asking.action, analysisId: asking.analysisId },
    request,
    confirm,
    cancel,
  };
}
