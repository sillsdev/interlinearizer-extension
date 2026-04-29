import type { WebViewProps } from '@papi/core';
import { useProjectData } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';

/**
 * Fetches and displays the USJ book data for the given project and scripture reference. Shows a
 * loading indicator while data is in flight, an error message if the fetch fails or returns no
 * data, and the raw JSON of the book otherwise.
 *
 * @param projectId - The Platform.Bible project ID whose USJ book data is fetched.
 * @param scrRef - The current scripture reference from the scroll group, used to select the book.
 * @returns A JSX element displaying the book data, a loading state, or an error message.
 */
function ProjectBookFetcher({
  projectId,
  scrRef,
}: Readonly<{
  projectId: string;
  scrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[0];
}>) {
  const [bookResult, , isLoading] = useProjectData('platformScripture.USJ_Book', projectId).BookUSJ(
    scrRef,
    undefined,
  );

  let bookUsj: typeof bookResult | undefined;
  let bookError: string | undefined;

  if (isPlatformError(bookResult)) {
    bookError = bookResult.message;
  } else if (!isLoading && bookResult === undefined) {
    bookError = `No USJ book available for ${scrRef.book} in project ${projectId}`;
  } else {
    bookUsj = bookResult;
  }

  return (
    <>
      <p className="tw-text-sm tw-text-muted-foreground">
        {scrRef.book} · project <code>{projectId}</code>
      </p>

      {bookError && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Error loading book</h2>
          <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
            {bookError}
          </pre>
        </div>
      )}

      {!bookError && (
        <pre className="tw-overflow-auto tw-rounded-md tw-border tw-border-border tw-bg-muted tw-p-4 tw-text-sm tw-font-mono tw-leading-relaxed">
          {isLoading ? 'Loading…' : JSON.stringify(bookUsj, undefined, 2)}
        </pre>
      )}
    </>
  );
}

/**
 * Root WebView component for the Interlinearizer. Reads the scroll-group scripture reference and
 * delegates book fetching to {@link ProjectBookFetcher}. Shows a placeholder when no projectId is
 * provided (i.e. the WebView was opened without a project).
 *
 * @param projectId - The Platform.Bible project ID passed via WebView props; `undefined` when the
 *   WebView was opened without a project context.
 * @param useWebViewScrollGroupScrRef - PAPI hook that provides the current scroll-group scripture
 *   reference.
 * @returns A JSX element for the Interlinearizer root view.
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const [scrRef] = useWebViewScrollGroupScrRef();

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-6">
      <h1 className="tw-text-2xl tw-font-semibold tw-tracking-tight">Interlinearizer</h1>

      {projectId ? (
        <ProjectBookFetcher projectId={projectId} scrRef={scrRef} />
      ) : (
        <p className="tw-text-sm tw-text-muted-foreground">
          Open this WebView from a Paratext project to load its source book.
        </p>
      )}
    </div>
  );
};
