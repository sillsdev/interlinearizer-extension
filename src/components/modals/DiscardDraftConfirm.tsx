import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';

/** Localized string keys used by {@link DiscardDraftConfirm}. */
const DISCARD_DRAFT_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_discard_title%',
  '%interlinearizer_confirm_discard_body%',
  '%interlinearizer_confirm_discard_ok%',
  '%interlinearizer_confirm_discard_cancel%',
];

/**
 * Confirmation dialog shown before an action that would replace the current draft (New or Open)
 * when the draft has unsaved changes. Confirming discards the draft's unsaved work; canceling
 * returns to the previous dialog.
 *
 * @param props - Component props
 * @param props.onConfirm - Called when the user accepts discarding the draft's unsaved changes.
 * @param props.onCancel - Called when the user backs out, leaving the draft untouched.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function DiscardDraftConfirm({
  onConfirm,
  onCancel,
}: Readonly<{
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(DISCARD_DRAFT_CONFIRM_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <div className="tw:modal-overlay">
      <dialog
        aria-labelledby="discard-draft-modal-title"
        aria-modal="true"
        className="tw:modal-dialog tw:rounded tw:w-96"
        open
      >
        <h2 id="discard-draft-modal-title" className="tw:modal-title">
          {localizedStrings['%interlinearizer_confirm_discard_title%']}
        </h2>
        <p className="tw:text-sm tw:mb-4">
          {localizedStrings['%interlinearizer_confirm_discard_body%']}
        </p>
        <div className="tw:flex tw:gap-2 tw:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {localizedStrings['%interlinearizer_confirm_discard_cancel%']}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="discard-draft-confirm">
            {localizedStrings['%interlinearizer_confirm_discard_ok%']}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
