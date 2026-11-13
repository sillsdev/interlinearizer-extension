import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const REMOVE_LANGUAGES_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_removeLanguages_title%',
  '%interlinearizer_confirm_removeLanguages_body%',
  '%interlinearizer_confirm_removeLanguages_count%',
  '%interlinearizer_confirm_removeLanguages_kept%',
  '%interlinearizer_confirm_removeLanguages_ok%',
  '%interlinearizer_confirm_removeLanguages_cancel%',
];

/**
 * Warns that removing analysis languages leaves the glosses written in them inaccessible, and asks
 * whether to remove them anyway.
 *
 * @param props.glossCounts - Each language being removed that has glosses, with how many it has.
 * @param props.onConfirm - Called to remove the languages.
 * @param props.onCancel - Called to go back without removing them.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function RemoveLanguagesConfirm({
  glossCounts,
  onConfirm,
  onCancel,
}: Readonly<{
  glossCounts: readonly (readonly [language: string, count: number])[];
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    REMOVE_LANGUAGES_CONFIRM_STRING_KEYS,
  );

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="remove-languages-modal-title"
      title={localizedStrings['%interlinearizer_confirm_removeLanguages_title%']}
      width="tw:w-96"
      onClose={onCancel}
    >
      <p className="tw:text-sm tw:mb-2">
        {localizedStrings['%interlinearizer_confirm_removeLanguages_body%']}
      </p>
      <ul className="tw:text-sm tw:mb-2 tw:list-disc tw:ps-5" data-testid="remove-languages-counts">
        {glossCounts.map(([language, count]) => (
          <li key={language}>
            {formatReplacementString(
              localizedStrings['%interlinearizer_confirm_removeLanguages_count%'],
              { language, count },
            )}
          </li>
        ))}
      </ul>
      <p className="tw:text-sm tw:mb-2">
        {localizedStrings['%interlinearizer_confirm_removeLanguages_kept%']}
      </p>
      <div className="tw:modal-actions tw:mt-4">
        <Button variant="secondary" onClick={onCancel}>
          {localizedStrings['%interlinearizer_confirm_removeLanguages_cancel%']}
        </Button>
        <Button variant="destructive" onClick={onConfirm} data-testid="remove-languages-confirm">
          {localizedStrings['%interlinearizer_confirm_removeLanguages_ok%']}
        </Button>
      </div>
    </ModalShell>
  );
}
