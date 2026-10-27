import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { analysesAreIdentical, normalizeSurfaceForm } from '../../utils/analysis-identity';
import { preferredLink, preferredPayload } from '../../utils/pick-rules';
import { clearAnalysisGloss, isEmptyTokenAnalysis } from '../../utils/token-analysis-content';
import type { ChangeBuffer } from './changeBuffer';

/** What every token edit needs. */
export type TokenEdit = {
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
 * The token's approved link that an approval tie picks, with its payload, or `undefined` when there
 * is none. Approved links that name no stored payload are removed first, so that they never persist
 * or crowd the pick.
 */
export async function resolveApprovedAnalysis(
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
export async function isSharedByOtherTokens(
  buffer: ChangeBuffer,
  link: TokenAnalysisLink,
  analysisId: string,
): Promise<boolean> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  return tokenAnalysisLinks.some(({ token }) => token.tokenRef !== link.token.tokenRef);
}

/**
 * Repoints `link` to a private copy of its shared payload, so that editing the link's token leaves
 * the other tokens alone. The copy is dated by the edit. Staging `link` is left to the caller.
 *
 * @returns The copy, staged.
 */
export function forkSharedAnalysis(
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

/**
 * Detaches `link` from the payload an edit through it emptied, which goes once nothing links it and
 * otherwise stays, emptied, as the edit left it.
 */
export async function detachEmptiedAnalysis(
  buffer: ChangeBuffer,
  analysis: TokenAnalysis,
  link: TokenAnalysisLink,
): Promise<void> {
  buffer.delete('tokenAnalysisLinks', link);
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  if (tokenAnalysisLinks.length === 0) buffer.delete('tokenAnalyses', analysis);
  else buffer.put('tokenAnalyses', analysis);
}

/** Removes the payload once no link of any status names it. */
export async function reclaimIfUnlinked(
  buffer: ChangeBuffer,
  analysis: TokenAnalysis,
): Promise<void> {
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  if (tokenAnalysisLinks.length === 0) buffer.delete('tokenAnalyses', analysis);
}

/**
 * Leaves each token holding one link to `analysisId` where it held several. An approval tie picks
 * the survivor from the token's approved links, or from all the token's links when none is
 * approved. The survivor takes the earliest creation date among the token's links to `analysisId`.
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
 * When the edit made `analysis` identical to another payload, folds it into that one, so that an
 * edit never leaves a duplicate.
 *
 * Every link to `analysis` moves to the survivor. The survivor keeps its own timestamps. A token
 * that links both keeps one link. The survivor's breakdown stays stale only when both payloads'
 * were.
 */
export async function mergeIntoIdenticalPayload(
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
 * Gives a token an approved link to a payload that holds `analysis`'s content. A content-identical
 * stored payload is shared where one exists. Otherwise `analysis` is staged. A non-approved link
 * that the token holds to the shared payload is approved, rather than joined by a second link.
 */
export async function appendApprovedAnalysis(
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
 * Stages writing a token's gloss.
 *
 * The edit is per token: a payload that other tokens share is forked first. An edit that makes the
 * payload identical to another folds it into that one. A rewrite keeps the payload's
 * `glossSenseRef`. A token with no approved analysis takes a content-identical stored one, or a new
 * one.
 *
 * A blank value clears the gloss. A payload that the clear leaves empty goes once nothing links it.
 * A blank write to a token with no approved analysis stages nothing.
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
        await detachEmptiedAnalysis(buffer, target, link);
        return;
      }
    } else {
      target.gloss = { ...target.gloss, [lang]: value };
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
 * Stages approving the stored payload `analysisId` for a token, in place of any approval the token
 * held. Nothing is staged for a payload that isn't stored, or one already approved for the token.
 *
 * A token that holds a non-approved link to the payload has that link approved. The approved link
 * keeps the earlier of its own creation date and the replaced approval's. A token with no approval
 * and no link to the payload gets a new link. The payload that the replaced approval named goes
 * once nothing links it.
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
