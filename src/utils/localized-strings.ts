/** @file Helpers for working with values returned by PAPI's `useLocalizedStrings` hook. */

/**
 * Returns a localized value, or an empty string while it is still an unresolved key.
 *
 * `useLocalizedStrings` resolves asynchronously: until the lookup completes it returns the raw
 * localize key (e.g. `%interlinearizer_glossInput_placeholder%`) as the value. Rendering that
 * directly flashes the bare `%…%` key in user-visible text — most noticeable in input placeholders,
 * which paint immediately on mount/toggle. Substituting an empty string for an unresolved key
 * replaces that flash with a momentarily-empty field, which then fills in once localization
 * resolves. A resolved localized string is returned unchanged.
 *
 * @param value - A value from a `useLocalizedStrings` result record.
 * @returns The value, or `''` when it is still an unresolved `%…%` key.
 */
export function resolvedOrEmpty(value: string): string {
  return /^%.*%$/.test(value) ? '' : value;
}
