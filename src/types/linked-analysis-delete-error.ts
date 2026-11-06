/** Thrown by an edit that would leave a link naming an analysis that the edit doesn't store. */
export class LinkedAnalysisDeleteError extends Error {
  /** The ids of the analyses that kept links name but the edit leaves unstored. */
  readonly analysisIds: readonly string[];

  constructor(analysisIds: readonly string[]) {
    super(
      `Interlinearizer: an edit would keep links to analyses it leaves unstored: ${analysisIds.join(', ')}`,
    );
    this.name = 'LinkedAnalysisDeleteError';
    this.analysisIds = analysisIds;
  }
}
