import type { WarningLogger } from '../types/analysis-repository';
import { isTextAnalysis, validateTextAnalysis } from '../types/type-guards';

/**
 * Logs, tagged with `description`, how an analysis falls short at the storage boundary: an
 * unreadable shape, or an invariant its collections break. The tag names the record and where it
 * was checked, e.g. `project abc on save`.
 *
 * Logging is the whole response, and the load or save proceeds. A record that disagrees with itself
 * still renders, and refusing it would cost the user work over a fault they cannot act on.
 */
export function reportAnalysisViolations(
  logger: WarningLogger,
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
