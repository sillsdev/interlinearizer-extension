import { isTextAnalysis, validateTextAnalysis } from '../types/type-guards';
import type { RepositoryLogger } from '../types/analysis-repository';

/**
 * Logs how an analysis falls short as it crosses the storage boundary — an unreadable shape, or an
 * invariant its collections break — tagged with `description` to name the record and the point it
 * was checked at, e.g. `project abc on save`. Logging is the whole response: the read or the write
 * proceeds either way, since a record that disagrees with itself still renders, and refusing it
 * would cost the user their work over a fault they cannot act on.
 */
export function reportAnalysisViolations(
  logger: RepositoryLogger,
  analysis: unknown,
  description: string,
): void {
  // A stored record is typed but never validated, so its analysis may be absent or misshapen. Only
  // absence is legitimate: a stored null is corruption.
  if (analysis === undefined) return;
  if (!isTextAnalysis(analysis)) {
    logger.warn(`Interlinearizer: ${description} has a structurally invalid analysis`);
    return;
  }
  validateTextAnalysis(analysis).forEach(({ kind, layer, count, sample }) => {
    logger.warn(
      `Interlinearizer: ${description} has ${count} ${layer}-layer ${kind} violation(s): ${sample.join(', ')}`,
    );
  });
}
