/** @file Confirmation popup for unlinking (deleting) a phrase. */
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseDispatch } from './AnalysisStore';
import type { PhraseMode } from './phrase-mode';

/** Props for {@link UnlinkPhraseConfirm}. */
type UnlinkPhraseConfirmProps = Readonly<{
  /** ID of the phrase the user is asking to unlink. */
  phraseId: string;
  /** Setter for `phraseMode`; used to return to view mode on cancel or confirm. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
}>;

/**
 * Renders an inline confirmation prompt when the user clicks "Unlink phrase". Confirms by
 * dispatching `deletePhrase` and returning to view mode; cancels by returning to view mode without
 * dispatching.
 *
 * @param props - Component props
 * @param props.phraseId - ID of the phrase to delete on confirmation
 * @param props.setPhraseMode - Setter used to exit confirm-unlink mode
 * @returns An inline row containing a label and Confirm / Cancel buttons
 */
export default function UnlinkPhraseConfirm({ phraseId, setPhraseMode }: UnlinkPhraseConfirmProps) {
  const { deletePhrase } = usePhraseDispatch();

  const handleConfirm = () => {
    deletePhrase(phraseId);
    setPhraseMode({ kind: 'view' });
  };

  const handleCancel = () => {
    setPhraseMode({ kind: 'view' });
  };

  return (
    <div
      className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded tw:border tw:border-border tw:bg-background tw:px-2 tw:py-1 tw:text-sm tw:text-foreground tw:shadow"
      data-testid="unlink-confirm"
    >
      <span>Unlink this phrase?</span>
      <button
        className="tw:rounded tw:border tw:border-destructive tw:bg-destructive tw:px-2 tw:py-0.5 tw:text-destructive-foreground tw:hover:opacity-90"
        data-testid="unlink-confirm-yes"
        onClick={handleConfirm}
        type="button"
      >
        Unlink
      </button>
      <button
        className="tw:rounded tw:border tw:border-border tw:bg-muted tw:px-2 tw:py-0.5 tw:text-foreground tw:hover:bg-muted/80"
        data-testid="unlink-confirm-cancel"
        onClick={handleCancel}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}
