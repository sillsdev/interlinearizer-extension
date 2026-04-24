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
function SegmentView({
  segment,
  isActive,
  onClick,
}: {
  segment: Segment;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      className={
        isActive
          ? 'tw-w-full tw-rounded tw-border tw-border-border tw-bg-muted/50 tw-p-2 tw-text-left'
          : 'tw-w-full tw-rounded tw-p-2 tw-text-left tw-transition-colors hover:tw-bg-muted/30'
      }
      onClick={onClick}
    >
      <p className="tw-mb-2 tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide">
        {segment.startRef.verse}
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
    </button>
  );
}

/**
 * Fetches the USJ book for the given project, tokenizes it, and renders all segments in the current
 * chapter. Shows loading / error states while data is in flight or unavailable.
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
  const bookScrRef = useMemo(
    () => ({ book: scrRef.book, chapterNum: 1, verseNum: 1 }),
    [scrRef.book],
  );
  const [bookResult, , isLoading] = useProjectData('platformScripture.USJ_Book', projectId).BookUSJ(
    bookScrRef,
    undefined,
  );

  const [writingSystem] = useProjectSetting(projectId, 'platform.languageTag', '');

  const book = useMemo(() => {
    if (!bookResult || isPlatformError(bookResult)) return undefined;
    try {
      const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
      return tokenizeBook(extractBookFromUsj(bookResult, ws));
    } catch {
      return undefined;
    }
  }, [bookResult, writingSystem]);

  const chapterSegments = useMemo(
    () =>
      book?.segments.filter(
        (seg) => seg.startRef.book === scrRef.book && seg.startRef.chapter === scrRef.chapterNum,
      ) ?? [],
    [book, scrRef.book, scrRef.chapterNum],
  );

  let bookError: string | undefined;
  if (isPlatformError(bookResult)) {
    bookError = bookResult.message;
  } else if (!isLoading && bookResult === undefined) {
    bookError = `No USJ book available for ${scrRef.book} in project ${projectId}`;
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {bookError && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Error loading book</h2>
          <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
            {bookError}
          </pre>
        </div>
      )}

      {!bookError && isLoading && <p className="tw-text-sm tw-text-muted-foreground">Loading…</p>}

      {!bookError && !isLoading && chapterSegments.length === 0 && (
        <p className="tw-text-sm tw-text-muted-foreground">
          No verse data for {scrRef.book} {scrRef.chapterNum}.
        </p>
      )}

      {!bookError && !isLoading && chapterSegments.length > 0 && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          {chapterSegments.map((seg) => (
            <SegmentView
              key={seg.id}
              segment={seg}
              isActive={seg.startRef.verse === scrRef.verseNum}
              onClick={() =>
                setScrRef({
                  book: seg.startRef.book,
                  chapterNum: seg.startRef.chapter,
                  verseNum: seg.startRef.verse,
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Root WebView component for the Interlinearizer. Renders a sticky reference picker at the top and
 * delegates book fetching to {@link ProjectBookFetcher} in the scrollable content area below.
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const [scrRef, setScrRef] = useWebViewScrollGroupScrRef();

  const [localizedStrings] = useLocalizedStrings(
    useMemo(() => [...BOOK_CHAPTER_CONTROL_STRING_KEYS], []),
  );
  const { recentScriptureRefs: recentRefs, addRecentScriptureRef: onAddRecentRef } =
    useRecentScriptureRefs();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-sticky tw-top-0 tw-z-10 tw-border-b tw-border-border tw-bg-background tw-p-4">
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
      </div>

      <div className="tw-p-4">
        {projectId ? (
          <ProjectBookFetcher projectId={projectId} scrRef={scrRef} setScrRef={setScrRef} />
        ) : (
          <p className="tw-text-sm tw-text-muted-foreground">
            Open this WebView from a Paratext project to load its source book.
          </p>
        )}
      </div>
    </div>
  );
};
