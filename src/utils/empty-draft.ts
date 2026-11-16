import type { DraftProject } from 'interlinearizer';
import { isEmptyDelta } from './segmentation';

/** Whether `draft` holds no analysis and no boundary edits. */
export function isEmptyDraft({
  analysis,
  segmentation,
}: Pick<DraftProject, 'analysis' | 'segmentation'>): boolean {
  return (
    Object.values(analysis).every((records) => records.length === 0) && isEmptyDelta(segmentation)
  );
}
