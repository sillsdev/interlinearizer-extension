import type { WebViewProps } from '@papi/core';
import {
  useProjectData,
  useProjectSetting,
  useLocalizedStrings,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';
import { useMemo } from 'react';
import { BookChapterControl, BOOK_CHAPTER_CONTROL_STRING_KEYS } from 'platform-bible-react';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import type { Segment } from 'interlinearizer';

/** Renders the tokens of a single segment as inline chips. */
function SegmentView({ segment }: { segment: Segment }) {
  return (
    <div>
      <p className="tw-mb-2 tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide">
        {segment.id}
      </p>
      <div className="tw-flex tw-flex-wrap tw-gap-1">
        {segment.tokens.map((token) =>
          token.type === 'word' ? (
            <span
              key={token.id}
              className="tw-inline-block tw-rounded tw-border tw-border-border tw-bg-muted tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-sm tw-text-foreground"
            >
              {token.surfaceText}
            </span>
          ) : (
            <span
              key={token.id}
              className="tw-inline-block tw-font-mono tw-text-sm tw-text-muted-foreground"
            >
              {token.surfaceText}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Fetches the USJ book for the given project, tokenizes it, finds the segment matching `scrRef`,
 * and renders a {@link SegmentView} for that verse. Shows loading / error states while data is in
 * flight or unavailable.
 */
function ProjectBookFetcher({
  projectId,
  scrRef,
  setScrRef,
}: {
  projectId: string;
  scrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[0];
  setScrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[1];
}) {
  const [bookResult, , isLoading] = useProjectData('platformScripture.USJ_Book', projectId).BookUSJ(
    scrRef,
    undefined,
  );

  const [writingSystem] = useProjectSetting(projectId, 'platform.languageTag', '');

  const [localizedStrings] = useLocalizedStrings(
    useMemo(() => [...BOOK_CHAPTER_CONTROL_STRING_KEYS], []),
  );
  const { recentScriptureRefs: recentRefs, addRecentScriptureRef: onAddRecentRef } =
    useRecentScriptureRefs();

  const book = useMemo(() => {
    if (!bookResult || isPlatformError(bookResult)) return undefined;
    try {
      const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
      return tokenizeBook(extractBookFromUsj(bookResult, ws));
    } catch {
      return undefined;
    }
  }, [bookResult, writingSystem]);

  const currentSegment = useMemo(() => {
    if (!book) return undefined;
    return (
      book.segments.find(
        (seg) =>
          seg.startRef.book === scrRef.book &&
          seg.startRef.chapter === scrRef.chapterNum &&
          seg.startRef.verse === scrRef.verseNum,
      ) ?? book.segments[0]
    );
  }, [book, scrRef]);

  let bookError: string | undefined;
  if (isPlatformError(bookResult)) {
    bookError = bookResult.message;
  } else if (!isLoading && bookResult === undefined) {
    bookError = `No USJ book available for ${scrRef.book} in project ${projectId}`;
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <BookChapterControl
        scrRef={scrRef}
        handleSubmit={(ref) => {
          setScrRef(ref);
          onAddRecentRef(ref);
        }}
        localizedStrings={localizedStrings}
        recentSearches={recentRefs}
        onAddRecentSearch={onAddRecentRef}
      />

      {bookError && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Error loading book</h2>
          <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
            {bookError}
          </pre>
        </div>
      )}

      {!bookError && isLoading && <p className="tw-text-sm tw-text-muted-foreground">Loading…</p>}

      {!bookError && !isLoading && !currentSegment && (
        <p className="tw-text-sm tw-text-muted-foreground">
          No verse data for {scrRef.book} {scrRef.chapterNum}:{scrRef.verseNum}.
        </p>
      )}

      {!bookError && !isLoading && currentSegment && <SegmentView segment={currentSegment} />}
    </div>
  );
}

/**
 * Root WebView component for the Interlinearizer. Reads the scroll-group scripture reference and
 * delegates book fetching to {@link ProjectBookFetcher}. Shows a placeholder when no projectId is
 * provided (i.e. the WebView was opened without a project).
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const [scrRef, setScrRef] = useWebViewScrollGroupScrRef();

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-p-4">
      <h1 className="tw-text-xl tw-font-semibold tw-tracking-tight">Interlinearizer</h1>

      {projectId ? (
        <ProjectBookFetcher projectId={projectId} scrRef={scrRef} setScrRef={setScrRef} />
      ) : (
        <p className="tw-text-sm tw-text-muted-foreground">
          Open this WebView from a Paratext project to load its source book.
        </p>
      )}
    </div>
  );
};
