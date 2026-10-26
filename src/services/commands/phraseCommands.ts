import type { PhraseAnalysis, PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import { normalizeSurfaceForm, phraseAnalysesAreIdentical } from '../../utils/analysis-identity';
import { isEmptyMultiString } from '../../utils/multi-string';
import { sliceAtBoundary } from '../../utils/phrase-arc';
import { phraseSurfaceText } from '../../utils/phrase-text';
import { preferredPayload } from '../../utils/pick-rules';
import type { ChangeBuffer } from './changeBuffer';

/** What every edit that may fork a phrase occurrence's payload needs. */
type PhraseEditStamp = {
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
  /** Id a private copy of a shared payload takes, spent only when the edit forks one. */
  forkId: string;
};

/** What creating a phrase occurrence needs. */
export type CreatePhraseRequest = {
  /** The phrase's tokens, in document order. */
  tokens: TokenSnapshot[];
  /** Id the new occurrence's link takes. */
  linkId: string;
  /** Id a new payload takes, spent only when no content-identical payload is stored. */
  analysisId: string;
  /** ISO 8601 time of the edit, stamped on the records it makes. */
  now: string;
};

/** What giving a phrase occurrence a new token run needs. */
export type UpdatePhraseRequest = PhraseEditStamp & {
  /** `PhraseAnalysisLink.id` of the occurrence. */
  phraseId: string;
  /** The new token run, in document order; an empty run removes the occurrence. */
  tokens: TokenSnapshot[];
};

/** What removing a phrase occurrence needs. */
export type DeletePhraseRequest = {
  /** `PhraseAnalysisLink.id` of the occurrence. */
  phraseId: string;
};

/** What merging a neighbor into a phrase occurrence needs. */
export type MergePhrasesRequest = PhraseEditStamp & {
  /** `PhraseAnalysisLink.id` of the occurrence that grows. */
  targetPhraseId: string;
  /** The merged token run, in document order. */
  tokens: TokenSnapshot[];
  /**
   * `PhraseAnalysisLink.id` of the neighboring occurrence folded into `tokens`, which the merge
   * removes. Absent when the neighbor is a token in no phrase.
   */
  absorbedPhraseId?: string;
};

/** What writing a phrase occurrence's gloss needs. */
export type WritePhraseGlossRequest = PhraseEditStamp & {
  /** `PhraseAnalysisLink.id` of the occurrence. */
  phraseId: string;
  /** The gloss; blank clears the occurrence's gloss in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the gloss is written in. */
  analysisLanguage: string;
};

/** What approving a phrase occurrence needs. */
export type ApprovePhraseRequest = {
  /** `PhraseAnalysisLink.id` of the occurrence. */
  phraseId: string;
  /** ISO 8601 time of the edit, stamped on the link it approves. */
  now: string;
};

/** What splitting a phrase occurrence needs. */
export type SplitPhraseRequest = PhraseEditStamp & {
  /** `PhraseAnalysisLink.id` of the occurrence. */
  phraseId: string;
  /** `Token.ref` of the token the first half ends with. */
  splitAfterTokenRef: string;
  /**
   * Each token's place in document order, by `Token.ref`. A token it does not place sorts as if at
   * place zero.
   */
  tokenDocOrder: ReadonlyMap<string, number>;
  /** Id the link of the second half takes, spent only when both halves remain phrases. */
  linkId: string;
  /** Id a new payload for the second half takes, spent only when the split makes one. */
  analysisId: string;
};

async function findPhraseLink(
  buffer: ChangeBuffer,
  phraseId: string,
): Promise<PhraseAnalysisLink | undefined> {
  const [link] = await buffer.getPhraseAnalysisLinks([phraseId]);
  return link;
}

/** Removes a phrase occurrence, with its payload once no other occurrence names that payload. */
async function detachPhraseLink(buffer: ChangeBuffer, link: PhraseAnalysisLink): Promise<void> {
  buffer.delete('phraseAnalysisLinks', link);
  const { phraseAnalysisLinks } = await buffer.findLinksToAnalyses([link.analysisId]);
  if (phraseAnalysisLinks.length > 0) return;
  (await buffer.getPhraseAnalyses([link.analysisId])).forEach((analysis) =>
    buffer.delete('phraseAnalyses', analysis),
  );
}

/** Whether another occurrence, at any status, names the payload `link` names. */
async function isPhrasePayloadShared(
  buffer: ChangeBuffer,
  link: PhraseAnalysisLink,
): Promise<boolean> {
  const { phraseAnalysisLinks } = await buffer.findLinksToAnalyses([link.analysisId]);
  return phraseAnalysisLinks.some(({ id }) => id !== link.id);
}

/**
 * The payload an edit to `link`'s occurrence writes to: its own, or a private copy when other
 * occurrences share it, so that they keep reading what they did. The copy is dated by the edit and
 * staged. Staging `link` is left to the caller.
 *
 * @returns `undefined` when the link names no stored payload.
 */
async function editablePhraseAnalysis(
  buffer: ChangeBuffer,
  link: PhraseAnalysisLink,
  { forkId, now }: PhraseEditStamp,
): Promise<PhraseAnalysis | undefined> {
  const [analysis] = await buffer.getPhraseAnalyses([link.analysisId]);
  if (!analysis) return undefined;
  if (!(await isPhrasePayloadShared(buffer, link))) return analysis;
  const fork: PhraseAnalysis = { ...analysis, id: forkId, createdAt: now, updatedAt: now };
  buffer.create('phraseAnalyses', fork);
  link.analysisId = forkId;
  return fork;
}

/**
 * When the edit made the staged `analysis` identical to another payload, folds it into that one, so
 * that an edit never leaves a duplicate. Every occurrence of `analysis` moves to the survivor. The
 * survivor and the moved links keep their timestamps.
 */
async function mergeIntoIdenticalPhrase(
  buffer: ChangeBuffer,
  analysis: PhraseAnalysis,
): Promise<void> {
  const candidates = await buffer.findPhraseAnalysesByForm([
    normalizeSurfaceForm(analysis.surfaceText),
  ]);
  const other = preferredPayload(
    candidates.filter((pa) => pa.id !== analysis.id && phraseAnalysesAreIdentical(pa, analysis)),
  );
  if (!other) return;
  const { phraseAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  phraseAnalysisLinks.forEach((l) =>
    buffer.put('phraseAnalysisLinks', { ...l, analysisId: other.id }),
  );
  buffer.delete('phraseAnalyses', analysis);
}

/**
 * Gives a phrase occurrence a new token run and re-derives its payload's surface text, so that the
 * text never goes stale. Other occurrences sharing the payload keep theirs. An occurrence whose
 * link names no stored payload still takes the new run.
 */
async function reshapePhrase(
  buffer: ChangeBuffer,
  link: PhraseAnalysisLink,
  tokens: TokenSnapshot[],
  stamp: PhraseEditStamp,
): Promise<void> {
  link.tokens = tokens;
  link.updatedAt = stamp.now;
  const target = await editablePhraseAnalysis(buffer, link, stamp);
  buffer.put('phraseAnalysisLinks', link);
  if (!target) return;
  target.surfaceText = phraseSurfaceText(tokens);
  target.updatedAt = stamp.now;
  buffer.put('phraseAnalyses', target);
  await mergeIntoIdenticalPhrase(buffer, target);
}

/**
 * Stages an approved phrase occurrence over `tokens`. It shares a content-identical stored payload
 * as that payload stands, where one exists, and otherwise gets a new one.
 */
export async function createPhrase(
  buffer: ChangeBuffer,
  { tokens, linkId, analysisId, now }: CreatePhraseRequest,
): Promise<void> {
  const created: PhraseAnalysis = {
    id: analysisId,
    createdAt: now,
    updatedAt: now,
    surfaceText: phraseSurfaceText(tokens),
  };
  const candidates = await buffer.findPhraseAnalysesByForm([
    normalizeSurfaceForm(created.surfaceText),
  ]);
  const existing = preferredPayload(
    candidates.filter((pa) => phraseAnalysesAreIdentical(pa, created)),
  );
  if (!existing) buffer.create('phraseAnalyses', created);
  buffer.create('phraseAnalysisLinks', {
    id: linkId,
    analysisId: existing?.id ?? analysisId,
    createdAt: now,
    updatedAt: now,
    status: 'approved',
    tokens,
  });
}

/**
 * Stages giving a phrase occurrence a new token run. The occurrence keeps its gloss, and its
 * payload's surface text is re-derived. The edit is per occurrence: a payload other occurrences
 * share is forked first. An edit that makes the payload identical to another folds it into that
 * one.
 *
 * An empty run removes the occurrence, as {@link deletePhrase} does, so that no phrase holds no
 * tokens. Nothing is staged for an unknown occurrence.
 */
export async function updatePhrase(
  buffer: ChangeBuffer,
  { phraseId, tokens, ...stamp }: UpdatePhraseRequest,
): Promise<void> {
  const link = await findPhraseLink(buffer, phraseId);
  if (!link) return;
  if (tokens.length === 0) await detachPhraseLink(buffer, link);
  else await reshapePhrase(buffer, link, tokens, stamp);
}

/**
 * Stages removing a phrase occurrence. Its payload goes too, unless another occurrence shares it.
 * Nothing is staged for an unknown occurrence.
 */
export async function deletePhrase(
  buffer: ChangeBuffer,
  { phraseId }: DeletePhraseRequest,
): Promise<void> {
  const link = await findPhraseLink(buffer, phraseId);
  if (link) await detachPhraseLink(buffer, link);
}

/**
 * Stages merging a neighbor into a phrase occurrence as one edit. The target takes the merged run,
 * as {@link updatePhrase} gives it. The absorbed occurrence, when named, is removed as
 * {@link deletePhrase} removes it.
 *
 * The absorbed occurrence goes first, so that a payload only the two shared stays with the target
 * rather than forking. Nothing is staged when the absorbed occurrence is the target.
 */
export async function mergePhrases(
  buffer: ChangeBuffer,
  { targetPhraseId, tokens, absorbedPhraseId, ...stamp }: MergePhrasesRequest,
): Promise<void> {
  if (absorbedPhraseId !== undefined && absorbedPhraseId === targetPhraseId) return;

  const absorbed =
    absorbedPhraseId === undefined ? undefined : await findPhraseLink(buffer, absorbedPhraseId);
  if (absorbed) await detachPhraseLink(buffer, absorbed);
  const link = await findPhraseLink(buffer, targetPhraseId);
  if (link) await reshapePhrase(buffer, link, tokens, stamp);
}

/**
 * Stages writing a phrase occurrence's gloss in `analysisLanguage`. The edit is per occurrence: a
 * payload other occurrences share is forked first. An edit that makes the payload identical to
 * another folds it into that one.
 *
 * A blank value clears the language's gloss, leaving the phrase in place. Nothing is staged for an
 * unknown occurrence, or one whose payload isn't stored.
 */
export async function writePhraseGloss(
  buffer: ChangeBuffer,
  { phraseId, value, analysisLanguage: lang, ...stamp }: WritePhraseGlossRequest,
): Promise<void> {
  const link = await findPhraseLink(buffer, phraseId);
  const target = link && (await editablePhraseAnalysis(buffer, link, stamp));
  if (!link || !target) return;
  if (value.trim() !== '') {
    if (!target.gloss) target.gloss = {};
    target.gloss[lang] = value;
  } else if (target.gloss) {
    delete target.gloss[lang];
    if (isEmptyMultiString(target.gloss)) delete target.gloss;
  }
  target.updatedAt = stamp.now;
  link.updatedAt = stamp.now;
  buffer.put('phraseAnalyses', target);
  buffer.put('phraseAnalysisLinks', link);
  await mergeIntoIdenticalPhrase(buffer, target);
}

/**
 * Stages approving a phrase occurrence, leaving its `confidence` as recorded. Refused while any of
 * its tokens is in an approved phrase, so that no token ends up in two. Nothing is staged for an
 * unknown or already approved occurrence.
 */
export async function approvePhrase(
  buffer: ChangeBuffer,
  { phraseId, now }: ApprovePhraseRequest,
): Promise<void> {
  const link = await findPhraseLink(buffer, phraseId);
  if (!link || link.status === 'approved') return;
  const { phraseAnalysisLinks } = await buffer.findLinksByToken(
    link.tokens.map(({ tokenRef }) => tokenRef),
  );
  if (phraseAnalysisLinks.some(({ status }) => status === 'approved')) return;
  link.status = 'approved';
  link.updatedAt = now;
  buffer.put('phraseAnalysisLinks', link);
}

/**
 * Stages splitting a phrase occurrence just after `splitAfterTokenRef`, in document order. The
 * first half runs up to and including that token.
 *
 * - When both halves keep two or more tokens, the occurrence shrinks to the first half and the second
 *   becomes a new occurrence, as {@link createPhrase} makes one.
 * - When one half keeps a single token, the occurrence shrinks to the other half and that token is
 *   left in no phrase.
 * - When neither half keeps two tokens, the occurrence is removed.
 *
 * The occurrence shrinks as {@link updatePhrase} reshapes one, and is removed as {@link deletePhrase}
 * removes one. Nothing is staged for an unknown occurrence, a token not in it, or its last token.
 */
export async function splitPhrase(
  buffer: ChangeBuffer,
  { phraseId, splitAfterTokenRef, tokenDocOrder, linkId, analysisId, ...stamp }: SplitPhraseRequest,
): Promise<void> {
  const link = await findPhraseLink(buffer, phraseId);
  if (!link) return;
  const slice = sliceAtBoundary(link.tokens, splitAfterTokenRef, tokenDocOrder);
  if (!slice) return;
  const { before, after } = slice;
  if (after.length === 0) return;
  if (before.length <= 1 && after.length <= 1) {
    await deletePhrase(buffer, { phraseId });
    return;
  }
  if (before.length >= 2 && after.length >= 2) {
    await updatePhrase(buffer, { ...stamp, phraseId, tokens: before });
    await createPhrase(buffer, { tokens: after, linkId, analysisId, now: stamp.now });
    return;
  }
  await updatePhrase(buffer, {
    ...stamp,
    phraseId,
    tokens: before.length >= 2 ? before : after,
  });
}
