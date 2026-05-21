import type { InterlinearProject } from 'interlinearizer';

/** Displayable summary of an interlinear project used across project selection and metadata UI. */
export type InterlinearProjectSummary = Pick<
  InterlinearProject,
  | 'id'
  | 'createdAt'
  | 'sourceProjectId'
  | 'targetProjectId'
  | 'analysisLanguages'
  | 'name'
  | 'description'
>;
