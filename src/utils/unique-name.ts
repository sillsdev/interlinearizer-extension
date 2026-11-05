import { formatReplacementString } from 'platform-bible-utils';

/**
 * Returns `defaultTemplate` filled with `replacements` when no name in `takenNames` matches it.
 * Otherwise returns the first fill of `numberedTemplate` that no name matches, counting `{number}`
 * up from 2.
 */
export function uniqueDefaultName(
  takenNames: Iterable<string | undefined>,
  defaultTemplate: string,
  numberedTemplate: string,
  replacements: Record<string, string> = {},
): string {
  const taken = new Set(takenNames);
  let candidate = formatReplacementString(defaultTemplate, replacements);
  for (let number = 2; taken.has(candidate); number += 1)
    candidate = formatReplacementString(numberedTemplate, { ...replacements, number });
  return candidate;
}
