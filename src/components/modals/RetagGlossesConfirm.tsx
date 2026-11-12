import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const RETAG_GLOSSES_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_retag_title%',
  '%interlinearizer_confirm_retag_body_listed%',
  '%interlinearizer_confirm_retag_body_removed%',
  '%interlinearizer_confirm_retag_noUndo%',
  '%interlinearizer_confirm_retag_ok%',
  '%interlinearizer_confirm_retag_cancel%',
];

/**
 * Asks whether to move the glosses written under a project's old primary analysis language to its
 * new primary language.
 *
 * @param props.from - BCP 47 tag of the old primary language.
 * @param props.to - BCP 47 tag of the new primary language.
 * @param props.fromRemoved - Whether `from` is no longer one of the project's analysis languages,
 *   so its glosses would not show at all.
 * @param props.undoable - Whether the move can be undone, which it can only in the open draft.
 * @param props.isSubmitting - When `true`, both buttons are disabled while the caller runs the
 *   choice.
 * @param props.onConfirm - Called to move the glosses.
 * @param props.onCancel - Called to leave them where they are.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function RetagGlossesConfirm({
  from,
  to,
  fromRemoved,
  undoable,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: Readonly<{
  from: string;
  to: string;
  fromRemoved: boolean;
  undoable: boolean;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(RETAG_GLOSSES_CONFIRM_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const tags = { from, to };
  const body =
    localizedStrings[
      fromRemoved
        ? '%interlinearizer_confirm_retag_body_removed%'
        : '%interlinearizer_confirm_retag_body_listed%'
    ];

  return (
    <ModalShell
      titleTestId="retag-glosses-modal-title"
      title={formatReplacementString(
        localizedStrings['%interlinearizer_confirm_retag_title%'],
        tags,
      )}
      width="tw:w-96"
      onClose={isSubmitting ? undefined : onCancel}
    >
      <p className="tw:text-sm tw:mb-2">{formatReplacementString(body, tags)}</p>
      {!undoable && (
        <p className="tw:text-sm tw:mb-2" data-testid="retag-glosses-no-undo">
          {localizedStrings['%interlinearizer_confirm_retag_noUndo%']}
        </p>
      )}
      <div className="tw:modal-actions tw:mt-4">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          {formatReplacementString(
            localizedStrings['%interlinearizer_confirm_retag_cancel%'],
            tags,
          )}
        </Button>
        <Button onClick={onConfirm} data-testid="retag-glosses-confirm" disabled={isSubmitting}>
          {formatReplacementString(localizedStrings['%interlinearizer_confirm_retag_ok%'], tags)}
        </Button>
      </div>
    </ModalShell>
  );
}
