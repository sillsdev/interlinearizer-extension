import type { MultiString, TextAnalysis } from 'interlinearizer';

/** Number of glosses written under each of a set of language tags, keyed by tag. */
export type GlossCountsByTag = Record<string, number>;

/** Whether `value` is a {@link GlossCountsByTag}. */
export function isGlossCountsByTag(value: unknown): value is GlossCountsByTag {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((count) => typeof count === 'number')
  );
}

/**
 * Counts the word, phrase, and morpheme glosses of `analysis` written under each of `tags`. Blank
 * glosses don't count.
 *
 * @returns A count for every tag in `tags`, zero included.
 */
export function countGlossesByTag(
  analysis: TextAnalysis,
  tags: readonly string[],
): GlossCountsByTag {
  const counts: GlossCountsByTag = Object.fromEntries(tags.map((tag) => [tag, 0]));
  const tally = (gloss: MultiString | undefined) => {
    tags.forEach((tag) => {
      if ((gloss?.[tag] ?? '').trim() !== '') counts[tag] += 1;
    });
  };
  analysis.tokenAnalyses.forEach(({ gloss, morphemes }) => {
    tally(gloss);
    morphemes?.forEach((morpheme) => tally(morpheme.gloss));
  });
  analysis.phraseAnalyses.forEach(({ gloss }) => tally(gloss));
  return counts;
}
