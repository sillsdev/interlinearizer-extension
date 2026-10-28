import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import type { EditStep } from '../types/edit-step';
import type { ChangeBuffer } from './commands/changeBuffer';

/**
 * Reads, ahead of a catalog edit or merge on the row of `analysisId`, what the edit's step will
 * summarize.
 *
 * @returns A function that builds the step from the changes that the edit stages. Its summary names
 *   the row's form and the analysis that holds the row afterward. That is the analysis itself when
 *   the edit keeps it, else the one that its links were folded into, else none.
 */
export async function catalogStepOf(
  buffer: ChangeBuffer,
  kind: 'catalogEdit' | 'catalogMerge',
  analysisId: string,
): Promise<(changes: ChangeSet) => EditStep> {
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  /* v8 ignore next -- an edit of an analysis not stored stages nothing, so records no step */
  const form = analysis?.surfaceText ?? '';
  const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses([analysisId]);
  const linkIds = new Set(tokenAnalysisLinks.map(({ id }) => id));
  return (changes) => {
    const survivingAnalysisId = changes.tokenAnalyses?.deletes.includes(analysisId)
      ? changes.tokenAnalysisLinks?.puts.find(({ id }) => linkIds.has(id))?.analysisId
      : analysisId;
    return {
      summary: {
        kind,
        form,
        analysisId,
        ...(survivingAnalysisId !== undefined && { survivingAnalysisId }),
      },
    };
  };
}

/**
 * Reads, ahead of a deletion of analyses, the step that summarizes it. One analysis is summarized
 * by its form and how many uses it had. Several are summarized by their count and their total
 * uses.
 *
 * @param buffer - The deletion's change buffer, read before the deletion stages.
 * @param repository - The session's repository, holding the draft as the deletion finds it.
 * @param analysisIds - The analyses to delete.
 */
export async function deletionStepOf(
  buffer: ChangeBuffer,
  repository: AnalysisRepository,
  analysisIds: readonly string[],
): Promise<EditStep> {
  const counts = await repository.countApprovals([...analysisIds]);
  if (analysisIds.length > 1) {
    const usageCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { summary: { kind: 'catalogDeleteChecked', count: analysisIds.length, usageCount } };
  }
  const [analysisId] = analysisIds;
  const [analysis] = await buffer.getTokenAnalyses([analysisId]);
  /* v8 ignore next -- deleting an analysis not stored stages nothing, so records no step */
  const form = analysis?.surfaceText ?? '';
  const count = counts[analysisId] ?? 0;
  return {
    summary:
      count === 0
        ? { kind: 'catalogDeleteUnused', form, analysisId }
        : { kind: 'catalogDelete', form, analysisId, count },
  };
}

/**
 * The step of an edit to the phrase occurrence `phraseId`, located at its first token. The step has
 * no location when the occurrence is not stored.
 */
export async function phraseStartOf(buffer: ChangeBuffer, phraseId: string): Promise<EditStep> {
  const [link] = await buffer.getPhraseAnalysisLinks([phraseId]);
  return link ? { location: link.tokens[0].tokenRef } : {};
}
