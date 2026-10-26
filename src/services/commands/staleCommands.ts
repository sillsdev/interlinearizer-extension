import type {
  SegmentAnalysis,
  SegmentAnalysisLink,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { analysesAreIdentical, normalizeSurfaceForm } from '../../utils/analysis-identity';
import { preferredLink, preferredPayload } from '../../utils/pick-rules';
import type { ChangeBuffer } from './changeBuffer';
import {
  approveAnalysisForToken,
  reclaimIfUnlinked,
  resolveApprovedAnalysis,
  type TokenEdit,
} from './tokenCommands';

/** What giving up a place an analysis went stale at needs. */
export type DiscardStaleAnalysisRequest = {
  /** The token analysis the stale link names. */
  analysisId: string;
  /** `Token.ref` the stale link names. */
  tokenRef: string;
};

/** What moving an analysis from a place it went stale at onto a token needs. */
export type ReapplyStaleAnalysisRequest = TokenEdit & {
  /** The token analysis the stale link names. */
  analysisId: string;
  /** `Token.ref` the stale link names. */
  staleTokenRef: string;
  /** Id a copy under the token's spelling takes, spent only when the reapply makes one. */
  copyId: string;
};

function isStaleLinkTo(link: TokenAnalysisLink, analysisId: string): boolean {
  return link.status === 'stale' && link.analysisId === analysisId;
}

/**
 * Stages dropping the stale links to `analysisId` at `tokenRef`, leaving the analysis's other
 * places alone. The payload goes once no link of any status names it. Nothing is staged when no
 * such stale link exists.
 */
export async function discardStaleAnalysis(
  buffer: ChangeBuffer,
  { analysisId, tokenRef }: DiscardStaleAnalysisRequest,
): Promise<void> {
  const { tokenAnalysisLinks } = await buffer.findLinksByToken([tokenRef]);
  const stale = tokenAnalysisLinks.filter((link) => isStaleLinkTo(link, analysisId));
  if (stale.length === 0) return;
  stale.forEach((link) => buffer.delete('tokenAnalysisLinks', link));
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (analysis) await reclaimIfUnlinked(buffer, analysis);
}

/**
 * A copy of `analysis`'s content under the spelling `surfaceText`, its breakdown fitted to that
 * spelling.
 */
function copyUnderSpelling(
  analysis: TokenAnalysis,
  surfaceText: string,
  copyId: string,
  now: string,
): TokenAnalysis {
  const copy: TokenAnalysis = {
    ...analysis,
    id: copyId,
    surfaceText,
    createdAt: now,
    updatedAt: now,
  };
  const [only, ...rest] = copy.morphemes ?? [];
  if (
    only &&
    rest.length === 0 &&
    !only.entryRef &&
    normalizeSurfaceForm(only.form) === normalizeSurfaceForm(analysis.surfaceText)
  )
    copy.morphemes = [{ ...only, form: surfaceText }];
  if (rest.length > 0) copy.morphemesStale = true;
  return copy;
}

/**
 * Stages moving the analysis `analysisId` from a place it went stale at onto a token, approving it
 * there in place of whatever that token held.
 *
 * A token spelled differently from the analysis takes a copy of the analysis's content under the
 * token's own spelling. A breakdown that is the old word whole as one morpheme takes the new
 * spelling, unless it names a lexicon entry. A breakdown of several morphemes keeps its forms and
 * is marked stale. A stored payload identical to the copy is adopted rather than duplicated.
 *
 * The stale link goes either way. The analysis goes once nothing links it. When the token is the
 * place the analysis went stale at, the approval takes over the stale link's confidence. The
 * approval also takes the stale link's creation date when that date is earlier.
 *
 * Nothing is staged when no stale link to `analysisId` sits at `staleTokenRef`, or the analysis
 * isn't stored.
 */
export async function reapplyStaleAnalysis(
  buffer: ChangeBuffer,
  request: ReapplyStaleAnalysisRequest,
): Promise<void> {
  const { analysisId, staleTokenRef, tokenRef, surfaceText, copyId, now } = request;
  const { tokenAnalysisLinks } = await buffer.findLinksByToken([staleTokenRef]);
  const stale = preferredLink(tokenAnalysisLinks.filter((link) => isStaleLinkTo(link, analysisId)));
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  if (!stale || !analysis) return;
  buffer.delete('tokenAnalysisLinks', stale);

  let approvedId = analysisId;
  if (normalizeSurfaceForm(analysis.surfaceText) !== normalizeSurfaceForm(surfaceText)) {
    const copy = copyUnderSpelling(analysis, surfaceText, copyId, now);
    const candidates = await buffer.findTokenAnalysesByForm([normalizeSurfaceForm(surfaceText)]);
    const identical = preferredPayload(candidates.filter((ta) => analysesAreIdentical(ta, copy)));
    if (identical) approvedId = identical.id;
    else {
      buffer.create('tokenAnalyses', copy);
      approvedId = copyId;
    }
  }
  await approveAnalysisForToken(buffer, { ...request, analysisId: approvedId });
  if (staleTokenRef === tokenRef) {
    const approved = (await resolveApprovedAnalysis(buffer, tokenRef))?.link;
    /* v8 ignore next -- the approval just made always stands */
    if (approved) {
      if (stale.createdAt < approved.createdAt) approved.createdAt = stale.createdAt;
      if (stale.confidence) approved.confidence = stale.confidence;
      else delete approved.confidence;
      buffer.put('tokenAnalysisLinks', approved);
    }
  }
  await reclaimIfUnlinked(buffer, analysis);
}

/** What keeping a stale free translation for a segment needs. */
export type KeepStaleFreeTranslationRequest = {
  /** The stale segment analysis being kept. */
  analysisId: string;
  /** `Segment.id` of the segment it is kept for. */
  segmentId: string;
  /** Current baseline text of that segment, which the translation is kept as a claim about. */
  surfaceText: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/**
 * The stale translation `analysisId` with its stale link, or `undefined` when there is none. The
 * link is the translation's only one: every writer gives a segment analysis exactly one link.
 * Nothing checks this convention.
 */
async function findStaleTranslation(
  buffer: ChangeBuffer,
  analysisId: string,
): Promise<{ link: SegmentAnalysisLink; analysis: SegmentAnalysis } | undefined> {
  const { segmentAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  const link = preferredLink(segmentAnalysisLinks.filter(({ status }) => status === 'stale'));
  const [analysis] = await buffer.getSegmentAnalyses([analysisId]);
  return link && analysis ? { link, analysis } : undefined;
}

/**
 * Stages keeping the stale free translation `analysisId` as a claim about the current text of
 * `segmentId`, the segment it was shown in. The translation is approved for that segment and
 * restamped with the segment's text. The translation's link moves to `segmentId`, so a translation
 * whose own segment has vanished lands where it was shown. Nothing is staged when the segment
 * already holds an approved translation, or `analysisId` names no stale one.
 */
export async function keepStaleFreeTranslation(
  buffer: ChangeBuffer,
  { analysisId, segmentId, surfaceText, now }: KeepStaleFreeTranslationRequest,
): Promise<void> {
  const held = await buffer.findLinksBySegment([segmentId]);
  if (held.some(({ status }) => status === 'approved')) return;
  const stale = await findStaleTranslation(buffer, analysisId);
  if (!stale) return;
  const { link, analysis } = stale;
  buffer.put('segmentAnalysisLinks', { ...link, status: 'approved', segmentId, updatedAt: now });
  buffer.put('segmentAnalyses', { ...analysis, surfaceText, updatedAt: now });
}

/** What discarding a stale free translation needs. */
export type DiscardStaleFreeTranslationRequest = {
  /** The stale segment analysis to drop. */
  analysisId: string;
};

/**
 * Stages dropping the stale free translation `analysisId` with its link. A translation of a verse
 * the book no longer holds is dropped like any other. Nothing is staged when the translation isn't
 * stale.
 */
export async function discardStaleFreeTranslation(
  buffer: ChangeBuffer,
  { analysisId }: DiscardStaleFreeTranslationRequest,
): Promise<void> {
  const stale = await findStaleTranslation(buffer, analysisId);
  if (!stale) return;
  buffer.delete('segmentAnalysisLinks', stale.link);
  buffer.delete('segmentAnalyses', stale.analysis);
}
