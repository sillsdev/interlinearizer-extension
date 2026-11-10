import papi, { logger } from '@papi/frontend';
import type { Book } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TextReadStatus } from '../types/text-read-status';
import { presentBookIds } from '../utils/books-present';
import { indexBook, type BookConcordance } from '../utils/concordance';
import { perfMark, perfMeasure } from '../utils/perf-marks';
import useLatestRef from './useLatestRef';

/** Where reading the project's books has got to. */
export type SourceTextStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Arguments for {@link useSourceTextReader}. */
export interface UseSourceTextReaderArgs {
  /** Source project whose books are read. */
  projectId: string;
  /** The book the editor has loaded, which stands in for that book's reading while it is current. */
  liveBook: Book | undefined;
  /** Whether the text is wanted; nothing is read until it first is, or is requested. */
  enabled: boolean;
  /**
   * Called each time the text becomes wanted or requested. Called again when this callback changes
   * while the text stays wanted or requested.
   */
  onWanted?: () => void;
}

/** What {@link useSourceTextReader} hands back. */
export interface SourceText extends TextReadStatus {
  status: SourceTextStatus;
  /** Each book's index as last read, by book code; `undefined` until a reading completes. */
  readings: ReadonlyMap<string, BookConcordance> | undefined;
  /** Live versions of books the editor has had loaded, each newer than the book's reading. */
  liveVersions: ReadonlyMap<string, BookConcordance>;
  /**
   * Every form the text holds, the live book's as it now reads; `undefined` until every book has
   * been read, and for a partial reading.
   */
  textForms: ReadonlySet<string> | undefined;
  /** Reads every book again, the live one aside. */
  refresh: () => void;
  /** Wants the text from now on, whatever `enabled` says. */
  request: () => void;
}

/**
 * How many books are read at once. Enough to keep the provider busy while earlier books are
 * indexed, few enough that the whole canon's USJ is never in memory at the same time.
 */
const READ_CONCURRENCY = 4;

const NO_BOOK_IDS: readonly string[] = [];

/** Reads a tokenized book, `undefined` when the project serves no text for it. */
async function readBook(projectId: string, bookId: string): Promise<Book | undefined> {
  const json = await papi.commands.sendCommand(
    'interlinearizer.getTokenizedBook',
    projectId,
    bookId,
  );
  return json ? JSON.parse(json) : undefined;
}

/**
 * Reads and indexes every book of a source project, the first time the text is wanted or requested,
 * and keeps them for as long as the caller stays mounted.
 *
 * Every book but the live one is a reading taken when the text was last read. The live book
 * replaces its reading whenever its text changes, and a book the editor moves off keeps the last
 * live version it had rather than going back to the older reading.
 */
export default function useSourceTextReader({
  projectId,
  liveBook,
  enabled,
  onWanted,
}: UseSourceTextReaderArgs): SourceText {
  const [status, setStatus] = useState<SourceTextStatus>('idle');
  const [progress, setProgress] = useState({ booksRead: 0, bookCount: 0 });
  const [readings, setReadings] = useState<ReadonlyMap<string, BookConcordance>>();
  const [failedBookIds, setFailedBookIds] = useState(NO_BOOK_IDS);
  const isPartial = failedBookIds.length > 0;

  const [liveVersions, setLiveVersions] = useState<ReadonlyMap<string, BookConcordance>>(
    () => new Map(),
  );

  const [requested, setRequested] = useState(false);
  const wanted = enabled || requested;

  useEffect(() => {
    if (wanted) onWanted?.();
  }, [wanted, onWanted]);

  /** Bumped to read every book again. */
  const [generation, setGeneration] = useState(0);

  const readingsRef = useLatestRef(readings);

  useEffect(() => {
    if (!wanted) return undefined;
    let isAbandoned = false;
    const isCurrent = () => !isAbandoned;
    setStatus('loading');
    setFailedBookIds(NO_BOOK_IDS);
    setProgress({ booksRead: 0, bookCount: 0 });
    perfMark('concordance-start');
    (async () => {
      try {
        const basePdp = await papi.projectDataProviders.get('platform.base', projectId);
        const bookIds = presentBookIds(await basePdp.getSetting('platformScripture.booksPresent'));
        if (!isCurrent()) return;
        setProgress({ booksRead: 0, bookCount: bookIds.length });

        const read = new Map<string, BookConcordance>();
        const unread = [...bookIds];
        let booksRead = 0;
        const failed = new Set<string>();
        const readNext = async (): Promise<void> => {
          const bookId = unread.shift();
          if (bookId === undefined) return;
          let book: Book | undefined;
          try {
            book = await readBook(projectId, bookId);
            if (book) read.set(bookId, indexBook(book));
            else logger.warn(`Source text: project ${projectId} has no text for ${bookId}`);
          } catch (e) {
            failed.add(bookId);
            logger.warn(`Source text: skipping ${bookId} in project ${projectId}`, e);
          }
          if (!isCurrent()) return;
          booksRead += 1;
          setProgress({ booksRead, bookCount: bookIds.length });
          await readNext();
        };
        await Promise.all(Array.from({ length: READ_CONCURRENCY }, readNext));
        if (!isCurrent()) return;
        // With nothing read, a failure could be hiding text, so an empty reading would misreport it.
        if (read.size === 0 && failed.size > 0) {
          logger.error(`Source text: no book of project ${projectId} could be read`);
          setStatus('error');
          return;
        }
        perfMeasure('concordance-read', 'concordance-start');
        setReadings(read);
        if (failed.size > 0) setFailedBookIds(bookIds.filter((id) => failed.has(id)));
        setStatus('ready');
      } catch (e) {
        if (!isCurrent()) return;
        logger.error(`Source text: could not list the books of project ${projectId}`, e);
        setStatus('error');
      }
    })();
    return () => {
      isAbandoned = true;
    };
  }, [wanted, projectId, generation]);

  /** The live book, indexed only once the text is wanted. */
  const liveIndex = useMemo(
    () => (wanted && liveBook ? indexBook(liveBook) : undefined),
    [wanted, liveBook],
  );

  useEffect(() => {
    if (!liveIndex) return;
    setLiveVersions((prev) => {
      const known = prev.get(liveIndex.book) ?? readingsRef.current?.get(liveIndex.book);
      // Unchanged text would only rebuild everything built on the readings to the same result.
      if (known?.textVersion === liveIndex.textVersion) return prev;
      return new Map(prev).set(liveIndex.book, liveIndex);
    });
  }, [liveIndex, readingsRef]);

  const liveIndexRef = useLatestRef(liveIndex);

  const refresh = useCallback(() => {
    const live = liveIndexRef.current;
    setLiveVersions(live ? new Map([[live.book, live]]) : new Map());
    setGeneration((g) => g + 1);
  }, [liveIndexRef]);

  const request = useCallback(() => setRequested(true), []);

  const textForms = useMemo(() => {
    if (status !== 'ready' || !readings || isPartial) return undefined;
    const books = new Map(readings);
    liveVersions.forEach((index, book) => books.set(book, index));
    const forms = new Set<string>();
    books.forEach(({ occurrencesByForm }) =>
      occurrencesByForm.forEach((_, form) => forms.add(form)),
    );
    return forms;
  }, [status, readings, isPartial, liveVersions]);

  return useMemo(
    () => ({
      status,
      ...progress,
      readings,
      liveVersions,
      failedBookIds,
      textForms,
      refresh,
      request,
    }),
    [status, progress, readings, liveVersions, failedBookIds, textForms, refresh, request],
  );
}
