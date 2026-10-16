import papi, { logger } from '@papi/frontend';
import { useProjectSetting } from '@papi/frontend/react';
import { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book } from 'interlinearizer';
import { isPlatformError } from 'platform-bible-utils';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { perfMark, perfTime, perfTrack } from '../utils/perf-marks';

/** Arguments for the {@link useInterlinearizerBookData} hook. */
export interface UseInterlinearizerBookDataArgs {
  /** PAPI project ID whose book should be loaded. */
  projectId: string;
  /** Current scripture reference; only `book` is used. */
  scrRef: SerializedVerseRef;
}

/** Return value of the {@link useInterlinearizerBookData} hook. */
export interface UseInterlinearizerBookDataResult {
  /**
   * The tokenized book; the previously loaded one while another loads, and `undefined` before any
   * has loaded or after one fails to.
   */
  book: Book | undefined;
  /** `true` until the requested book has loaded or failed to. */
  isLoading: boolean;
  /** Why the requested book could not be loaded, when it could not. */
  bookError: string | undefined;
  /**
   * BCP 47 tag of the project's text, `'und'` when the project declares none. Carries a tag whether
   * or not `book` loaded, so source text can be collated or rendered before the text itself
   * arrives.
   */
  writingSystem: string;
}

/** The outcome of one book request. */
interface LoadedBook {
  /** Identifies the request, so an outcome is told apart from those of earlier requests. */
  key: string;
  book?: Book;
  error?: string;
}

/**
 * Fetches the tokenized book for the given project and scripture reference, once the project's
 * language tag has loaded, and again whenever the tag changes.
 */
export default function useInterlinearizerBookData({
  projectId,
  scrRef,
}: Readonly<UseInterlinearizerBookDataArgs>): UseInterlinearizerBookDataResult {
  useLayoutEffect(() => perfMark('book-change', { book: scrRef.book }), [scrRef.book]);

  const [languageTag, , , isLanguageTagLoading] = useProjectSetting(
    projectId,
    'platform.languageTag',
    '',
  );
  const writingSystem = isPlatformError(languageTag) ? 'und' : languageTag || 'und';

  const key = `${projectId}:${scrRef.book}:${writingSystem}`;
  const [loaded, setLoaded] = useState<LoadedBook>();
  useEffect(() => {
    if (isLanguageTagLoading) return undefined;
    let isCurrent = true;
    const bookId = scrRef.book;
    (async () => {
      let outcome: LoadedBook;
      try {
        const json = await perfTrack(
          'book-fetch',
          papi.commands.sendCommand('interlinearizer.getTokenizedBook', projectId, bookId),
        );
        if (!isCurrent) return;
        outcome = json
          ? { key, book: perfTime('book-parse', () => JSON.parse(json), { bytes: json.length }) }
          : { key, error: `No text available for ${bookId} in project ${projectId}` };
      } catch (e) {
        if (!isCurrent) return;
        outcome = { key, error: e instanceof Error ? e.message : String(e) };
      }
      setLoaded(outcome);
    })();
    return () => {
      isCurrent = false;
    };
  }, [key, isLanguageTagLoading, projectId, scrRef.book]);

  const isCurrentLoaded = loaded?.key === key;
  const book = loaded?.book;

  // Warns once per project/book/duplicate-set.
  const warnedForBookRef = useRef<string | undefined>(undefined);
  const bookRef = book?.bookRef;
  const duplicateVerseIds = book?.duplicateVerseIds;
  useEffect(() => {
    if (!duplicateVerseIds || duplicateVerseIds.length === 0) return;

    const bookKey = `${projectId}:${bookRef}:${duplicateVerseIds.join(',')}`;
    if (warnedForBookRef.current === bookKey) return;
    warnedForBookRef.current = bookKey;

    logger.warn(
      `Interlinearizer: book ${bookRef} in project ${projectId} repeats ${duplicateVerseIds.length} verse marker(s); their text is not shown: ${duplicateVerseIds.join(', ')}`,
    );
    papi.notifications
      .send({ message: '%interlinearizer_warning_duplicateVerses%', severity: 'warning' })
      /* v8 ignore next -- a failed warning must not break the load that succeeded */
      .catch(() => {});
  }, [duplicateVerseIds, projectId, bookRef]);

  return {
    book,
    isLoading: !isCurrentLoaded,
    bookError: isCurrentLoaded ? loaded.error : undefined,
    writingSystem,
  };
}
