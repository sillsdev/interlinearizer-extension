import { Collator } from 'platform-bible-utils';

/**
 * Parses a comma-separated analysis-language field into BCP 47 tags. The single source of this
 * parse, so no field can interpret the same input differently.
 *
 * Applies no fallback when the result is empty — treating an empty list (defaulting it to
 * `['und']`, or blocking submission) is the caller's decision.
 *
 * @returns The trimmed, non-empty tags in input order, each kept at its first appearance; an empty
 *   array when the field is blank.
 */
export function parseLanguageTags(input: string): string[] {
  const tags = input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
}

/**
 * A collator for `tag`, falling back to the host's default collation when the tag is unusable.
 *
 * Language tags reach this as free text — nothing checks them for BCP 47 structure on the way in —
 * and constructing a collator for an unparsable tag throws, so it has to degrade to some ordering
 * rather than take the view down.
 */
export function collatorForTag(tag: string): Collator {
  try {
    return new Collator(tag);
  } catch {
    return new Collator();
  }
}

/**
 * Names languages in the most preferred of `locales` the host can use, falling back to the host's
 * own locale where it can use none of them.
 */
function languageNamer(locales: readonly string[] | undefined): Intl.DisplayNames {
  const usable = locales?.filter((locale) => {
    try {
      Intl.getCanonicalLocales(locale);
      return true;
    } catch {
      return false;
    }
  });
  return new Intl.DisplayNames(usable?.length ? usable : undefined, { type: 'language' });
}

/**
 * What a language is called, for prose that names a language rather than referring to it by code.
 *
 * Falls back to the tag itself, which is both what the host reports for a tag naming no language it
 * knows and the only thing left to show for one it cannot parse at all — language tags reach this
 * as free text, and naming an unparsable one throws.
 *
 * @param tag - BCP 47 tag of the language to name.
 * @param locales - Interface languages to name it in, most preferred first. Omitted where there is
 *   nothing but the host's own locale to go on, which the platform's interface language does not
 *   follow.
 */
export function languageNameForTag(tag: string, locales?: readonly string[]): string {
  try {
    /* v8 ignore next -- `of` reports an unknown language as the tag itself, never as nothing */
    return languageNamer(locales).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Reads a language code typed by the user. A code that matches one of `knownTags`, apart from case
 * or canonical form, is read as that known tag. Text already written under the known tag then stays
 * reachable, even when the tag isn't well formed. Any other code is read in its canonical form.
 *
 * @returns The tag, or `undefined` when the input is blank, or is neither a known tag nor a
 *   well-formed BCP 47 tag.
 */
export function readLanguageCode(input: string, knownTags: readonly string[]): string | undefined {
  const typed = input.trim();
  if (typed === '') return undefined;
  const known = knownTags.find((tag) => tag.toLowerCase() === typed.toLowerCase());
  if (known !== undefined) return known;
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(typed);
  } catch {
    return undefined;
  }
  /* v8 ignore next -- a well-formed tag always has a canonical form */
  if (canonical === undefined) return undefined;
  const lowered = canonical.toLowerCase();
  return knownTags.find((tag) => tag.toLowerCase() === lowered) ?? canonical;
}
