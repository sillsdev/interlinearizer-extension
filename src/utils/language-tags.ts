/** @file Shared parsing for the comma-separated BCP 47 analysis-language inputs in the modals. */

/**
 * Parses a comma-separated analysis-language field into BCP 47 tags: splits on commas, trims each
 * entry, and drops empty entries. The single source of this parse, shared by the create and
 * metadata modals so they cannot drift. Does not apply any fallback when the result is empty — each
 * modal decides how to treat an empty list (e.g. defaulting to `['und']` or disabling Save).
 *
 * @param input - The raw comma-separated language field value.
 * @returns The trimmed, non-empty tags in input order; an empty array when the field is blank.
 */
export function parseLanguageTags(input: string): string[] {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
