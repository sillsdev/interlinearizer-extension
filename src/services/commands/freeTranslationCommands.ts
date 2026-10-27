import type { SegmentAnalysis, SegmentAnalysisLink } from 'interlinearizer';
import { isEmptyMultiString } from '../../utils/multi-string';
import { preferredLink } from '../../utils/pick-rules';
import type { ChangeBuffer } from './changeBuffer';
import {
  approveStaleTranslation,
  findStaleTranslation,
  type PlacedTranslation,
} from './staleCommands';

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
 * Finds the segment's approved translation, as an approval tie picks it.
 *
 * @returns `approved`, absent when no approved link on the segment names a stored analysis.
 *   `orphans` lists the segment's approved links that name none.
 */
async function findApprovedSegmentAnalysis(
  buffer: ChangeBuffer,
  segmentId: string,
): Promise<{ approved?: PlacedTranslation; orphans: SegmentAnalysisLink[] }> {
  const links = (await buffer.findLinksBySegment([segmentId])).filter(
    ({ status }) => status === 'approved',
  );
  const analyses = new Map(
    (await buffer.getSegmentAnalyses(links.map(({ analysisId }) => analysisId))).map((analysis) => [
      analysis.id,
      analysis,
    ]),
  );
  const orphans = links.filter(({ analysisId }) => !analyses.has(analysisId));
  const link = preferredLink(links.filter(({ analysisId }) => analyses.has(analysisId)));
  const analysis = link && analyses.get(link.analysisId);
  return { approved: link && analysis ? { link, analysis } : undefined, orphans };
}

/** Whether a segment analysis carries neither a free nor a literal translation worth keeping. */
function isEmptySegmentAnalysis(analysis: SegmentAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.freeTranslation) && isEmptyMultiString(analysis.literalTranslation)
  );
}

/**
 * Removes the `lang` free translation from `placed`'s analysis, staging the analysis and its link
 * as they then stand. Once the analysis holds nothing, the link is removed instead, with the
 * analysis unless another link names it.
 */
async function clearFreeTranslation(
  buffer: ChangeBuffer,
  placed: PlacedTranslation,
  lang: string,
): Promise<void> {
  const { analysis, link } = placed;
  if (analysis.freeTranslation) {
    delete analysis.freeTranslation[lang];
    if (Object.keys(analysis.freeTranslation).length === 0) delete analysis.freeTranslation;
  }
  if (!isEmptySegmentAnalysis(analysis)) {
    buffer.put('segmentAnalyses', analysis);
    buffer.put('segmentAnalysisLinks', link);
    return;
  }
  buffer.delete('segmentAnalysisLinks', link);
  const { segmentAnalysisLinks } = await buffer.findLinksToAnalyses([analysis.id]);
  if (segmentAnalysisLinks.length > 0) buffer.put('segmentAnalyses', analysis);
  else buffer.delete('segmentAnalyses', analysis);
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
 * is left. An analysis that another link names is kept. On a segment with no approved translation,
 * a blank value clears the named stale translation the same way and leaves it stale. A blank value
 * never makes a record.
 *
 * Nothing is staged when the language's translation would come out as it was, unless a stale
 * translation is adopted. Otherwise, approved links on the segment that name no stored analysis are
 * removed.
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

  const { approved, orphans } = await findApprovedSegmentAnalysis(buffer, segmentId);
  const removeOrphans = () =>
    orphans.forEach((orphan) => buffer.delete('segmentAnalysisLinks', orphan));
  if (!approved && isBlank) {
    const stale =
      adoptStaleAnalysisId === undefined
        ? undefined
        : await findStaleTranslation(buffer, adoptStaleAnalysisId);
    if (!stale || stale.analysis.freeTranslation?.[lang] === undefined) return;
    removeOrphans();
    stale.analysis.updatedAt = now;
    stale.link.updatedAt = now;
    await clearFreeTranslation(buffer, stale, lang);
    return;
  }
  if (approved && approved.analysis.freeTranslation?.[lang] === (isBlank ? undefined : value))
    return;
  removeOrphans();

  const resolved =
    approved ??
    (adoptStaleAnalysisId === undefined
      ? undefined
      : await approveStaleTranslation(buffer, segmentId, adoptStaleAnalysisId, now));
  if (resolved) {
    const { link, analysis } = resolved;
    analysis.surfaceText = surfaceText;
    analysis.updatedAt = now;
    link.updatedAt = now;
    if (isBlank) {
      await clearFreeTranslation(buffer, resolved, lang);
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
