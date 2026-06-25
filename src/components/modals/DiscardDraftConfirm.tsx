import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { ModalShell } from './ModalShell';

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
 * @param props.isSubmitting - When `true`, both buttons are disabled to prevent interaction while
 *   the caller is processing the confirmed action.
 * @param props.onCancel - Called when the user backs out, leaving the draft untouched.
 * @param props.onConfirm - Called when the user accepts discarding the draft's unsaved changes.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function DiscardDraftConfirm({
  isSubmitting = false,
  onConfirm,
  onCancel,
}: Readonly<{
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(DISCARD_DRAFT_CONFIRM_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleId="discard-draft-modal-title"
      title={localizedStrings['%interlinearizer_confirm_discard_title%']}
      width="tw:w-96"
    >
      <p className="tw:text-sm tw:mb-4">
        {localizedStrings['%interlinearizer_confirm_discard_body%']}
      </p>
      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          {localizedStrings['%interlinearizer_confirm_discard_cancel%']}
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          data-testid="discard-draft-confirm"
          disabled={isSubmitting}
        >
          {localizedStrings['%interlinearizer_confirm_discard_ok%']}
        </Button>
      </div>
    </ModalShell>
  );
}
