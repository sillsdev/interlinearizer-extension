/** @file Confirmation dialog shown before a human edit fans out across a shared analysis payload. */
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { ModalShell } from './ModalShell';

/** Localized string keys used by {@link GlobalEditConfirmationModal}. */
const GLOBAL_EDIT_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_globalEdit_title%',
  '%interlinearizer_globalEdit_body%',
  '%interlinearizer_globalEdit_updateAll%',
  '%interlinearizer_globalEdit_fork%',
  '%interlinearizer_globalEdit_cancel%',
];

/**
 * Confirmation dialog shown when a human edits a `TokenAnalysis` payload that is shared by more
 * than one token, so the user is never surprised that one edit rewrote many occurrences. It offers
 * three choices: apply the edit globally to every token sharing the payload, fork a per-instance
 * copy and edit only this token, or cancel and leave everything untouched. The modal is only ever
 * shown for `count > 1` (the caller gates on the blast radius), so the copy always reads in the
 * plural.
 *
 * @param props - Component props
 * @param props.count - How many tokens share the payload being edited; substituted into the copy.
 * @param props.onUpdateAll - Called to apply the edit to every token sharing the payload.
 * @param props.onForkInstead - Called to fork a per-instance copy and apply the edit to this token
 *   only, leaving the other tokens on the original shared payload.
 * @param props.onCancel - Called when the user backs out, leaving the analysis unchanged.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function GlobalEditConfirmationModal({
  count,
  onUpdateAll,
  onForkInstead,
  onCancel,
}: Readonly<{
  count: number;
  onUpdateAll: () => void;
  onForkInstead: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(GLOBAL_EDIT_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const countText = String(count);
  const title = localizedStrings['%interlinearizer_globalEdit_title%'].replace(
    '{count}',
    countText,
  );
  const body = localizedStrings['%interlinearizer_globalEdit_body%'].replace('{count}', countText);
  const updateAllLabel = localizedStrings['%interlinearizer_globalEdit_updateAll%'].replace(
    '{count}',
    countText,
  );

  return (
    <ModalShell titleId="global-edit-modal-title" title={title} width="tw:w-96">
      <p className="tw:text-sm tw:mb-4">{body}</p>
      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onCancel} data-testid="global-edit-cancel">
          {localizedStrings['%interlinearizer_globalEdit_cancel%']}
        </Button>
        <Button variant="secondary" onClick={onForkInstead} data-testid="global-edit-fork">
          {localizedStrings['%interlinearizer_globalEdit_fork%']}
        </Button>
        <Button variant="default" onClick={onUpdateAll} data-testid="global-edit-update-all">
          {updateAllLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
