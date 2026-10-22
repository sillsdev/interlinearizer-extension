import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { analysesAreIdentical, normalizeSurfaceForm } from '../../utils/analysis-identity';
import { preferredLink, preferredPayload } from '../../utils/pick-rules';
import { clearAnalysisGloss, isEmptyTokenAnalysis } from '../../utils/token-analysis-content';
import type { ChangeBuffer } from './changeBuffer';

/** Where and when a token edit lands. */
type TokenEdit = {
  /** `Token.ref` of the token edited. */
  tokenRef: string;
  /** The token's current surface text, refreshed on the records the edit touches. */
  surfaceText: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
  /** Id a new link takes, spent only when the edit makes one. */
  linkId: string;
};

/** What writing a token's gloss needs. */
export type WriteGlossRequest = TokenEdit & {
  /** The gloss; blank clears the token's gloss in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the gloss is written in. */
  analysisLanguage: string;
  /** Id a new token analysis takes, spent only when the write makes one. */
  analysisId: string;
};

/** What approving a stored analysis for a token needs. */
export type ApproveAnalysisRequest = TokenEdit & {
  /** The stored token analysis to approve. */
  analysisId: string;
};

/**
 * The token's approved link an approval tie picks, with its payload. Approved links naming no
 * stored payload are removed first, so they never persist or crowd the pick.
 */
async function resolveApprovedAnalysis(
  buffer: ChangeBuffer,
  tokenRef: string,
): Promise<{ link: TokenAnalysisLink; analysis: TokenAnalysis } | undefined> {
  const { tokenAnalysisLinks } = await buffer.findLinksByToken([tokenRef]);
  const approved = tokenAnalysisLinks.filter(({ status }) => status === 'approved');
  const payloads = new Map(
    (await buffer.getTokenAnalyses(approved.map(({ analysisId }) => analysisId))).map(
      (analysis) => [analysis.id, analysis],
    ),
  );
  approved
    .filter(({ analysisId }) => !payloads.has(analysisId))
    .forEach((orphan) => buffer.delete('tokenAnalysisLinks', orphan));
  const link = preferredLink(approved.filter(({ analysisId }) => payloads.has(analysisId)));
  const analysis = link && payloads.get(link.analysisId);
  return link && analysis ? { link, analysis } : undefined;
}

/** Whether a token other than `link`'s links the payload `analysisId`, at any status. */
async function isSharedByOtherTokens(
  buffer: ChangeBuffer,
  link: TokenAnalysisLink,
  analysisId: string,
): Promise<boolean> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  return tokenAnalysisLinks.some(({ token }) => token.tokenRef !== link.token.tokenRef);
}

/**
 * Moves `link` onto a private copy of its shared payload, so an edit aimed at its token leaves the
 * others reading what they did. The copy is dated by the edit, being a record of its own.
 *
 * @returns The copy, staged; `link` is repointed but left for the caller to stage.
 */
function forkSharedAnalysis(
  buffer: ChangeBuffer,
  link: TokenAnalysisLink,
  analysis: TokenAnalysis,
  forkId: string,
  now: string,
): TokenAnalysis {
  const fork: TokenAnalysis = { ...analysis, id: forkId, createdAt: now, updatedAt: now };
  buffer.create('tokenAnalyses', fork);
  link.analysisId = forkId;
  return fork;
}

/**
 * Approves the non-approved link `tokenRef` holds to `analysisId`, so a token taking on a record it
 * was offered keeps one link to it. The link keeps its creation date and `confidence`.
 *
 * @returns The approved link, staged, or `undefined` when the token holds no such link.
 */
async function approveHeldLink(
  buffer: ChangeBuffer,
  tokenRef: string,
  analysisId: string,
  surfaceText: string,
  now: string,
): Promise<TokenAnalysisLink | undefined> {
  const { tokenAnalysisLinks } = await buffer.findLinksByToken([tokenRef]);
  const held = preferredLink(
    tokenAnalysisLinks.filter((l) => l.status !== 'approved' && l.analysisId === analysisId),
  );
  if (!held) return undefined;
  held.status = 'approved';
  held.token.surfaceText = surfaceText;
  held.updatedAt = now;
  buffer.put('tokenAnalysisLinks', held);
  return held;
}

/** Removes the payload once no link of any status names it. */
async function reclaimIfUnlinked(buffer: ChangeBuffer, analysis: TokenAnalysis): Promise<void> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  if (tokenAnalysisLinks.length === 0) buffer.delete('tokenAnalyses', analysis);
}

/**
 * Leaves each token holding one link to `analysisId` where it held several. The token keeps its
 * approved link over any other, then the one an approval tie picks, and the survivor keeps the
 * token's first annotation date.
 */
async function coalesceLinksPerToken(buffer: ChangeBuffer, analysisId: string): Promise<void> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  const byToken = new Map<string, TokenAnalysisLink[]>();
  tokenAnalysisLinks.forEach((link) => {
    byToken.set(link.token.tokenRef, [...(byToken.get(link.token.tokenRef) ?? []), link]);
  });
  byToken.forEach((links) => {
    const kept =
      preferredLink(links.filter(({ status }) => status === 'approved')) ?? preferredLink(links);
    /* v8 ignore next -- every token's group holds a link */
    if (!kept) return;
    const createdAt = links.reduce(
      (earliest, link) => (link.createdAt < earliest ? link.createdAt : earliest),
      kept.createdAt,
    );
    links.forEach((link) => {
      if (link !== kept) buffer.delete('tokenAnalysisLinks', link);
    });
    if (kept.createdAt !== createdAt) buffer.put('tokenAnalysisLinks', { ...kept, createdAt });
  });
}

/**
 * Folds the just-edited payload into a content-identical one where the edit made one, so an edit
 * never leaves the duplicate a first write's find-or-create avoids. Every link to the edited
 * payload moves to the survivor, which keeps its own timestamps, and a token linking both keeps one
 * link. The survivor's breakdown stays stale only when both payloads' were.
 */
async function mergeIntoIdenticalPayload(
  buffer: ChangeBuffer,
  analysis: TokenAnalysis,
  now: string,
): Promise<void> {
  const candidates = await buffer.findTokenAnalysesByForm([
    normalizeSurfaceForm(analysis.surfaceText),
  ]);
  const other = preferredPayload(
    candidates.filter((ta) => ta.id !== analysis.id && analysesAreIdentical(ta, analysis)),
  );
  if (!other) return;
  if (other.morphemesStale && !analysis.morphemesStale) {
    delete other.morphemesStale;
    other.updatedAt = now;
    buffer.put('tokenAnalyses', other);
  }
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  tokenAnalysisLinks.forEach((link) =>
    buffer.put('tokenAnalysisLinks', { ...link, analysisId: other.id }),
  );
  await coalesceLinksPerToken(buffer, other.id);
  buffer.delete('tokenAnalyses', analysis);
}

/**
 * Links a token to an approved payload holding `analysis`'s content, sharing a content-identical
 * stored one where there is one and staging `analysis` otherwise. A non-approved link the token
 * holds to the shared payload is approved rather than joined by a second.
 */
async function appendApprovedAnalysis(
  buffer: ChangeBuffer,
  analysis: TokenAnalysis,
  { tokenRef, now, linkId }: TokenEdit,
): Promise<void> {
  const candidates = await buffer.findTokenAnalysesByForm([
    normalizeSurfaceForm(analysis.surfaceText),
  ]);
  const existing = preferredPayload(candidates.filter((ta) => analysesAreIdentical(ta, analysis)));
  if (!existing) buffer.create('tokenAnalyses', analysis);
  else if (await approveHeldLink(buffer, tokenRef, existing.id, analysis.surfaceText, now)) return;
  buffer.create('tokenAnalysisLinks', {
    id: linkId,
    analysisId: existing?.id ?? analysis.id,
    createdAt: now,
    updatedAt: now,
    status: 'approved',
    token: { tokenRef, surfaceText: analysis.surfaceText },
  });
}

/**
 * Stages writing a token's gloss. The edit is per token: a payload other tokens share is forked
 * first. An edit that makes the payload identical to another folds it in. A token with no approved
 * analysis takes a content-identical stored one, or a new one. A blank value clears the gloss, and
 * a payload left empty goes once nothing links it; a blank write to a token with no approved
 * analysis stages nothing.
 */
export async function writeGloss(buffer: ChangeBuffer, request: WriteGlossRequest): Promise<void> {
  const { tokenRef, surfaceText, value, analysisLanguage: lang, analysisId, now } = request;
  const isBlank = value.trim() === '';

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
    if (isBlank) {
      clearAnalysisGloss(target, lang);
      if (isEmptyTokenAnalysis(target)) {
        buffer.delete('tokenAnalysisLinks', link);
        const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([target.id]);
        if (tokenAnalysisLinks.length === 0) buffer.delete('tokenAnalyses', target);
        else buffer.put('tokenAnalyses', target);
        return;
      }
    } else {
      target.gloss = { ...target.gloss, [lang]: value };
      delete target.glossSenseRef;
    }
    buffer.put('tokenAnalyses', target);
    buffer.put('tokenAnalysisLinks', link);
    await mergeIntoIdenticalPayload(buffer, target, now);
    return;
  }

  if (isBlank) return;
  await appendApprovedAnalysis(
    buffer,
    { id: analysisId, createdAt: now, updatedAt: now, surfaceText, gloss: { [lang]: value } },
    request,
  );
}

/**
 * Stages approving the stored payload `analysisId` for a token, in place of any approval it held.
 * The payload that approval named goes once nothing links it. A token holding a non-approved link
 * to the payload has that link approved, keeping the earlier creation date of the two; one holding
 * neither gets a new link. It stages nothing for a payload not stored, or one already approved for
 * the token.
 */
export async function approveAnalysisForToken(
  buffer: ChangeBuffer,
  { tokenRef, surfaceText, analysisId, now, linkId }: ApproveAnalysisRequest,
): Promise<void> {
  if ((await buffer.getTokenAnalyses([analysisId])).length === 0) return;
  const resolved = await resolveApprovedAnalysis(buffer, tokenRef);
  if (resolved?.link.analysisId === analysisId) return;

  const pending = await approveHeldLink(buffer, tokenRef, analysisId, surfaceText, now);
  if (pending) {
    if (resolved) {
      if (resolved.link.createdAt < pending.createdAt) {
        buffer.put('tokenAnalysisLinks', { ...pending, createdAt: resolved.link.createdAt });
      }
      buffer.delete('tokenAnalysisLinks', resolved.link);
    }
  } else if (resolved) {
    const { link } = resolved;
    link.analysisId = analysisId;
    link.token.surfaceText = surfaceText;
    link.updatedAt = now;
    buffer.put('tokenAnalysisLinks', link);
  } else {
    buffer.create('tokenAnalysisLinks', {
      id: linkId,
      analysisId,
      createdAt: now,
      updatedAt: now,
      status: 'approved',
      token: { tokenRef, surfaceText },
    });
  }

  if (resolved) await reclaimIfUnlinked(buffer, resolved.analysis);
}
