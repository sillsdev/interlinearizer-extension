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

/** Whether `value` is a {@link TextCountsByTag}. */
export function isTextCountsByTag(value: unknown): value is TextCountsByTag {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (counts: unknown) =>
        !!counts &&
        typeof counts === 'object' &&
        'glosses' in counts &&
        typeof counts.glosses === 'number' &&
        'freeTranslations' in counts &&
        typeof counts.freeTranslations === 'number',
    )
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
