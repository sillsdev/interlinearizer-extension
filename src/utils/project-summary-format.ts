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
 */
export function compareUpdatedAtDescending(a: string, b: string): number {
  return parseUpdatedAt(b) - parseUpdatedAt(a);
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
