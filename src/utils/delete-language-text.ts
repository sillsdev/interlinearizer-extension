import type {
  MultiString,
  PhraseAnalysis,
  SegmentAnalysis,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import { isEmptyMultiString } from './multi-string';
import type { LanguageTextCounts } from './text-counts';

/** The analyses a deletion changed, mutated in place, and how much text it deleted. */
export type LanguageTextDeletion = {
  counts: LanguageTextCounts;
  tokenAnalyses: TokenAnalysis[];
  phraseAnalyses: PhraseAnalysis[];
  segmentAnalyses: SegmentAnalysis[];
};

/** What deleting a tag from one text found there. */
type Deleted = 'none' | 'blank' | 'text';

/**
 * Deletes `tag` from the `field` text of `owner` in place, dropping the text whole once no language
 * holds any.
 */
function deleteTag<Field extends string>(
  owner: { [key in Field]?: MultiString },
  field: Field,
  tag: string,
): Deleted {
  const text = owner[field];
  const value = text?.[tag];
  if (!text || value === undefined) return 'none';
  delete text[tag];
  if (isEmptyMultiString(text)) delete owner[field];
  return value.trim() === '' ? 'blank' : 'text';
}

/**
 * Deletes the glosses and free translations of `analysis` written under `tag`, mutating the
 * analyses in place and stamping each one changed with `now`. Blank text is deleted too, but not
 * counted. A gloss or free translation left with no text in any language is dropped whole.
 */
export function deleteLanguageText(
  analysis: TextAnalysis,
  tag: string,
  now: string,
): LanguageTextDeletion {
  const counts: LanguageTextCounts = { glosses: 0, freeTranslations: 0 };
  const tally = (found: readonly Deleted[], kind: keyof LanguageTextCounts) => {
    counts[kind] += found.filter((deleted) => deleted === 'text').length;
    return found.some((deleted) => deleted !== 'none');
  };

  const tokenAnalyses = analysis.tokenAnalyses.filter((tokenAnalysis) => {
    const found = [
      deleteTag(tokenAnalysis, 'gloss', tag),
      ...(tokenAnalysis.morphemes ?? []).map((morpheme) => deleteTag(morpheme, 'gloss', tag)),
    ];
    if (!tally(found, 'glosses')) return false;
    tokenAnalysis.updatedAt = now;
    return true;
  });

  const phraseAnalyses = analysis.phraseAnalyses.filter((phraseAnalysis) => {
    const found = deleteTag(phraseAnalysis, 'gloss', tag);
    if (!tally([found], 'glosses')) return false;
    phraseAnalysis.updatedAt = now;
    return true;
  });

  const segmentAnalyses = analysis.segmentAnalyses.filter((segmentAnalysis) => {
    const found = deleteTag(segmentAnalysis, 'freeTranslation', tag);
    if (!tally([found], 'freeTranslations')) return false;
    segmentAnalysis.updatedAt = now;
    return true;
  });

  return { counts, tokenAnalyses, phraseAnalyses, segmentAnalyses };
}
