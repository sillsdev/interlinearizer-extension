import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import type { LanguageTextCounts } from '../../utils/text-counts';
import { describeTextCounts, LANGUAGE_TEXT_COUNTS_STRING_KEYS } from './language-text-counts';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const CHANGE_LANGUAGE_CONFIRM_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_confirm_changeLanguage_title%',
  '%interlinearizer_confirm_changeLanguage_existing%',
  '%interlinearizer_confirm_changeLanguage_body%',
  '%interlinearizer_confirm_changeLanguage_ok%',
  '%interlinearizer_confirm_changeLanguage_cancel%',
  ...LANGUAGE_TEXT_COUNTS_STRING_KEYS,
];

/**
 * Warns that changing an analysis language's code to one that already has glosses or free
 * translations merges the two, and asks whether to go ahead.
 *
 * @param props.from - The code being changed.
 * @param props.to - The code it changes to.
 * @param props.toCounts - How many glosses and free translations `to` already has.
 * @param props.onConfirm - Called to change the code.
 * @param props.onCancel - Called to leave it as it is.
 * @returns The confirmation overlay, or nothing while localized strings are loading.
 */
export function ChangeLanguageConfirm({
  from,
  to,
  toCounts,
  onConfirm,
  onCancel,
}: Readonly<{
  from: string;
  to: string;
  toCounts: LanguageTextCounts;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    CHANGE_LANGUAGE_CONFIRM_STRING_KEYS,
  );

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const replacers = { from, to, counts: describeTextCounts(toCounts, localizedStrings) };

  return (
    <ModalShell
      titleTestId="change-language-modal-title"
      title={formatReplacementString(
        localizedStrings['%interlinearizer_confirm_changeLanguage_title%'],
        replacers,
      )}
      width="tw:w-96"
      onClose={onCancel}
    >
      <p className="tw:text-sm tw:mb-2">
        {formatReplacementString(
          localizedStrings['%interlinearizer_confirm_changeLanguage_existing%'],
          replacers,
        )}
      </p>
      <p className="tw:text-sm tw:mb-2">
        {formatReplacementString(
          localizedStrings['%interlinearizer_confirm_changeLanguage_body%'],
          replacers,
        )}
      </p>
      <div className="tw:modal-actions tw:mt-4">
        <Button variant="secondary" onClick={onCancel}>
          {localizedStrings['%interlinearizer_confirm_changeLanguage_cancel%']}
        </Button>
        <Button onClick={onConfirm} data-testid="change-language-confirm">
          {localizedStrings['%interlinearizer_confirm_changeLanguage_ok%']}
        </Button>
      </div>
    </ModalShell>
  );
}
