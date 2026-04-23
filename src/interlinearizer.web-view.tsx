import type { WebViewProps } from '@papi/core';
import { useProjectData } from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';

function ProjectBookFetcher({
  projectId,
  scrRef,
}: {
  projectId: string;
  scrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[0];
}) {
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
