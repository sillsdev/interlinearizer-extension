/**
 * Returns `defaultName` when none of `takenNames` matches it. Otherwise returns the first of
 * `numbered(2)`, `numbered(3)`, and so on that none matches.
 */
export function uniqueDefaultName(
  takenNames: ReadonlySet<string | undefined>,
  defaultName: string,
  numbered: (number: number) => string,
): string {
  let candidate = defaultName;
  for (let number = 2; takenNames.has(candidate); number += 1) candidate = numbered(number);
  return candidate;
}
