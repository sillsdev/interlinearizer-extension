import type { SegmentAnalysis, SegmentAnalysisLink } from 'interlinearizer';
import { isEmptyMultiString } from '../../utils/multi-string';
import { preferredLink } from '../../utils/pick-rules';
import type { ChangeBuffer } from './changeBuffer';

/** A segment analysis with the link that places it. */
type PlacedSegmentAnalysis = { link: SegmentAnalysisLink; analysis: SegmentAnalysis };

/** What writing a segment's free translation needs. */
export type WriteSegmentFreeTranslationRequest = {
  /** `Segment.id` of the segment translated. */
  segmentId: string;
  /** The segment's current baseline text, refreshed on the analysis the write touches. */
  surfaceText: string;
  /** The free translation. A blank value clears the translation in `analysisLanguage`. */
  value: string;
  /** BCP 47 tag of the language the translation is written in. */
  analysisLanguage: string;
  /**
   * `SegmentAnalysis.id` of the stale translation the value was typed over. The write adopts that
   * translation when the segment holds no approved one. Absent when the value was typed over none.
   */
  adoptStaleAnalysisId?: string;
  /** Id a new segment analysis takes, spent only when the write makes one. */
  analysisId: string;
  /** Id a new link takes, spent only when the write makes one. */
  linkId: string;
  /** ISO 8601 time of the edit, stamped on the records it touches. */
  now: string;
};

/**
 * The segment's approved link that an approval tie picks, with its analysis, or `undefined` when
 * there is none. Approved links that name no stored analysis are removed first, so that they never
 * persist or crowd the pick.
 */
async function resolveApprovedSegmentAnalysis(
  buffer: ChangeBuffer,
  segmentId: string,
): Promise<PlacedSegmentAnalysis | undefined> {
  const approved = (await buffer.findLinksBySegment([segmentId])).filter(
    ({ status }) => status === 'approved',
  );
  const analyses = new Map(
    (await buffer.getSegmentAnalyses(approved.map(({ analysisId }) => analysisId))).map(
      (analysis) => [analysis.id, analysis],
    ),
  );
  approved
    .filter(({ analysisId }) => !analyses.has(analysisId))
    .forEach((orphan) => buffer.delete('segmentAnalysisLinks', orphan));
  const link = preferredLink(approved.filter(({ analysisId }) => analyses.has(analysisId)));
  const analysis = link && analyses.get(link.analysisId);
  return link && analysis ? { link, analysis } : undefined;
}

/**
 * The stale translation that `analysisId` names, with the stale link an approval tie picks among
 * those naming it. Resolves to `undefined` when no stale link names a stored analysis by that id.
 */
async function findStaleSegmentAnalysis(
  buffer: ChangeBuffer,
  analysisId: string,
): Promise<PlacedSegmentAnalysis | undefined> {
  const { segmentAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  const link = preferredLink(segmentAnalysisLinks.filter(({ status }) => status === 'stale'));
  const [analysis] = await buffer.getSegmentAnalyses([analysisId]);
  return link && analysis ? { link, analysis } : undefined;
}

/** Whether a segment analysis carries neither a free nor a literal translation worth keeping. */
function isEmptySegmentAnalysis(analysis: SegmentAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.freeTranslation) && isEmptyMultiString(analysis.literalTranslation)
  );
}

function removeSegmentAnalysis(buffer: ChangeBuffer, { analysis, link }: PlacedSegmentAnalysis) {
  buffer.delete('segmentAnalyses', analysis);
  buffer.delete('segmentAnalysisLinks', link);
}

/**
 * Removes the `lang` free translation from `placed`'s analysis, staging the analysis and its link
 * as they then stand. The two are removed instead once the analysis holds nothing.
 */
function clearFreeTranslation(
  buffer: ChangeBuffer,
  placed: PlacedSegmentAnalysis,
  lang: string,
): void {
  const { analysis, link } = placed;
  if (analysis.freeTranslation) {
    delete analysis.freeTranslation[lang];
    if (Object.keys(analysis.freeTranslation).length === 0) delete analysis.freeTranslation;
  }
  if (isEmptySegmentAnalysis(analysis)) {
    removeSegmentAnalysis(buffer, placed);
    return;
  }
  buffer.put('segmentAnalyses', analysis);
  buffer.put('segmentAnalysisLinks', link);
}

/**
 * Re-approves the stale translation that `analysisId` names, moving its link to `segmentId`, so
 * that a translation whose own segment has vanished lands where it was shown. It stages the link
 * but not the analysis.
 *
 * Resolves to the translation with its approved link. Resolves to `undefined` when `analysisId`
 * names no stale translation, or when `segmentId` already holds an approved one.
 */
async function approveStaleSegmentAnalysis(
  buffer: ChangeBuffer,
  segmentId: string,
  analysisId: string,
  now: string,
): Promise<PlacedSegmentAnalysis | undefined> {
  const links = await buffer.findLinksBySegment([segmentId]);
  /* v8 ignore next -- a write adopts only once the segment holds no approved link */
  if (links.some(({ status }) => status === 'approved')) return undefined;
  const stale = await findStaleSegmentAnalysis(buffer, analysisId);
  if (!stale) return undefined;
  stale.link.status = 'approved';
  stale.link.segmentId = segmentId;
  stale.link.updatedAt = now;
  buffer.put('segmentAnalysisLinks', stale.link);
  return stale;
}

/**
 * Stages writing a segment's free translation in `analysisLanguage`.
 *
 * - The segment's approved translation is updated in place, and its surface text refreshed.
 * - A segment with none adopts the stale translation `adoptStaleAnalysisId` names, approving it for
 *   the segment, so that the stale translation's other languages carry over.
 * - Otherwise, a new approved translation is made.
 *
 * A blank value clears the language's translation, removing the analysis and its link once nothing
 * is left. On a segment with no approved translation, a blank value clears the named stale
 * translation the same way and leaves it stale. A blank value never makes a record.
 *
 * Approved links on the segment that name no stored analysis are removed.
 */
export async function writeSegmentFreeTranslation(
  buffer: ChangeBuffer,
  {
    segmentId,
    surfaceText,
    value,
    analysisLanguage: lang,
    adoptStaleAnalysisId,
    analysisId,
    linkId,
    now,
  }: WriteSegmentFreeTranslationRequest,
): Promise<void> {
  const isBlank = value.trim() === '';

  const approved = await resolveApprovedSegmentAnalysis(buffer, segmentId);
  if (!approved && isBlank) {
    const stale =
      adoptStaleAnalysisId === undefined
        ? undefined
        : await findStaleSegmentAnalysis(buffer, adoptStaleAnalysisId);
    if (!stale) return;
    stale.analysis.updatedAt = now;
    stale.link.updatedAt = now;
    clearFreeTranslation(buffer, stale, lang);
    return;
  }

  const resolved =
    approved ??
    (adoptStaleAnalysisId === undefined
      ? undefined
      : await approveStaleSegmentAnalysis(buffer, segmentId, adoptStaleAnalysisId, now));
  if (resolved) {
    const { link, analysis } = resolved;
    analysis.surfaceText = surfaceText;
    analysis.updatedAt = now;
    link.updatedAt = now;
    if (isBlank) {
      clearFreeTranslation(buffer, resolved, lang);
      return;
    }
    if (!analysis.freeTranslation) analysis.freeTranslation = {};
    analysis.freeTranslation[lang] = value;
    buffer.put('segmentAnalyses', analysis);
    buffer.put('segmentAnalysisLinks', link);
    return;
  }

  buffer.create('segmentAnalyses', {
    id: analysisId,
    createdAt: now,
    updatedAt: now,
    surfaceText,
    freeTranslation: { [lang]: value },
  });
  buffer.create('segmentAnalysisLinks', {
    id: linkId,
    analysisId,
    createdAt: now,
    updatedAt: now,
    status: 'approved',
    segmentId,
  });
}
