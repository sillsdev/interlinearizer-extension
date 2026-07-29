/**
 * Parses a comma-separated analysis-language field into BCP 47 tags. The single source of this
 * parse, shared by the create and metadata modals so the two cannot drift.
 *
 * Applies no fallback when the result is empty — each modal decides how to treat an empty list (for
 * instance defaulting to `['und']`, or disabling Save).
 *
 * @returns The trimmed, non-empty tags in input order; an empty array when the field is blank.
 */
export function parseLanguageTags(input: string): string[] {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
