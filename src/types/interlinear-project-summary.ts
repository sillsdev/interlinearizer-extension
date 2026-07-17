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
>;

/**
 * Rebuilds a new object holding only the {@link InterlinearProjectSummary} fields. The parameter is
 * statically typed as `InterlinearProjectSummary`, but structural typing lets a full
 * `InterlinearProject` (with its potentially large `analysis`, plus `links` / `segmentation`)
 * satisfy that type, so at runtime the argument may still carry those extra properties. Caching
 * such a value verbatim would persist the whole envelope in WebView state; copying only the summary
 * fields keeps the cached active project lean.
 *
 * @param summary - A value typed as `InterlinearProjectSummary` (e.g. narrowed via
 *   `isInterlinearProjectSummary`) that may carry extra runtime properties from a wider
 *   `InterlinearProject`.
 * @returns A new object containing only the summary fields, with `targetProjectId` / `name` /
 *   `description` present only when they are set on the input.
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
  };
}
