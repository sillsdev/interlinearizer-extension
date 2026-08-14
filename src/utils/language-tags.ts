/**
 * Parses a comma-separated analysis-language field into BCP 47 tags. The single source of this
 * parse, so no field can interpret the same input differently.
 *
 * Applies no fallback when the result is empty — treating an empty list (defaulting it to
 * `['und']`, or blocking submission) is the caller's decision.
 *
 * @returns The trimmed, non-empty tags in input order; an empty array when the field is blank.
 */
export function parseLanguageTags(input: string): string[] {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * A collator for `tag`, falling back to the host's default collation when `Intl` rejects it.
 *
 * Language tags reach this as free text — nothing checks them for BCP 47 structure on the way in —
 * and `Intl` throws on one it cannot parse, so an unusable tag has to degrade to some ordering
 * rather than throw.
 */
export function collatorForTag(tag: string): Intl.Collator {
  try {
    return new Intl.Collator(tag);
  } catch {
    return new Intl.Collator();
  }
}
