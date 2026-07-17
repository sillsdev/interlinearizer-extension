/**
 * @file Shared formatting and sorting helpers for interlinear project summaries, used by the
 *   project-selection and Save As modals so both lists order and label projects identically.
 */

/**
 * Parses an ISO 8601 timestamp to epoch milliseconds, treating an unparsable string as `0`. The
 * summary type guard only checks that `updatedAt` is a string, so a corrupted value could otherwise
 * yield `NaN` and make the sort comparator's result undefined; normalizing to `0` keeps ordering
 * deterministic (corrupted entries sort last).
 *
 * @param value - The timestamp string to parse.
 * @returns The parsed epoch milliseconds, or `0` when `value` is not a valid date.
 */
export function parseUpdatedAt(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Compares two ISO 8601 timestamps for a descending (newest-first) sort by their parsed epoch
 * milliseconds, so ordering is locale-independent (unlike `localeCompare`, whose result can vary by
 * collator).
 *
 * @param a - The first ISO 8601 timestamp.
 * @param b - The second ISO 8601 timestamp.
 * @returns A negative number when `a` is newer than `b` (sorts first), positive when older, `0`
 *   when the two timestamps are equal.
 */
export function compareUpdatedAtDescending(a: string, b: string): number {
  return parseUpdatedAt(b) - parseUpdatedAt(a);
}

/**
 * Formats the modified-date subline for a project row, e.g. `"Modified Jan 1, 2026, 12:00 PM"`. The
 * prefix is a localized label; the timestamp is rendered in the user's locale via
 * `toLocaleString`.
 *
 * @param prefix - Localized `"Modified"` label to precede the date.
 * @param updatedAt - ISO 8601 modification timestamp.
 * @returns The prefix followed by the locale-formatted timestamp.
 */
export function formatModified(prefix: string, updatedAt: string): string {
  return `${prefix} ${new Date(updatedAt).toLocaleString()}`;
}
