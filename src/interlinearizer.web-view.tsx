import type { WebViewProps } from '@papi/core';
import {
  useLocalizedStrings,
  useProjectSetting,
  useRecentScriptureRefs,
} from '@papi/frontend/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOOK_CHAPTER_CONTROL_STRING_KEYS,
  BookChapterControl,
  ScrollGroupSelector,
  TabToolbar,
} from 'platform-bible-react';
import ContinuousScrollToggle from './components/ContinuousScrollToggle';
import ContinuousView from './components/ContinuousView';
import SegmentView from './components/SegmentView';
import useInterlinearizerBookData from './hooks/useInterlinearizerBookData';

const AVAILABLE_SCROLL_GROUPS = [undefined, 0, 1, 2, 3, 4];

/**
 * Root WebView component for the Interlinearizer. Renders a sticky reference picker at the top and
 * uses hook-backed book state to render continuous and segmented views.
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
  const { book, chapterSegments, isLoading, bookError, tokenizeError } = useInterlinearizerBookData(
    {
      projectId,
      scrRef,
    },
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
  const handleContinuousVerseChange = useCallback(
    (v: { book: string; chapter: number; verse: number }) => {
      setScrRef({ book: v.book, chapterNum: v.chapter, verseNum: v.verse });
    },
    [setScrRef],
  );
  const activeVerse = useMemo(
    () => ({ book: scrRef.book, chapter: scrRef.chapterNum, verse: scrRef.verseNum }),
    [scrRef.book, scrRef.chapterNum, scrRef.verseNum],
  );
  const handleSegmentSelect = useCallback(
    (ref: { book: string; chapter: number; verse: number }) => {
      setScrRef({ book: ref.book, chapterNum: ref.chapter, verseNum: ref.verse });
    },
    [setScrRef],
  );

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-sticky tw-top-0 tw-z-10 tw-bg-background">
        <TabToolbar
          className="tw-z-10"
          startAreaChildren={
            <div className="tw-flex tw-flex-row tw-items-center tw-gap-2">
              <BookChapterControl
                handleSubmit={setScrRef}
                localizedStrings={localizedStrings}
                onAddRecentSearch={onAddRecentRef}
                recentSearches={recentRefs}
                scrRef={scrRef}
              />
              <ScrollGroupSelector
                availableScrollGroupIds={AVAILABLE_SCROLL_GROUPS}
                onChangeScrollGroupId={setScrollGroupId}
                scrollGroupId={scrollGroupId}
              />
            </div>
          }
          endAreaChildren={
            projectId && (
              <ContinuousScrollToggle
                checked={continuousScroll}
                disabled={pendingContinuousScroll !== undefined}
                onCheckedChange={(checked) => {
                  setContinuousScroll(checked);
                  setPendingContinuousScroll(checked);
                  setContinuousScrollSetting?.(checked);
                }}
              />
            )
          }
          onSelectProjectMenuItem={() => {}}
          onSelectViewInfoMenuItem={() => {}}
        />
        {projectId && !bookError && !tokenizeError && !isLoading && book && continuousScroll && (
          <div className="tw-bg-background tw-py-2">
            <ContinuousView
              book={book}
              activeVerse={activeVerse}
              onVerseChange={handleContinuousVerseChange}
            />
          </div>
        )}
      </div>

      <div className="tw-p-4">
        {projectId ? (
          <div className="tw-flex tw-flex-col tw-gap-4">
            {bookError && (
              <div className="tw-flex tw-flex-col tw-gap-2">
                <h2 className="tw-text-lg tw-font-medium tw-text-destructive">
                  Error loading book
                </h2>
                <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
                  {bookError}
                </pre>
              </div>
            )}

            {tokenizeError && (
              <div className="tw-flex tw-flex-col tw-gap-2">
                <h2 className="tw-text-lg tw-font-medium tw-text-destructive">
                  Error processing book
                </h2>
                <pre className="tw-overflow-auto tw-rounded-md tw-bg-muted tw-p-4 tw-text-sm">
                  {tokenizeError.message}
                </pre>
              </div>
            )}

            {!bookError && !tokenizeError && isLoading && (
              <p className="tw-text-sm tw-text-muted-foreground">Loading…</p>
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
                    displayMode={continuousScroll ? 'baseline-text' : 'token-chip'}
                    onSelect={handleSegmentSelect}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="tw-text-sm tw-text-muted-foreground">
            Open this WebView from a Paratext project to load its source book.
          </p>
        )}
      </div>
    </div>
  );
};
