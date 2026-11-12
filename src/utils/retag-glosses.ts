import type { MultiString, PhraseAnalysis, TextAnalysis, TokenAnalysis } from 'interlinearizer';

/** How many glosses a retag moved, and how many it left where they were. */
export type GlossRetagCounts = {
  /** Word glosses moved: one per token or phrase analysis whose own gloss moved. */
  words: number;
  /** Morpheme glosses moved. */
  morphemes: number;
  /** Word and morpheme glosses left under the old tag because the new tag already held one. */
  skipped: number;
};

/** Whether `value` is a {@link GlossRetagCounts}, as a host reply carries one. */
export function isGlossRetagCounts(value: unknown): value is GlossRetagCounts {
  return (
    !!value &&
    typeof value === 'object' &&
    'words' in value &&
    typeof value.words === 'number' &&
    'morphemes' in value &&
    typeof value.morphemes === 'number' &&
    'skipped' in value &&
    typeof value.skipped === 'number'
  );
}

/** The analyses a retag changed, mutated in place, and what it moved. */
export type GlossRetag = {
  counts: GlossRetagCounts;
  tokenAnalyses: TokenAnalysis[];
  phraseAnalyses: PhraseAnalysis[];
};

/**
 * Moves the text under `from` to `to` in place. Text under `to` is never overwritten, and blank
 * text under `from` is left alone.
 */
function retagMultiString(
  value: MultiString | undefined,
  from: string,
  to: string,
): 'moved' | 'skipped' | 'none' {
  const text = value?.[from];
  if (!value || text === undefined || text.trim() === '') return 'none';
  if ((value[to] ?? '').trim() !== '') return 'skipped';
  delete value[from];
  value[to] = text;
  return 'moved';
}

/**
 * Moves the word and morpheme glosses of `analysis` written under the tag `from` to the tag `to`,
 * mutating the analyses in place and stamping each one changed with `now`. A gloss whose word or
 * morpheme already has text under `to` stays under `from` and is counted as skipped.
 *
 * @returns The analyses changed, and the counts.
 */
export function retagGlosses(
  analysis: TextAnalysis,
  from: string,
  to: string,
  now: string,
): GlossRetag {
  const counts: GlossRetagCounts = { words: 0, morphemes: 0, skipped: 0 };
  const tally = (outcome: ReturnType<typeof retagMultiString>, kind: 'words' | 'morphemes') => {
    if (outcome === 'moved') counts[kind] += 1;
    else if (outcome === 'skipped') counts.skipped += 1;
    return outcome === 'moved';
  };

  const tokenAnalyses = analysis.tokenAnalyses.filter((tokenAnalysis) => {
    const wordMoved = tally(retagMultiString(tokenAnalysis.gloss, from, to), 'words');
    const morphemesMoved = (tokenAnalysis.morphemes ?? [])
      .map((morpheme) => tally(retagMultiString(morpheme.gloss, from, to), 'morphemes'))
      .some(Boolean);
    if (!wordMoved && !morphemesMoved) return false;
    tokenAnalysis.updatedAt = now;
    return true;
  });

  const phraseAnalyses = analysis.phraseAnalyses.filter((phraseAnalysis) => {
    if (!tally(retagMultiString(phraseAnalysis.gloss, from, to), 'words')) return false;
    phraseAnalysis.updatedAt = now;
    return true;
  });

  return { counts, tokenAnalyses, phraseAnalyses };
}
