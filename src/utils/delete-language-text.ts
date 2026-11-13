import type {
  MultiString,
  PhraseAnalysis,
  SegmentAnalysis,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import type { LanguageTextCounts } from './text-counts';

/** The analyses a deletion changed, mutated in place, and how much text it deleted. */
export type LanguageTextDeletion = {
  counts: LanguageTextCounts;
  tokenAnalyses: TokenAnalysis[];
  phraseAnalyses: PhraseAnalysis[];
  segmentAnalyses: SegmentAnalysis[];
};

/**
 * Deletes the text under `tag` from each of `values` in place.
 *
 * @returns Whether any value had text under `tag`, and how many of them had text that wasn't blank.
 */
function deleteTag(
  values: readonly (MultiString | undefined)[],
  tag: string,
): { changed: boolean; counted: number } {
  return values.reduce<{ changed: boolean; counted: number }>(
    (result, value) => {
      const text = value?.[tag];
      if (!value || text === undefined) return result;
      delete value[tag];
      return { changed: true, counted: result.counted + (text.trim() === '' ? 0 : 1) };
    },
    { changed: false, counted: 0 },
  );
}

/**
 * Deletes the glosses and free translations of `analysis` written under `tag`, mutating the
 * analyses in place and stamping each one changed with `now`. Blank text is deleted too, but not
 * counted.
 */
export function deleteLanguageText(
  analysis: TextAnalysis,
  tag: string,
  now: string,
): LanguageTextDeletion {
  const counts: LanguageTextCounts = { glosses: 0, freeTranslations: 0 };
  const deleteFrom = <T extends { updatedAt?: string }>(
    record: T,
    values: readonly (MultiString | undefined)[],
    kind: keyof LanguageTextCounts,
  ) => {
    const { changed, counted } = deleteTag(values, tag);
    counts[kind] += counted;
    if (changed) record.updatedAt = now;
    return changed;
  };

  const tokenAnalyses = analysis.tokenAnalyses.filter((tokenAnalysis) =>
    deleteFrom(
      tokenAnalysis,
      [tokenAnalysis.gloss, ...(tokenAnalysis.morphemes ?? []).map(({ gloss }) => gloss)],
      'glosses',
    ),
  );
  const phraseAnalyses = analysis.phraseAnalyses.filter((phraseAnalysis) =>
    deleteFrom(phraseAnalysis, [phraseAnalysis.gloss], 'glosses'),
  );
  const segmentAnalyses = analysis.segmentAnalyses.filter((segmentAnalysis) =>
    deleteFrom(segmentAnalysis, [segmentAnalysis.freeTranslation], 'freeTranslations'),
  );

  return { counts, tokenAnalyses, phraseAnalyses, segmentAnalyses };
}
