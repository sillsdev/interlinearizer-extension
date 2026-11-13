import type { MultiString, TextAnalysis } from 'interlinearizer';

/** How much analysis text is written in one language. */
export type LanguageTextCounts = {
  /** Word, phrase, and morpheme glosses. */
  glosses: number;
  /** Segment free translations. */
  freeTranslations: number;
};

/** {@link LanguageTextCounts} for each of a set of language tags, keyed by tag. */
export type TextCountsByTag = Record<string, LanguageTextCounts>;

/** Whether `value` is a {@link LanguageTextCounts}. */
export function isLanguageTextCounts(value: unknown): value is LanguageTextCounts {
  return (
    !!value &&
    typeof value === 'object' &&
    'glosses' in value &&
    typeof value.glosses === 'number' &&
    'freeTranslations' in value &&
    typeof value.freeTranslations === 'number'
  );
}

/**
 * Counts the glosses and free translations of `analysis` written in each of `tags`. Blank text
 * doesn't count.
 *
 * @returns Counts for every tag in `tags`, zeros included.
 */
export function countTextByTag(analysis: TextAnalysis, tags: readonly string[]): TextCountsByTag {
  const counts: TextCountsByTag = Object.fromEntries(
    tags.map((tag) => [tag, { glosses: 0, freeTranslations: 0 }]),
  );
  const tally = (text: MultiString | undefined, kind: keyof LanguageTextCounts) => {
    tags.forEach((tag) => {
      if ((text?.[tag] ?? '').trim() !== '') counts[tag][kind] += 1;
    });
  };
  analysis.tokenAnalyses.forEach(({ gloss, morphemes }) => {
    tally(gloss, 'glosses');
    morphemes?.forEach((morpheme) => tally(morpheme.gloss, 'glosses'));
  });
  analysis.phraseAnalyses.forEach(({ gloss }) => tally(gloss, 'glosses'));
  analysis.segmentAnalyses.forEach(({ freeTranslation }) =>
    tally(freeTranslation, 'freeTranslations'),
  );
  return counts;
}

/**
 * Counts the glosses and free translations of `analysis` in every language tag that has any.
 *
 * @returns Counts for each tag with text that isn't blank; no other tags.
 */
export function countTextOfEveryTag(analysis: TextAnalysis): TextCountsByTag {
  const tags = new Set<string>();
  const collect = (text: MultiString | undefined) =>
    Object.entries(text ?? {}).forEach(([tag, value]) => {
      if (value.trim() !== '') tags.add(tag);
    });
  analysis.tokenAnalyses.forEach(({ gloss, morphemes }) => {
    collect(gloss);
    morphemes?.forEach((morpheme) => collect(morpheme.gloss));
  });
  analysis.phraseAnalyses.forEach(({ gloss }) => collect(gloss));
  analysis.segmentAnalyses.forEach(({ freeTranslation }) => collect(freeTranslation));
  return countTextByTag(analysis, [...tags]);
}
