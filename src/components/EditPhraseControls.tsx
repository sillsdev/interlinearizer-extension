/** @file Done/Cancel overlay shown while editing a phrase. */
import type { Dispatch, SetStateAction } from 'react';
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
 * @param props - Component props
 * @param props.phraseMode - The current edit-mode phrase mode value
 * @param props.setPhraseMode - Setter used to commit or revert the edit
 * @returns An inline row containing Done / Cancel buttons
 */
export default function EditPhraseControls({ phraseMode, setPhraseMode }: EditPhraseControlsProps) {
  return (
    <div className="tw:overlay-pill" data-testid="edit-phrase-controls">
      <button
        className="tw:pill-btn-primary"
        data-testid="done-edit-btn"
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
