/** @file Done/Cancel controls shown in the confirm bar while editing a phrase. */
import type { Dispatch, SetStateAction } from 'react';
import { usePhraseLinkByIdMap } from './AnalysisStore';
import type { PhraseMode } from '../types/phrase-mode';

/** Props for {@link EditPhraseControls}. */
type EditPhraseControlsProps = Readonly<{
  /** The current edit-mode phrase mode value. */
  phraseMode: Extract<PhraseMode, { kind: 'edit' }>;
  /** Setter for `phraseMode`; used to commit (view) or revert (revert flag) the edit. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
}>;

/**
 * Renders Done / Cancel buttons for an in-progress phrase edit. Done returns to view mode keeping
 * the edited token list; Cancel sets the `revert` flag which causes the matching `PhraseBox` to
 * restore the phrase's `originalTokens` and return to view mode.
 *
 * A phrase must contain at least two tokens to be meaningful, but edit mode deliberately allows the
 * list to drop to a single token so the user can remove one token and add another (a swap). To
 * prevent a 1-token phrase from being committed, Done is disabled while the live phrase has fewer
 * than two tokens; the user can still Cancel to revert to `originalTokens`.
 *
 * @param props - Component props
 * @param props.phraseMode - The current edit-mode phrase mode value
 * @param props.setPhraseMode - Setter used to commit or revert the edit
 * @returns Done / Cancel buttons laid out inline; the host bar supplies the surrounding container
 *   chrome.
 */
export default function EditPhraseControls({ phraseMode, setPhraseMode }: EditPhraseControlsProps) {
  const phraseLinkById = usePhraseLinkByIdMap();
  const liveTokenCount = phraseLinkById.get(phraseMode.phraseId)?.tokens.length ?? 0;

  return (
    <div className="tw:confirm-controls" data-testid="edit-phrase-controls">
      <span>Editing Phrase</span>
      <button
        className="tw:pill-btn-primary"
        data-testid="done-edit-btn"
        disabled={liveTokenCount < 2}
        onClick={() => setPhraseMode({ kind: 'view' })}
        type="button"
      >
        Done
      </button>
      <button
        className="tw:pill-btn-secondary"
        data-testid="cancel-phrase-btn"
        onClick={() => setPhraseMode({ ...phraseMode, revert: true })}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}
