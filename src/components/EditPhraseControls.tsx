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
    <div
      className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded tw:border tw:border-border tw:bg-background tw:px-2 tw:py-1 tw:text-sm tw:text-foreground tw:shadow"
      data-testid="edit-phrase-controls"
    >
      <button
        className="tw:rounded tw:border tw:border-ring tw:bg-ring tw:px-2 tw:py-0.5 tw:text-background tw:hover:opacity-90"
        data-testid="done-edit-btn"
        onClick={() => setPhraseMode({ kind: 'view' })}
        type="button"
      >
        Done
      </button>
      <button
        className="tw:rounded tw:border tw:border-border tw:bg-muted tw:px-2 tw:py-0.5 tw:text-foreground tw:hover:bg-muted/80"
        data-testid="cancel-phrase-btn"
        onClick={() => setPhraseMode({ ...phraseMode, revert: true })}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}
