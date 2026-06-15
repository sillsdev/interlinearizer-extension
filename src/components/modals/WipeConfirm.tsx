import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';

/** Localized string keys used by {@link WipeConfirm}. */
const WIPE_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_wipe_book_title%',
  '%interlinearizer_confirm_wipe_book_body%',
  '%interlinearizer_confirm_wipe_draft_title%',
  '%interlinearizer_confirm_wipe_draft_body%',
  '%interlinearizer_confirm_wipe_ok%',
  '%interlinearizer_confirm_wipe_cancel%',
];

/**
 * Confirmation dialog for a destructive draft wipe — either the currently viewed book or the entire
 * draft, selected by {@link scope}. Confirming removes the analysis from the draft (and auto-saves
 * it); the user can then Save to persist the change to a project.
 *
 * @param props - Component props
 * @param props.scope - `'book'` to wipe the current book, `'all'` to wipe the entire draft.
 * @param props.onConfirm - Called when the user confirms the wipe.
 * @param props.onCancel - Called when the user backs out, leaving the draft untouched.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function WipeConfirm({
  scope,
  onConfirm,
  onCancel,
}: Readonly<{
  scope: 'book' | 'all';
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(WIPE_CONFIRM_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const title =
    scope === 'book'
      ? localizedStrings['%interlinearizer_confirm_wipe_book_title%']
      : localizedStrings['%interlinearizer_confirm_wipe_draft_title%'];
  const body =
    scope === 'book'
      ? localizedStrings['%interlinearizer_confirm_wipe_book_body%']
      : localizedStrings['%interlinearizer_confirm_wipe_draft_body%'];

  return (
    <div className="tw:modal-overlay">
      <dialog
        aria-labelledby="wipe-confirm-modal-title"
        aria-modal="true"
        className="tw:modal-dialog tw:rounded tw:w-96"
        open
      >
        <h2 id="wipe-confirm-modal-title" className="tw:modal-title">
          {title}
        </h2>
        <p className="tw:text-sm tw:mb-4">{body}</p>
        <div className="tw:flex tw:gap-2 tw:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {localizedStrings['%interlinearizer_confirm_wipe_cancel%']}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="wipe-confirm">
            {localizedStrings['%interlinearizer_confirm_wipe_ok%']}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
