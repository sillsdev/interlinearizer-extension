import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { LanguageTextCounts } from '../../utils/text-counts';

/** Localized string keys {@link describeTextCounts} formats. */
export const LANGUAGE_TEXT_COUNTS_STRING_KEYS = [
  '%interlinearizer_languageText_glosses%',
  '%interlinearizer_languageText_freeTranslations%',
  '%interlinearizer_languageText_both%',
] as const satisfies `%${string}%`[];

/** Whether a language has any glosses or free translations. */
export function hasText(counts: LanguageTextCounts | undefined): counts is LanguageTextCounts {
  return !!counts && counts.glosses + counts.freeTranslations > 0;
}

/** How many glosses and free translations a language has, naming only the kinds it has. */
export function describeTextCounts(
  counts: LanguageTextCounts,
  localizedStrings: LanguageStrings,
): string {
  let key: (typeof LANGUAGE_TEXT_COUNTS_STRING_KEYS)[number] =
    '%interlinearizer_languageText_both%';
  if (counts.freeTranslations === 0) key = '%interlinearizer_languageText_glosses%';
  else if (counts.glosses === 0) key = '%interlinearizer_languageText_freeTranslations%';
  return formatReplacementString(localizedStrings[key], { ...counts });
}
