import type {
  MultiString,
  PhraseAnalysis,
  SegmentAnalysis,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';

/** How many glosses and free translations a retag moved, and how many it left where they were. */
export type GlossRetagCounts = {
  /** Word glosses moved: one per token or phrase analysis whose own gloss moved. */
  words: number;
  /** Morpheme glosses moved. */
  morphemes: number;
  /** Segment free translations moved. */
  freeTranslations: number;
  /** Glosses and free translations left under the old tag because the new tag held a different one. */
  skipped: number;
};

/** Whether `value` is a {@link GlossRetagCounts}. */
export function isGlossRetagCounts(value: unknown): value is GlossRetagCounts {
  return (
    !!value &&
    typeof value === 'object' &&
    'words' in value &&
    typeof value.words === 'number' &&
    'morphemes' in value &&
    typeof value.morphemes === 'number' &&
    'freeTranslations' in value &&
    typeof value.freeTranslations === 'number' &&
    'skipped' in value &&
    typeof value.skipped === 'number'
  );
}

/** The analyses a retag changed, mutated in place, and what it moved. */
export type GlossRetag = {
  counts: GlossRetagCounts;
  tokenAnalyses: TokenAnalysis[];
  phraseAnalyses: PhraseAnalysis[];
  segmentAnalyses: SegmentAnalysis[];
};

/** What {@link retagMultiString} would do to `value`, without changing it. */
function retagOutcome(
  value: MultiString | undefined,
  from: string,
  to: string,
): 'moved' | 'skipped' | 'none' {
  const text = value?.[from];
  if (text === undefined || text.trim() === '') return 'none';
  const existing = (value?.[to] ?? '').trim();
  return existing !== '' && existing !== text.trim() ? 'skipped' : 'moved';
}

/**
 * Moves the text under `from` to `to` in place. Text under `to` is never overwritten. Text under
 * `from` that matches the text under `to` is dropped and counts as moved. Blank text under `from`
 * is left alone.
 */
function retagMultiString(
  value: MultiString | undefined,
  from: string,
  to: string,
): ReturnType<typeof retagOutcome> {
  const outcome = retagOutcome(value, from, to);
  const text = value?.[from];
  if (!value || text === undefined || outcome !== 'moved') return outcome;
  delete value[from];
  if ((value[to] ?? '').trim() === '') value[to] = text;
  return outcome;
}

/**
 * Moves the glosses and free translations of `analysis` written under the tag `from` to the tag
 * `to`, mutating the analyses in place and stamping each one changed with `now`. Text whose word,
 * morpheme, or segment already has the same text under `to` is dropped and counted as moved. Text
 * whose word, morpheme, or segment has different text under `to` stays under `from` and is counted
 * as skipped.
 */
export function retagGlosses(
  analysis: TextAnalysis,
  from: string,
  to: string,
  now: string,
): GlossRetag {
  const counts: GlossRetagCounts = { words: 0, morphemes: 0, freeTranslations: 0, skipped: 0 };
  const tally = (
    outcome: ReturnType<typeof retagMultiString>,
    kind: 'words' | 'morphemes' | 'freeTranslations',
  ) => {
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

  const segmentAnalyses = analysis.segmentAnalyses.filter((segmentAnalysis) => {
    if (!tally(retagMultiString(segmentAnalysis.freeTranslation, from, to), 'freeTranslations'))
      return false;
    segmentAnalysis.updatedAt = now;
    return true;
  });

  return { counts, tokenAnalyses, phraseAnalyses, segmentAnalyses };
}
