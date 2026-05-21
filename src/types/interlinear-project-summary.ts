import type { InterlinearProject } from 'interlinearizer';

/** The subset of InterlinearProject fields this modal displays and returns. */
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

/** Fields of the active interlinear project persisted in WebView state. */
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
