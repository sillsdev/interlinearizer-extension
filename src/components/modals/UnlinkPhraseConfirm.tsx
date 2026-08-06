import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import type { Dispatch, SetStateAction } from 'react';
import type { PhraseMode } from '../../types/phrase-mode';
import { usePhraseDispatch } from '../AnalysisStore';

/**
 * Localized string keys this prompt needs. Hoisted to module scope so the reference passed to
 * `useLocalizedStrings` is stable across renders; a fresh array literal each render makes the PAPI
 * hook re-fetch and re-set state every render.
 */
const STRING_KEYS = [
  '%interlinearizer_unlinkPhraseConfirm_prompt%',
  '%interlinearizer_unlinkPhraseConfirm_confirm%',
  '%interlinearizer_unlinkPhraseConfirm_cancel%',
] as const satisfies `%${string}%`[];

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
 * @returns A label and Confirm / Cancel buttons laid out inline; the host bar supplies the
 *   surrounding container chrome.
 */
export default function UnlinkPhraseConfirm({ phraseId, setPhraseMode }: UnlinkPhraseConfirmProps) {
  const { deletePhrase } = usePhraseDispatch();
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);

  const handleConfirm = () => {
    deletePhrase(phraseId);
    setPhraseMode({ kind: 'view' });
  };

  const handleCancel = () => {
    setPhraseMode({ kind: 'view' });
  };

  return (
    <div className="tw:confirm-controls" data-testid="unlink-confirm">
      <span>{localizedStrings['%interlinearizer_unlinkPhraseConfirm_prompt%']}</span>
      <Button
        data-testid="unlink-confirm-yes"
        onClick={handleConfirm}
        size="sm"
        type="button"
        variant="destructive"
      >
        {localizedStrings['%interlinearizer_unlinkPhraseConfirm_confirm%']}
      </Button>
      <Button
        data-testid="unlink-confirm-cancel"
        onClick={handleCancel}
        size="sm"
        type="button"
        variant="secondary"
      >
        {localizedStrings['%interlinearizer_unlinkPhraseConfirm_cancel%']}
      </Button>
    </div>
  );
}
