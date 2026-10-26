import papi from '@papi/frontend';
import type { OpenableProject } from '../hooks/useDraftProject';
import {
  isInterlinearProjectSummary,
  isSegmentationDelta,
  isTextAnalysis,
} from '../types/type-guards';

/**
 * Reads the stored interlinear project that `projectId` names, with its analysis and any stored
 * segment boundaries.
 *
 * @returns The project, or `undefined` when it is missing or malformed.
 * @throws If the `interlinearizer.getProject` command rejects, or its reply is not JSON.
 */
export async function readOpenableProject(projectId: string): Promise<OpenableProject | undefined> {
  const json = await papi.commands.sendCommand('interlinearizer.getProject', projectId);
  const parsed: unknown = json ? JSON.parse(json) : undefined;
  if (!isInterlinearProjectSummary(parsed)) return undefined;
  const analysis = 'analysis' in parsed ? parsed.analysis : undefined;
  const segmentation = 'segmentation' in parsed ? parsed.segmentation : undefined;
  if (!isTextAnalysis(analysis)) return undefined;
  if (segmentation !== undefined && !isSegmentationDelta(segmentation)) return undefined;
  return {
    analysisLanguages: parsed.analysisLanguages,
    ...(parsed.targetProjectId !== undefined && { targetProjectId: parsed.targetProjectId }),
    ...(segmentation !== undefined && { segmentation }),
    analysis,
  };
}
