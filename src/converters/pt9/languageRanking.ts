import type { TextAnalysis } from 'interlinearizer';
import type { LangPhraseRecord, LangTokenRecord } from './languageAnalysisBuilder';

/** The refs of the tokens each analysis-language tag glosses, keyed by tag. */
type TokenTally = Map<string, Set<string>>;

type LinkedAnalysisLayer = Pick<
  TextAnalysis,
  'tokenAnalyses' | 'tokenAnalysisLinks' | 'phraseAnalyses' | 'phraseAnalysisLinks'
>;

function creditTokens(tally: TokenTally, tags: string[], tokenRefs: string[]): void {
  tags.forEach((tag) => {
    const glossed = tally.get(tag) ?? new Set<string>();
    tokenRefs.forEach((ref) => glossed.add(ref));
    tally.set(tag, glossed);
  });
}

/** Tallies the tokens that an approved link shows a gloss for, in each tag. */
function tallyShownTokens(analysis: LinkedAnalysisLayer): TokenTally {
  const shown: TokenTally = new Map();
  const tokenAnalysisById = new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta]));
  analysis.tokenAnalysisLinks.forEach((link) => {
    if (link.status !== 'approved') return;
    const payload = tokenAnalysisById.get(link.analysisId);
    const tags = [
      ...Object.keys(payload?.gloss ?? {}),
      ...(payload?.morphemes ?? []).flatMap((morpheme) => Object.keys(morpheme.gloss ?? {})),
    ];
    creditTokens(shown, tags, [link.token.tokenRef]);
  });
  const phraseAnalysisById = new Map(analysis.phraseAnalyses.map((pa) => [pa.id, pa]));
  analysis.phraseAnalysisLinks.forEach((link) => {
    if (link.status !== 'approved') return;
    creditTokens(
      shown,
      Object.keys(phraseAnalysisById.get(link.analysisId)?.gloss ?? {}),
      link.tokens.map((token) => token.tokenRef),
    );
  });
  return shown;
}

/** Tallies the tokens that an unrejected record glosses, approved or not, in each tag. */
function tallyGlossedTokens(records: LangTokenRecord[], phrases: LangPhraseRecord[]): TokenTally {
  const glossedByTag: TokenTally = new Map();
  records.forEach((record) => {
    if (record.status === 'rejected') return;
    const glossed =
      record.word?.glossText !== undefined ||
      (record.parse?.lexemes ?? []).some((lexeme) => lexeme.glossText !== undefined);
    if (glossed) creditTokens(glossedByTag, [record.tag], [record.tokenRef]);
  });
  phrases.forEach((record) => {
    if (record.status === 'rejected' || record.phrase.glossText === undefined) return;
    creditTokens(
      glossedByTag,
      [record.tag],
      record.tokens.map((token) => token.ref),
    );
  });
  return glossedByTag;
}

/**
 * Orders the distinct `languageTags` by how many tokens each glosses, most first. Glosses shown on
 * an approved link in `analysis` rank first, because read-only views show approved glosses only.
 * Glosses on unrejected `records` and `phrases` break ties among those, and tags still tied keep
 * their order in `languageTags`.
 */
export function rankAnalysisLanguages(args: {
  languageTags: string[];
  analysis: LinkedAnalysisLayer;
  records: LangTokenRecord[];
  phrases: LangPhraseRecord[];
}): string[] {
  const shown = tallyShownTokens(args.analysis);
  const glossed = tallyGlossedTokens(args.records, args.phrases);
  const countOf = (tally: TokenTally, tag: string) => tally.get(tag)?.size ?? 0;
  return [...new Set(args.languageTags)].sort(
    (a, b) => countOf(shown, b) - countOf(shown, a) || countOf(glossed, b) - countOf(glossed, a),
  );
}
