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

/** Interlinear project fields persisted in Web View state for the currently selected project. */
export type ActiveProjectState = Pick<
  InterlinearProjectSummary,
  | 'id'
  | 'createdAt'
  | 'name'
  | 'description'
  | 'sourceProjectId'
  | 'targetProjectId'
  | 'analysisLanguages'
>;
