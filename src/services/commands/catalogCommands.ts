import type { MergedContent, TokenAnalysis } from 'interlinearizer';
import { reconcileMorphemes } from '../../utils/analysis-identity';
import {
  applyMergedContent,
  carryOverUnsettledContent,
  clearAnalysisGloss,
  isEmptyTokenAnalysis,
} from '../../utils/token-analysis-content';
import type { ChangeBuffer } from './changeBuffer';
import { coalesceLinksPerToken, mergeIntoIdenticalPayload } from './tokenCommands';

/** What every edit of a token analysis by its own id needs. */
export type CatalogEdit = {
  /** The token analysis edited, for every token linked to it. */
  analysisId: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/** What writing a token analysis's gloss needs. */
export type WriteAnalysisGlossRequest = CatalogEdit & {
  /** The gloss; blank clears the analysis's gloss in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the gloss is written in. */
  analysisLanguage: string;
};

/** What clearing the glosses of several token analyses needs. */
export type ClearAnalysisGlossesRequest = {
  /** The token analyses whose gloss is cleared, in the order they are cleared. */
  analysisIds: readonly string[];
  /** BCP 47 tag of the language whose gloss is cleared. */
  analysisLanguage: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/** What re-splitting a token analysis's breakdown needs. */
export type WriteAnalysisMorphemesRequest = CatalogEdit & {
  /**
   * The breakdown's forms in order, each with the id that a new morpheme for the form takes. Only a
   * form that the breakdown has no morpheme for spends its id. Empty removes the breakdown.
   */
  morphemes: readonly { id: string; form: string }[];
  /** Writing system that new morphemes are tagged with and kept ones are retagged with. */
  writingSystem: string;
};

/** What writing one morpheme's gloss on a token analysis needs. */
export type WriteAnalysisMorphemeGlossRequest = CatalogEdit & {
  /** `MorphemeAnalysis.id` of the morpheme glossed. */
  morphemeId: string;
  /** The gloss; blank clears the morpheme's gloss in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the gloss is written in. */
  analysisLanguage: string;
};

/** What folding several token analyses into one needs. */
export type MergeAnalysesIntoRequest = {
  /** The token analysis kept. */
  survivorAnalysisId: string;
  /** The token analyses folded in, most-preferred first. */
  mergedAnalysisIds: readonly string[];
  /** What the survivor says once the merge settles. */
  content: MergedContent;
  /** BCP 47 tag of the language the merge is conducted in. */
  analysisLanguage: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/** Stages removing the token analysis `analysisId`, if stored, and every token link to it. */
async function removeAnalysisAndLinks(buffer: ChangeBuffer, analysisId: string): Promise<void> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  tokenAnalysisLinks.forEach((link) => buffer.delete('tokenAnalysisLinks', link));
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (analysis) buffer.delete('tokenAnalyses', analysis);
}

/**
 * Stages storing `analysis` as an edit left it. An analysis left empty goes with every token link
 * to it. One made identical to another payload is folded into that payload.
 *
 * @returns The id of the analysis that holds `analysis`'s content afterward, or `undefined` when
 *   the edit left `analysis` empty.
 */
async function settleEditedAnalysis(
  buffer: ChangeBuffer,
  analysis: TokenAnalysis,
  now: string,
): Promise<string | undefined> {
  if (isEmptyTokenAnalysis(analysis)) {
    await removeAnalysisAndLinks(buffer, analysis.id);
    return undefined;
  }
  buffer.put('tokenAnalyses', analysis);
  return (await mergeIntoIdenticalPayload(buffer, analysis, now)) ?? analysis.id;
}

/**
 * Stages writing the gloss of the token analysis `analysisId`, for every token linked to it. A
 * blank value clears the gloss. Neither a rewrite nor a clear touches the analysis's
 * `glossSenseRef`.
 *
 * An analysis the write leaves empty goes with every token link to it. One the write makes
 * identical to another payload is folded into that payload. Nothing is staged when the analysis
 * isn't stored.
 *
 * @returns The id of the analysis that holds the edited content afterward, or `undefined` when the
 *   analysis isn't stored or the edit left it empty.
 */
export async function writeAnalysisGloss(
  buffer: ChangeBuffer,
  { analysisId, value, analysisLanguage: lang, now }: WriteAnalysisGlossRequest,
): Promise<string | undefined> {
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (!analysis) return undefined;
  if (value.trim() === '') clearAnalysisGloss(analysis, lang);
  else analysis.gloss = { ...analysis.gloss, [lang]: value };
  analysis.updatedAt = now;
  return settleEditedAnalysis(buffer, analysis, now);
}

/**
 * Stages clearing the gloss of each token analysis in `analysisIds`, in order. An analysis left
 * empty goes with every token link to it. One made identical to another payload is folded into that
 * payload.
 */
export async function clearAnalysisGlosses(
  buffer: ChangeBuffer,
  { analysisIds, analysisLanguage, now }: ClearAnalysisGlossesRequest,
): Promise<void> {
  await analysisIds.reduce<Promise<unknown>>(
    (previous, analysisId) =>
      previous.then(() =>
        writeAnalysisGloss(buffer, { analysisId, value: '', analysisLanguage, now }),
      ),
    Promise.resolve(),
  );
}

/**
 * Stages re-splitting the breakdown of the token analysis `analysisId`, for every token linked to
 * it, and clears its stale mark.
 *
 * A form that the breakdown already carried keeps its morpheme whole. A form with no counterpart
 * there gets a new morpheme. A dropped form takes its gloss and lexicon references with it.
 *
 * An analysis the re-split leaves empty goes with every token link to it. One the re-split makes
 * identical to another payload is folded into that payload. Nothing is staged when the analysis
 * isn't stored.
 *
 * @returns The id of the analysis that holds the edited content afterward, or `undefined` when the
 *   analysis isn't stored or the edit left it empty.
 */
export async function writeAnalysisMorphemes(
  buffer: ChangeBuffer,
  { analysisId, morphemes, writingSystem, now }: WriteAnalysisMorphemesRequest,
): Promise<string | undefined> {
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (!analysis) return undefined;
  if (morphemes.length === 0) delete analysis.morphemes;
  else analysis.morphemes = reconcileMorphemes(analysis.morphemes, morphemes, writingSystem);
  delete analysis.morphemesStale;
  analysis.updatedAt = now;
  return settleEditedAnalysis(buffer, analysis, now);
}

/**
 * Stages keeping the stale breakdown of the token analysis `analysisId` as it stands, clearing its
 * mark for every token linked to it. Nothing is staged when the breakdown isn't stale.
 */
export async function confirmAnalysisMorphemes(
  buffer: ChangeBuffer,
  { analysisId, now }: CatalogEdit,
): Promise<void> {
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (!analysis?.morphemesStale) return;
  delete analysis.morphemesStale;
  analysis.updatedAt = now;
  buffer.put('tokenAnalyses', analysis);
}

/**
 * Stages writing the gloss of one morpheme of the token analysis `analysisId`, for every token
 * linked to it. A blank value clears the gloss and keeps the morpheme.
 *
 * An analysis the write makes identical to another payload is folded into that payload. Nothing is
 * staged when the analysis isn't stored or has no such morpheme.
 *
 * @returns The id of the analysis that holds the edited content afterward, or `undefined` when
 *   nothing was staged.
 */
export async function writeAnalysisMorphemeGloss(
  buffer: ChangeBuffer,
  { analysisId, morphemeId, value, analysisLanguage: lang, now }: WriteAnalysisMorphemeGlossRequest,
): Promise<string | undefined> {
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  const morpheme = analysis?.morphemes?.find(({ id }) => id === morphemeId);
  if (!analysis || !morpheme) return undefined;
  if (value.trim() === '') {
    if (morpheme.gloss) {
      delete morpheme.gloss[lang];
      if (Object.keys(morpheme.gloss).length === 0) delete morpheme.gloss;
    }
  } else {
    morpheme.gloss = { ...morpheme.gloss, [lang]: value };
  }
  analysis.updatedAt = now;
  buffer.put('tokenAnalyses', analysis);
  return (await mergeIntoIdenticalPayload(buffer, analysis, now)) ?? analysis.id;
}

/**
 * Stages removing the token analyses in `analysisIds` and every token link to them, including links
 * to an analysis that isn't stored.
 */
export async function deleteAnalyses(
  buffer: ChangeBuffer,
  { analysisIds }: { analysisIds: readonly string[] },
): Promise<void> {
  await analysisIds.reduce<Promise<void>>(
    (previous, analysisId) => previous.then(() => removeAnalysisAndLinks(buffer, analysisId)),
    Promise.resolve(),
  );
}

/**
 * Stages folding token analyses into a survivor and writing the settled content onto it.
 *
 * Every token link to a folded analysis moves to the survivor and takes the edit's time. A token
 * left with several links to the survivor keeps one, approved if any was. A folded id that names no
 * stored analysis, or names the survivor, is skipped.
 *
 * Glosses outside `analysisLanguage` carry over from the folded analyses where the survivor has
 * none, the most-preferred one first. The survivor's sense follows the analysis its settled gloss
 * came from.
 *
 * A survivor the merge leaves empty goes with every token link to it. One that matches another
 * payload is folded into that payload, which takes the survivor's confidence. Nothing is staged
 * when the survivor isn't stored.
 *
 * @returns The id of the analysis that holds the edited content afterward, or `undefined` when the
 *   survivor isn't stored or the merge left it empty.
 */
export async function mergeAnalysesInto(
  buffer: ChangeBuffer,
  {
    survivorAnalysisId,
    mergedAnalysisIds,
    content,
    analysisLanguage: lang,
    now,
  }: MergeAnalysesIntoRequest,
): Promise<string | undefined> {
  const [survivor] = await buffer.getTokenAnalyses([survivorAnalysisId]);
  if (!survivor) return undefined;

  const stored = new Map(
    (await buffer.getTokenAnalyses([...mergedAnalysisIds])).map((ta) => [ta.id, ta]),
  );
  const donors = [...new Set(mergedAnalysisIds)]
    .filter((id) => id !== survivorAnalysisId)
    .map((id) => stored.get(id))
    .filter((donor) => donor !== undefined);
  const glossFrom =
    content.glossFromAnalysisId === undefined
      ? undefined
      : (await buffer.getTokenAnalyses([content.glossFromAnalysisId]))[0];

  applyMergedContent(survivor, content, lang);
  carryOverUnsettledContent(survivor, donors, lang, glossFrom);
  survivor.updatedAt = now;
  buffer.put('tokenAnalyses', survivor);

  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses(donors.map(({ id }) => id));
  tokenAnalysisLinks.forEach((link) =>
    buffer.put('tokenAnalysisLinks', { ...link, analysisId: survivorAnalysisId, updatedAt: now }),
  );
  await coalesceLinksPerToken(buffer, survivorAnalysisId);
  donors.forEach((donor) => buffer.delete('tokenAnalyses', donor));

  if (isEmptyTokenAnalysis(survivor)) {
    await removeAnalysisAndLinks(buffer, survivorAnalysisId);
    return undefined;
  }
  return (
    (await mergeIntoIdenticalPayload(buffer, survivor, now, { settleProvenance: true })) ??
    survivorAnalysisId
  );
}
