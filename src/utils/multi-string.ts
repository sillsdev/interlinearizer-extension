/** @file Helpers for working with `MultiString` (BCP 47 tag → string) values. */

import type { MultiString } from 'interlinearizer';

/**
 * Reports whether a `MultiString` carries no usable text, so callers deciding whether an analysis
 * record is worth keeping can treat "absent", "no entries", and "only whitespace entries" the same.
 * A `MultiString` counts as empty when it is `undefined`, has no entries, or every entry is blank
 * once trimmed.
 *
 * @param value - The `MultiString` to inspect, or `undefined`.
 * @returns `true` when the value holds no non-whitespace text.
 */
export function isEmptyMultiString(value: MultiString | undefined): boolean {
  return !value || Object.values(value).every((entry) => entry.trim() === '');
}
