import type { MultiString } from 'interlinearizer';

/**
 * Reports whether a {@link MultiString} carries no usable text, so callers deciding whether an
 * analysis record is worth keeping can treat "absent", "no entries", and "only whitespace entries"
 * alike.
 */
export function isEmptyMultiString(value: MultiString | undefined): boolean {
  return !value || Object.values(value).every((entry) => entry.trim() === '');
}

/**
 * Reads the text a {@link MultiString} holds under `tag`.
 *
 * @returns The entry, or `''` when there is none or it is only whitespace.
 */
export function multiStringText(value: MultiString | undefined, tag: string): string {
  const text = value?.[tag] ?? '';
  return text.trim() === '' ? '' : text;
}

/** The primary language subtag of a BCP 47 tag, lowercased: `en` for `en-US`. */
function primarySubtag(tag: string): string {
  return tag.split('-', 1)[0].toLowerCase();
}

/**
 * Reads the text a {@link MultiString} holds in the language `tag` names. Text under `tag` itself
 * comes first; where there is none, text under a tag of the same primary language subtag stands in
 * for it, the bare subtag before any other. That lets a lexicon keyed by its own writing systems
 * (`en`) answer a project that names its language more narrowly (`en-US`), or the other way round.
 *
 * @returns The entry, or `''` when there is none in that language or it is only whitespace.
 */
export function multiStringTextByLanguage(value: MultiString | undefined, tag: string): string {
  const exact = multiStringText(value, tag);
  if (exact !== '' || !value) return exact;
  const primary = primarySubtag(tag);
  const bare = Object.keys(value).find((key) => key.toLowerCase() === primary);
  if (bare !== undefined && multiStringText(value, bare) !== '') return value[bare];
  const related = Object.keys(value).find(
    (key) => primarySubtag(key) === primary && multiStringText(value, key) !== '',
  );
  return related === undefined ? '' : value[related];
}
