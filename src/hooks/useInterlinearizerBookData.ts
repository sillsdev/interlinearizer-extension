import { logger } from '@papi/frontend';
import { useProjectData, useProjectSetting } from '@papi/frontend/react';
import { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { isPlatformError } from 'platform-bible-utils';
import { useEffect, useMemo } from 'react';

interface UseInterlinearizerBookDataArgs {
  projectId?: string;
  scrRef: SerializedVerseRef;
}

interface UseInterlinearizerBookDataResult {
  book: Book | undefined;
  chapterSegments: Book['segments'];
  isLoading: boolean;
  bookError: string | undefined;
  tokenizeError: { message: string; raw: unknown } | undefined;
}

export default function useInterlinearizerBookData({
  projectId,
  scrRef,
}: Readonly<UseInterlinearizerBookDataArgs>): UseInterlinearizerBookDataResult {
  const hasProject = Boolean(projectId);
  const resolvedProjectId = projectId ?? '';

  const bookScrRef = useMemo(
    () => ({ book: scrRef.book, chapterNum: 1, verseNum: 1 }),
    [scrRef.book],
  );

  const [bookResult, , isLoadingRaw] = useProjectData(
    'platformScripture.USJ_Book',
    resolvedProjectId,
  ).BookUSJ(bookScrRef, undefined);
  const [writingSystem] = useProjectSetting(resolvedProjectId, 'platform.languageTag', '');

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
    if (!hasProject || !tokenizeError) return;

    const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
    logger.error('Failed to parse/tokenize USJ book', tokenizeError.raw, {
      message: tokenizeError.message,
      writingSystem: ws,
      projectId: resolvedProjectId,
      book: scrRef.book,
    });
  }, [hasProject, tokenizeError, writingSystem, resolvedProjectId, scrRef.book]);

  const chapterSegments = useMemo(
    () =>
      book?.segments.filter(
        (seg) => seg.startRef.book === scrRef.book && seg.startRef.chapter === scrRef.chapterNum,
      ) ?? [],
    [book, scrRef.book, scrRef.chapterNum],
  );

  const isLoading = hasProject ? isLoadingRaw : false;

  let bookError: string | undefined;
  if (hasProject && isPlatformError(bookResult)) {
    bookError = bookResult.message;
  } else if (hasProject && !isLoading && bookResult === undefined) {
    bookError = `No USJ book available for ${scrRef.book} in project ${resolvedProjectId}`;
  }

  return { book, chapterSegments, isLoading, bookError, tokenizeError };
}
