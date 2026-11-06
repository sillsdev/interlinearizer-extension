/** Thrown by an edit that would remove an analysis while keeping a link that names it. */
export class LinkedAnalysisDeleteError extends Error {
  /** The ids of the analyses that the edit would remove while a link still names them. */
  readonly analysisIds: readonly string[];

  constructor(analysisIds: readonly string[]) {
    super(
      `Interlinearizer: an edit would remove analyses that links still name: ${analysisIds.join(', ')}`,
    );
    this.name = 'LinkedAnalysisDeleteError';
    this.analysisIds = analysisIds;
  }
}
