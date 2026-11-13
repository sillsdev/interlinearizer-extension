import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import type { LanguageTextCounts } from '../../utils/text-counts';
import { describeTextCounts, LANGUAGE_TEXT_COUNTS_STRING_KEYS } from './language-text-counts';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const REMOVE_LANGUAGE_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_removeLanguage_title%',
  '%interlinearizer_confirm_removeLanguage_existing%',
  '%interlinearizer_confirm_removeLanguage_body%',
  '%interlinearizer_confirm_removeLanguage_keep%',
  '%interlinearizer_confirm_removeLanguage_delete%',
  '%interlinearizer_confirm_removeLanguage_cancel%',
  ...LANGUAGE_TEXT_COUNTS_STRING_KEYS,
];

/**
 * Asks what becomes of an analysis language's glosses and free translations when it is removed:
 * kept hidden in the project, or deleted.
 *
 * @param props.tag - The code being removed.
 * @param props.counts - How many glosses and free translations it has.
 * @param props.onKeep - Called to remove the language and keep its text hidden.
 * @param props.onDelete - Called to remove the language and delete its text.
 * @param props.onCancel - Called to keep the language.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function RemoveLanguageConfirm({
  tag,
  counts,
  onKeep,
  onDelete,
  onCancel,
}: Readonly<{
  tag: string;
  counts: LanguageTextCounts;
  onKeep: () => void;
  onDelete: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    REMOVE_LANGUAGE_CONFIRM_STRING_KEYS,
  );

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const replacers = { tag, counts: describeTextCounts(counts, localizedStrings) };

  return (
    <ModalShell
      titleTestId="remove-language-modal-title"
      title={formatReplacementString(
        localizedStrings['%interlinearizer_confirm_removeLanguage_title%'],
        replacers,
      )}
      width="tw:w-96"
      onClose={onCancel}
    >
      <p className="tw:text-sm tw:mb-2">
        {formatReplacementString(
          localizedStrings['%interlinearizer_confirm_removeLanguage_existing%'],
          replacers,
        )}
      </p>
      <p className="tw:text-sm tw:mb-2">
        {formatReplacementString(
          localizedStrings['%interlinearizer_confirm_removeLanguage_body%'],
          replacers,
        )}
      </p>
      <div className="tw:modal-actions tw:mt-4">
        <Button variant="secondary" onClick={onCancel}>
          {localizedStrings['%interlinearizer_confirm_removeLanguage_cancel%']}
        </Button>
        <Button variant="destructive" onClick={onDelete} data-testid="remove-language-delete">
          {localizedStrings['%interlinearizer_confirm_removeLanguage_delete%']}
        </Button>
        <Button onClick={onKeep} data-testid="remove-language-keep">
          {localizedStrings['%interlinearizer_confirm_removeLanguage_keep%']}
        </Button>
      </div>
    </ModalShell>
  );
}
