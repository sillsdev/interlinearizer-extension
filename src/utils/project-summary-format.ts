import { formatReplacementString } from 'platform-bible-utils';

/**
 * Parses an ISO 8601 timestamp to epoch milliseconds, treating an unparsable string as `0`.
 *
 * The summary type guard only checks that `updatedAt` is a string, so a corrupted value could
 * otherwise yield `NaN` and leave the sort comparator's result undefined. Normalizing to `0` keeps
 * ordering deterministic, with corrupted entries sorting last.
 */
export function parseUpdatedAt(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Compares two ISO 8601 timestamps newest-first. Ordering is locale-independent, unlike
 * `localeCompare`, whose result can vary by collator.
 *
 * @returns A negative number when `a` is newer than `b` (sorts first), positive when older, `0`
 *   when the two timestamps are equal.
 */
export function compareUpdatedAtDescending(a: string, b: string): number {
  return parseUpdatedAt(b) - parseUpdatedAt(a);
}

/** How many book codes a project row lists before the rest collapse into a count. */
const BOOKS_TOUCHED_CAP = 3;

/**
 * Formats the book codes a project covers, listing them in the given order and collapsing those
 * past {@link BOOKS_TOUCHED_CAP} into a count so a project spanning many books cannot outgrow its
 * row, e.g. `"GEN, EXO, LEV +2 more"`.
 *
 * @param books - Book codes to list, in the order they should appear.
 * @param moreTemplate - Localized `"+{count} more"` template, formatted with the number omitted.
 */
export function formatBooksTouched(books: string[], moreTemplate: string): string {
  const shown = books.slice(0, BOOKS_TOUCHED_CAP).join(', ');
  const remaining = books.length - BOOKS_TOUCHED_CAP;
  if (remaining <= 0) return shown;
  return `${shown} ${formatReplacementString(moreTemplate, { count: remaining })}`;
}

/**
 * Formats the modified-date subline for a project row, e.g. `"Modified Jan 1, 2026, 12:00 PM"`.
 *
 * @param prefix - Localized `"Modified"` label to precede the date.
 * @param updatedAt - ISO 8601 timestamp, rendered in the user's locale.
 */
export function formatModified(prefix: string, updatedAt: string): string {
  return `${prefix} ${new Date(updatedAt).toLocaleString()}`;
}
