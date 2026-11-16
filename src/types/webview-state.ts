import type { InterlinearProjectSummary } from './interlinear-project-summary';

/** The WebView state entries that the extension host seeds into a new tab or reads back from one. */
export type InterlinearizerWebViewState = {
  /**
   * The tab's active interlinear project, kept across tab restores. A new tab on the same source
   * opens on the source's last active project.
   */
  activeProject: InterlinearProjectSummary | undefined;
  /**
   * Whether the tab should offer converting the source's Paratext 9 interlinear data. Set on an
   * explicit open when the source has no interlinearizer state stored yet. The tab shows the offer
   * only when the source holds convertible data. Answering the offer clears it.
   */
  offerPt9Import: boolean;
};
