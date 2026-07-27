/** @file Confirmation controls shown in the confirm bar for unlinking (deleting) a phrase. */
import { Button } from 'platform-bible-react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseMode } from '../../types/phrase-mode';
import { usePhraseDispatch } from '../AnalysisStore';

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
 * @returns A label and Confirm / Cancel buttons laid out inline; the host bar supplies the
 *   surrounding container chrome.
 */
export default function UnlinkPhraseConfirm({ phraseId, setPhraseMode }: UnlinkPhraseConfirmProps) {
  const { deletePhrase } = usePhraseDispatch();

  /**
   * Dispatches `deletePhrase` to remove the phrase analysis and its link, then returns to view
   * mode.
   */
  const handleConfirm = () => {
    deletePhrase(phraseId);
    setPhraseMode({ kind: 'view' });
  };

  /** Returns to view mode without deleting the phrase. */
  const handleCancel = () => {
    setPhraseMode({ kind: 'view' });
  };

  return (
    <div className="tw:confirm-controls" data-testid="unlink-confirm">
      <span>Unlink this phrase?</span>
      <Button
        data-testid="unlink-confirm-yes"
        onClick={handleConfirm}
        size="sm"
        type="button"
        variant="destructive"
      >
        Unlink
      </Button>
      <Button
        data-testid="unlink-confirm-cancel"
        onClick={handleCancel}
        size="sm"
        type="button"
        variant="secondary"
      >
        Cancel
      </Button>
    </div>
  );
}
