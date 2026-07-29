import type { MultiString } from 'interlinearizer';

/**
 * Reports whether a {@link MultiString} carries no usable text, so callers deciding whether an
 * analysis record is worth keeping can treat "absent", "no entries", and "only whitespace entries"
 * alike.
 *
 * @returns `true` when the value holds no non-whitespace text.
 */
export function isEmptyMultiString(value: MultiString | undefined): boolean {
  return !value || Object.values(value).every((entry) => entry.trim() === '');
}
