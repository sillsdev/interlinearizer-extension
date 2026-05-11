import type { WebViewProps } from '@papi/core';
import InterlinearizerLoader from './components/InterlinearizerLoader';

/**
 * Root WebView component for the Interlinearizer.
 *
 * @param props - WebView props injected by the PAPI host
 * @param props.projectId - PAPI project ID passed from the host; undefined when the WebView is
 *   opened outside a project context
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 * @param props.useWebViewState - Hook for reading and writing values persisted in the WebView's
 *   saved state (survives tab restores)
 * @returns The full interlinearizer WebView layout
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
  useWebViewState,
}: WebViewProps) {
  return (
    <div className="tw:flex tw:flex-col tw:h-full">
      {projectId ? (
        <InterlinearizerLoader
          projectId={projectId}
          useWebViewScrollGroupScrRef={useWebViewScrollGroupScrRef}
          useWebViewState={useWebViewState}
        />
      ) : (
        <p className="tw:text-sm tw:text-muted-foreground">
          Open this WebView from a Paratext project to load its source book.
        </p>
      )}
    </div>
  );
};
