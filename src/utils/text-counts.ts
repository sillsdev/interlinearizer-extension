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

/** Whether `value` is a {@link TextCountsByTag}. */
export function isTextCountsByTag(value: unknown): value is TextCountsByTag {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(isLanguageTextCounts)
  );
}

/**
 * Counts the glosses and free translations of `analysis` in every language tag with text that isn't
 * blank, and no other tag.
 */
export function countTextOfEveryTag(analysis: TextAnalysis): TextCountsByTag {
  const counts: TextCountsByTag = {};
  const tally = (text: MultiString | undefined, kind: keyof LanguageTextCounts) =>
    Object.entries(text ?? {}).forEach(([tag, value]) => {
      if (value.trim() === '') return;
      counts[tag] ??= { glosses: 0, freeTranslations: 0 };
      counts[tag][kind] += 1;
    });
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
