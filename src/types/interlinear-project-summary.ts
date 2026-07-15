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
 * Projects a summary-shaped value down to exactly the {@link InterlinearProjectSummary} fields,
 * dropping any extra properties. Command responses that return a full `InterlinearProject` (with
 * its potentially large `analysis`, plus `links` / `segmentation`) are structurally assignable to
 * `InterlinearProjectSummary`, so caching one verbatim would persist the whole envelope in WebView
 * state. This copies only the summary fields so the cached active project stays lean.
 *
 * @param summary - A value already narrowed to `InterlinearProjectSummary` (e.g. via
 *   `isInterlinearProjectSummary`); it may still carry extra runtime properties.
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
