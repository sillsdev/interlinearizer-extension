import type { WebViewProps } from '@papi/core';
import InterlinearizerLoader from './components/InterlinearizerLoader';

/**
 * Root WebView component for the Interlinearizer.
 *
 * @param props.projectId - `undefined` when the WebView is opened outside a project context.
 * @param props.useWebViewScrollGroupScrRef - Exposes the shared scroll-group scripture reference
 *   and its setter.
 * @param props.useWebViewState - Reads and writes values persisted in the WebView's saved state,
 *   which survives tab restores.
 * @param props.updateWebViewDefinition - Forwarded so the loader can toggle the tab's
 *   unsaved-changes title marker.
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
  useWebViewState,
  updateWebViewDefinition,
}: WebViewProps) {
  return (
    <div className="tw:flex tw:flex-col tw:h-full">
      {projectId ? (
        <InterlinearizerLoader
          projectId={projectId}
          useWebViewScrollGroupScrRef={useWebViewScrollGroupScrRef}
          useWebViewState={useWebViewState}
          updateWebViewDefinition={updateWebViewDefinition}
        />
      ) : (
        <p className="tw:text-sm tw:text-muted-foreground">
          Open this WebView from a Paratext project to load its source book.
        </p>
      )}
    </div>
  );
};
