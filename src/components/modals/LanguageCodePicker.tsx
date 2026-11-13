import { useLocalizedStrings } from '@papi/frontend/react';
import { Button, Input, Label } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import { useState } from 'react';
import { readLanguageCode } from '../../utils/language-tags';
import type { TextCountsByTag } from '../../utils/text-counts';
import {
  describeTextCounts,
  hasText,
  LANGUAGE_TEXT_COUNTS_STRING_KEYS,
} from './language-text-counts';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const LANGUAGE_CODE_PICKER_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_languagePicker_addTitle%',
  '%interlinearizer_languagePicker_changeTitle%',
  '%interlinearizer_languagePicker_codeLabel%',
  '%interlinearizer_languagePicker_placeholder%',
  '%interlinearizer_languagePicker_invalid%',
  '%interlinearizer_languagePicker_listed%',
  '%interlinearizer_languagePicker_hiddenHeading%',
  '%interlinearizer_languagePicker_hiddenItem%',
  '%interlinearizer_languagePicker_add%',
  '%interlinearizer_languagePicker_change%',
  '%interlinearizer_languagePicker_cancel%',
  ...LANGUAGE_TEXT_COUNTS_STRING_KEYS,
];

/**
 * Asks for a language code, either to add as an analysis language or to change one to. Codes that
 * aren't analysis languages but still have glosses or free translations are offered, with their
 * counts, so the user can bring that text back or see what a change would merge with.
 *
 * Adding refuses a code already listed. Changing to a listed code merges the two.
 *
 * @param props.changing - The code being changed, or absent to add one.
 * @param props.languages - The analysis languages, primary first.
 * @param props.textCounts - Glosses and free translations of every code that has any.
 * @param props.onSubmit - Called with the chosen code.
 * @param props.onCancel - Called to choose none.
 * @param props.returnFocusTo - Element to focus once the picker closes.
 * @returns The picker overlay, or nothing while localized strings are loading.
 */
export function LanguageCodePicker({
  changing,
  languages,
  textCounts,
  onSubmit,
  onCancel,
  returnFocusTo,
}: Readonly<{
  changing?: string;
  languages: readonly string[];
  textCounts: TextCountsByTag;
  onSubmit: (tag: string) => void;
  onCancel: () => void;
  returnFocusTo?: HTMLElement;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(LANGUAGE_CODE_PICKER_STRING_KEYS);
  const [input, setInput] = useState('');

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const hiddenTags = Object.keys(textCounts)
    .filter((tag) => !languages.includes(tag) && hasText(textCounts[tag]))
    .sort();
  const tag = readLanguageCode(input, [...languages, ...hiddenTags]);
  let error: string | undefined;
  if (input.trim() !== '' && tag === undefined)
    error = formatReplacementString(localizedStrings['%interlinearizer_languagePicker_invalid%'], {
      tag: input.trim(),
    });
  else if (changing === undefined && tag !== undefined && languages.includes(tag))
    error = formatReplacementString(localizedStrings['%interlinearizer_languagePicker_listed%'], {
      tag,
    });
  const canSubmit = tag !== undefined && error === undefined && tag !== changing;

  const submit = () => {
    if (canSubmit) onSubmit(tag);
  };

  return (
    <ModalShell
      titleTestId="language-code-picker-title"
      title={
        changing === undefined
          ? localizedStrings['%interlinearizer_languagePicker_addTitle%']
          : formatReplacementString(
              localizedStrings['%interlinearizer_languagePicker_changeTitle%'],
              { tag: changing },
            )
      }
      width="tw:w-80"
      onClose={onCancel}
      returnFocusTo={returnFocusTo}
    >
      {/* No <form>: the WebView's sandbox blocks form submission before its submit event fires. */}
      <div className="tw:flex tw:flex-col tw:gap-3">
        <div className="tw:flex tw:flex-col tw:gap-1">
          <Label className="tw:section-label" htmlFor="language-code-picker-input">
            {localizedStrings['%interlinearizer_languagePicker_codeLabel%']}
          </Label>
          <Input
            id="language-code-picker-input"
            className="tw:modal-metadata-input tw:font-mono"
            value={input}
            placeholder={localizedStrings['%interlinearizer_languagePicker_placeholder%']}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : 'language-code-picker-error'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {error !== undefined && (
            <p id="language-code-picker-error" className="tw:text-xs tw:text-destructive">
              {error}
            </p>
          )}
        </div>

        {hiddenTags.length > 0 && (
          <div className="tw:flex tw:flex-col tw:gap-1">
            <span className="tw:section-label" id="language-code-picker-hidden">
              {localizedStrings['%interlinearizer_languagePicker_hiddenHeading%']}
            </span>
            <ul aria-labelledby="language-code-picker-hidden" className="tw:flex tw:flex-col">
              {hiddenTags.map((hiddenTag) => (
                <li key={hiddenTag}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="tw:w-full tw:justify-start tw:font-normal"
                    onClick={() => setInput(hiddenTag)}
                  >
                    {formatReplacementString(
                      localizedStrings['%interlinearizer_languagePicker_hiddenItem%'],
                      {
                        tag: hiddenTag,
                        counts: describeTextCounts(textCounts[hiddenTag], localizedStrings),
                      },
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="tw:modal-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {localizedStrings['%interlinearizer_languagePicker_cancel%']}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="language-code-picker-submit"
          >
            {changing === undefined
              ? localizedStrings['%interlinearizer_languagePicker_add%']
              : localizedStrings['%interlinearizer_languagePicker_change%']}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
