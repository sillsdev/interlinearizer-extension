import type { InterlinearProject } from 'interlinearizer';

/** Displayable summary of an interlinear project used across project selection and metadata UI. */
export type InterlinearProjectSummary = Pick<
  InterlinearProject,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'sourceProjectId'
  | 'targetProjectId'
  | 'analysisLanguages'
  | 'name'
  | 'description'
  | 'pt9Import'
>;

/**
 * Copies out just the {@link InterlinearProjectSummary} fields, dropping any extra ones.
 *
 * Structural typing lets a full {@link InterlinearProject} — with its potentially large `analysis`,
 * `links`, and `segmentation` — satisfy the parameter type, so the argument may carry far more at
 * runtime than the type admits. Caching such a value verbatim would persist the whole envelope in
 * WebView state; rebuilding keeps the cached project lean.
 *
 * @returns A new object whose optional fields are present only when set on the input.
 */
export function toProjectSummary(summary: InterlinearProjectSummary): InterlinearProjectSummary {
  return {
    id: summary.id,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    sourceProjectId: summary.sourceProjectId,
    analysisLanguages: summary.analysisLanguages,
    ...(summary.targetProjectId !== undefined && { targetProjectId: summary.targetProjectId }),
    ...(summary.name !== undefined && { name: summary.name }),
    ...(summary.description !== undefined && { description: summary.description }),
    ...(summary.pt9Import !== undefined && { pt9Import: summary.pt9Import }),
  };
}
