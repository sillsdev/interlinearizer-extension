import { reconcileMorphemes } from '../../utils/analysis-identity';
import { isEmptyTokenAnalysis } from '../../utils/token-analysis-content';
import type { ChangeBuffer } from './changeBuffer';
import {
  appendApprovedAnalysis,
  detachEmptiedAnalysis,
  forkSharedAnalysis,
  isSharedByOtherTokens,
  mergeIntoIdenticalPayload,
  resolveApprovedAnalysis,
  type TokenEdit,
} from './tokenCommands';

/** What writing a token's morpheme breakdown needs. */
export type WriteMorphemesRequest = TokenEdit & {
  /** BCP 47 tag of the writing system the forms are in, stamped on every morpheme. */
  writingSystem: string;
  /** Id a new or forked token analysis takes, spent only when the write makes one. */
  analysisId: string;
  /** The breakdown, in order; a form the token's breakdown already holds keeps its morpheme. */
  morphemes: readonly { id: string; form: string }[];
};

/** What removing a token's morpheme breakdown needs. */
export type DeleteMorphemesRequest = Pick<TokenEdit, 'tokenRef' | 'now'> & {
  /** Id a forked token analysis takes, spent only when the removal forks a shared payload. */
  analysisId: string;
};

/** What glossing one morpheme of a token's breakdown needs. */
export type WriteMorphemeGlossRequest = Pick<TokenEdit, 'tokenRef' | 'now'> & {
  /** `MorphemeAnalysis.id` of the morpheme glossed. */
  morphemeId: string;
  /** The gloss; blank clears the morpheme's gloss in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the gloss is written in. */
  analysisLanguage: string;
  /** Id a forked token analysis takes, spent only when the edit forks a shared payload. */
  analysisId: string;
};

/**
 * Stages writing a token's morpheme breakdown. The edit is per token: a payload other tokens share
 * is forked first. A form the breakdown already carried keeps its morpheme whole, so links to it
 * survive; every morpheme takes `writingSystem`, and the breakdown is never left marked stale. An
 * edit that makes the payload identical to another folds it in. A token with no approved analysis
 * takes a content-identical stored one, or a new one.
 */
export async function writeMorphemes(
  buffer: ChangeBuffer,
  request: WriteMorphemesRequest,
): Promise<void> {
  const { tokenRef, surfaceText, writingSystem, analysisId, morphemes, now } = request;

  const resolved = await resolveApprovedAnalysis(buffer, tokenRef);
  if (resolved) {
    const { link, analysis } = resolved;
    const target = (await isSharedByOtherTokens(buffer, link, analysis.id))
      ? forkSharedAnalysis(buffer, link, analysis, analysisId, now)
      : analysis;
    target.surfaceText = surfaceText;
    target.updatedAt = now;
    link.token.surfaceText = surfaceText;
    link.updatedAt = now;
    target.morphemes = reconcileMorphemes(target.morphemes, morphemes, writingSystem);
    delete target.morphemesStale;
    buffer.put('tokenAnalyses', target);
    buffer.put('tokenAnalysisLinks', link);
    await mergeIntoIdenticalPayload(buffer, target, now);
    return;
  }

  await appendApprovedAnalysis(
    buffer,
    {
      id: analysisId,
      createdAt: now,
      updatedAt: now,
      surfaceText,
      morphemes: morphemes.map(({ id, form }) => ({ id, form, writingSystem })),
    },
    request,
  );
}

/**
 * Stages removing a token's morpheme breakdown and its stale mark. The edit is per token: a payload
 * other tokens share is forked first. A payload the removal leaves empty is detached from the token
 * and goes once nothing links it; one left with content folds into an identical payload where there
 * is one. It stages nothing for a token with no approved analysis, or one with no breakdown.
 */
export async function deleteMorphemes(
  buffer: ChangeBuffer,
  { tokenRef, analysisId, now }: DeleteMorphemesRequest,
): Promise<void> {
  const resolved = await resolveApprovedAnalysis(buffer, tokenRef);
  if (!resolved?.analysis.morphemes) return;
  const { link, analysis } = resolved;

  const target = (await isSharedByOtherTokens(buffer, link, analysis.id))
    ? forkSharedAnalysis(buffer, link, analysis, analysisId, now)
    : analysis;
  delete target.morphemes;
  delete target.morphemesStale;
  target.updatedAt = now;
  link.updatedAt = now;
  if (isEmptyTokenAnalysis(target)) {
    await detachEmptiedAnalysis(buffer, target, link);
    return;
  }
  buffer.put('tokenAnalyses', target);
  buffer.put('tokenAnalysisLinks', link);
  await mergeIntoIdenticalPayload(buffer, target, now);
}

/**
 * Stages glossing one morpheme of a token's approved breakdown. The edit is per token: a payload
 * other tokens share is forked first, the morpheme keeping its id on the fork. A blank value clears
 * the gloss in `analysisLanguage`, dropping a gloss it leaves empty; the morpheme and its analysis
 * stay. An edit or clear that makes the payload identical to another folds it in. It stages nothing
 * for a token with no approved analysis, or one whose breakdown lacks the morpheme.
 */
export async function writeMorphemeGloss(
  buffer: ChangeBuffer,
  {
    tokenRef,
    morphemeId,
    value,
    analysisLanguage: lang,
    analysisId,
    now,
  }: WriteMorphemeGlossRequest,
): Promise<void> {
  const resolved = await resolveApprovedAnalysis(buffer, tokenRef);
  if (!resolved) return;
  const { link, analysis } = resolved;
  if (!analysis.morphemes?.some((m) => m.id === morphemeId)) return;

  const target = (await isSharedByOtherTokens(buffer, link, analysis.id))
    ? forkSharedAnalysis(buffer, link, analysis, analysisId, now)
    : analysis;
  const morpheme = target.morphemes?.find((m) => m.id === morphemeId);
  /* v8 ignore next -- the fork keeps every morpheme id, so this always resolves */
  if (!morpheme) return;

  if (value.trim() === '') {
    if (morpheme.gloss) {
      delete morpheme.gloss[lang];
      if (Object.keys(morpheme.gloss).length === 0) delete morpheme.gloss;
    }
  } else {
    if (!morpheme.gloss) morpheme.gloss = {};
    morpheme.gloss[lang] = value;
  }
  target.updatedAt = now;
  link.updatedAt = now;
  buffer.put('tokenAnalyses', target);
  buffer.put('tokenAnalysisLinks', link);
  await mergeIntoIdenticalPayload(buffer, target, now);
}
