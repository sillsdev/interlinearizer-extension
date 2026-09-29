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
