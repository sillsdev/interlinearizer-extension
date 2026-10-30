import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';

/** The part of a draft that undo and discard restore. */
export type DraftContent = Readonly<{
  analysis: TextAnalysis;
  segmentation: SegmentationDelta | undefined;
}>;
