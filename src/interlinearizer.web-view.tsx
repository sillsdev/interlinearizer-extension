import type { WebViewProps } from '@papi/core';
import {
  useLocalizedStrings,
  useProjectData,
  useProjectSetting,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import { isPlatformError } from 'platform-bible-utils';
import { useEffect, useMemo, useState } from 'react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  ScrollGroupSelector,
  TabToolbar,
} from 'platform-bible-react';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import type { Book } from 'interlinearizer';
import { logger } from '@papi/frontend';
import ContinuousScrollToggle from './components/ContinuousScrollToggle';
import ContinuousView from './components/ContinuousView';
import SegmentView from './components/SegmentView';

const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

/**
 * Fetches the USJ book for the given project, tokenizes it, and renders all segments in the current
 * chapter. Shows loading / error states while data is in flight or unavailable.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID whose USJ book to fetch and tokenize
 * @param props.scrRef - Current scripture reference shared via the scroll group
 * @param props.setScrRef - Setter to update the scroll-group scripture reference when a segment is
 *   clicked
 * @returns A column of {@link SegmentView} chips, or an appropriate loading / error message
 */
function ProjectBookFetcher({
  projectId,
  scrRef,
  setScrRef,
  continuousScroll,
}: Readonly<{
  projectId: string;
  scrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[0];
  setScrRef: ReturnType<WebViewProps['useWebViewScrollGroupScrRef']>[1];
  continuousScroll: boolean;
}>) {
  const bookScrRef = useMemo(
    () => ({ book: scrRef.book, chapterNum: 1, verseNum: 1 }),
    [scrRef.book],
  );
  const [bookResult, , isLoading] = useProjectData('platformScripture.USJ_Book', projectId).BookUSJ(
    bookScrRef,
    undefined,
  );

  const [writingSystem] = useProjectSetting(projectId, 'platform.languageTag', '');

  const [book, tokenizeError] = useMemo((): [
    Book | undefined,
    { message: string; raw: unknown } | undefined,
  ] => {
    if (!bookResult || isPlatformError(bookResult)) return [undefined, undefined];
    try {
      const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
      return [tokenizeBook(extractBookFromUsj(bookResult, ws)), undefined];
    } catch (err) {
      return [undefined, { message: err instanceof Error ? err.message : String(err), raw: err }];
    }
  }, [bookResult, writingSystem]);

  useEffect(() => {
    if (tokenizeError) {
      const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
      logger.error('Failed to parse/tokenize USJ book', tokenizeError.raw, {
        message: tokenizeError.message,
        writingSystem: ws,
        projectId,
        book: scrRef.book,
      });
    }
  }, [tokenizeError, writingSystem, projectId, scrRef.book]);

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

      {tokenizeError && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <h2 className="tw-text-lg tw-font-medium tw-text-destructive">Error processing book</h2>
          <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
            {tokenizeError.message}
          </pre>
        </div>
      )}

      {!bookError && !tokenizeError && isLoading && (
        <p className="tw-text-sm tw-text-muted-foreground">Loading…</p>
      )}

      {!bookError && !tokenizeError && !isLoading && book && continuousScroll === true && (
        <ContinuousView
          book={book}
          activeVerse={{ book: scrRef.book, chapter: scrRef.chapterNum, verse: scrRef.verseNum }}
          onVerseChange={(v) =>
            setScrRef({ book: v.book, chapterNum: v.chapter, verseNum: v.verse })
          }
        />
      )}

      {!bookError && !tokenizeError && !isLoading && chapterSegments.length === 0 && (
        <p className="tw-text-sm tw-text-muted-foreground">
          No verse data for {scrRef.book} {scrRef.chapterNum}.
        </p>
      )}

      {!bookError && !tokenizeError && !isLoading && chapterSegments.length > 0 && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          {chapterSegments.map((seg) => (
            <SegmentView
              key={seg.id}
              segment={seg}
              isActive={seg.startRef.verse === scrRef.verseNum}
              displayMode={continuousScroll === true ? 'baseline-text' : 'token-chip'}
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
 *
 * @param props - WebView props injected by the PAPI host
 * @param props.projectId - PAPI project ID passed from the host; undefined when the WebView is
 *   opened outside a project context
 * @param props.useWebViewScrollGroupScrRef - Hook that exposes the shared scroll-group scripture
 *   reference and its setter
 * @returns The full interlinearizer WebView layout
 */
globalThis.webViewComponent = function InterlinearizerWebView({
  projectId,
  useWebViewScrollGroupScrRef,
}: WebViewProps) {
  const [scrRef, setScrRef, scrollGroupId, setScrollGroupId] = useWebViewScrollGroupScrRef();
  const [continuousScrollSetting, setContinuousScrollSetting] = useProjectSetting(
    projectId ?? '',
    'interlinearizer.continuousScroll',
    true,
  );
  const settingValue = continuousScrollSetting === true;
  const [continuousScroll, setContinuousScroll] = useState(settingValue);
  const [pendingContinuousScroll, setPendingContinuousScroll] = useState<boolean | undefined>(
    undefined,
  );

  // Drive UI from optimistic local state and clear pending once the setting confirms.
  useEffect(() => {
    if (pendingContinuousScroll === undefined) {
      setContinuousScroll(settingValue);
      return;
    }
    if (settingValue === pendingContinuousScroll) {
      setPendingContinuousScroll(undefined);
      setContinuousScroll(settingValue);
    }
  }, [settingValue, pendingContinuousScroll]);

  const [localizedStrings] = useLocalizedStrings(
    useMemo(() => [...BOOK_CHAPTER_CONTROL_STRING_KEYS], []),
  );
  const { recentScriptureRefs: recentRefs, addRecentScriptureRef: onAddRecentRef } =
    useRecentScriptureRefs();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-sticky tw-top-0 tw-z-10 tw-bg-background">
        <TabToolbar
          className="tw-z-10"
          startAreaChildren={
            <BookChapterControl
              handleSubmit={setScrRef}
              localizedStrings={localizedStrings}
              onAddRecentSearch={onAddRecentRef}
              recentSearches={recentRefs}
              scrRef={scrRef}
            />
          }
          endAreaChildren={
            <ScrollGroupSelector
              availableScrollGroupIds={AVAILABLE_SCROLL_GROUPS}
              onChangeScrollGroupId={setScrollGroupId}
              scrollGroupId={scrollGroupId}
            />
          }
          onSelectProjectMenuItem={() => {}}
          onSelectViewInfoMenuItem={() => {}}
        />
        {projectId && (
          <div className="tw-border-b tw-px-4 tw-py-2">
            <ContinuousScrollToggle
              checked={continuousScroll}
              disabled={pendingContinuousScroll !== undefined}
              onCheckedChange={(checked) => {
                if (pendingContinuousScroll !== undefined) return;
                setContinuousScroll(checked);
                setPendingContinuousScroll(checked);
                setContinuousScrollSetting?.(checked);
              }}
            />
          </div>
        )}
      </div>

      <div className="tw-p-4">
        {projectId ? (
          <ProjectBookFetcher
            continuousScroll={continuousScroll}
            projectId={projectId}
            scrRef={scrRef}
            setScrRef={setScrRef}
          />
        ) : (
          <p className="tw-text-sm tw-text-muted-foreground">
            Open this WebView from a Paratext project to load its source book.
          </p>
        )}
      </div>
    </div>
  );
};
