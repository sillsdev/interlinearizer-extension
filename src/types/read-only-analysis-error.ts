/** Thrown by an edit to analysis that is read-only, as a Paratext 9 import is. */
export class ReadOnlyAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadOnlyAnalysisError';
  }
}
