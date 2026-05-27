import { logger } from '@papi/frontend';
import { useProjectData, useProjectSetting } from '@papi/frontend/react';
import { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { isPlatformError } from 'platform-bible-utils';
import { useEffect, useMemo } from 'react';

/** Arguments for the {@link useInterlinearizerBookData} hook. */
export interface UseInterlinearizerBookDataArgs {
  /** PAPI project ID whose USJ book data should be loaded. */
  projectId: string;
  /** Current scripture reference; only `book` and `chapterNum` are used to scope the data. */
  scrRef: SerializedVerseRef;
}

/** Return value of the {@link useInterlinearizerBookData} hook. */
export interface UseInterlinearizerBookDataResult {
  /** The fully tokenized book, or `undefined` while loading or on error. */
  book: Book | undefined;
  /** Segments belonging to the current chapter (`scrRef.chapterNum`); empty while loading. */
  chapterSegments: Book['segments'];
  /** `true` while the USJ book data is being fetched from the platform. */
  isLoading: boolean;
  /** Human-readable error string when the platform returns an error or no USJ data. */
  bookError: string | undefined;
  /** Error thrown by {@link extractBookFromUsj} or {@link tokenizeBook}; `undefined` on success. */
  tokenizeError: { message: string; raw: unknown } | undefined;
}

/**
 * Fetches and tokenizes the USJ book for the given project and scripture reference.
 *
 * @param args - Hook arguments.
 * @param args.projectId - PAPI project ID whose USJ book data should be loaded.
 * @param args.scrRef - Current scripture reference; only `book` and `chapterNum` are used.
 * @returns The tokenized book, chapter segments, loading state, and any errors encountered.
 */
export default function useInterlinearizerBookData({
  projectId,
  scrRef,
}: Readonly<UseInterlinearizerBookDataArgs>): UseInterlinearizerBookDataResult {
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
    if (!tokenizeError) return;

    /* v8 ignore next -- isPlatformError branch for writingSystem is unreachable through the mock setup */
    const ws = isPlatformError(writingSystem) ? 'und' : writingSystem || 'und';
    logger.error('Failed to parse/tokenize USJ book', tokenizeError.raw, {
      message: tokenizeError.message,
      writingSystem: ws,
      projectId,
      book: scrRef.book,
    });
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
  } else if (!isLoading && !bookResult) {
    bookError = `No USJ book available for ${scrRef.book} in project ${projectId}`;
  }

  return { book, chapterSegments, isLoading, bookError, tokenizeError };
}
