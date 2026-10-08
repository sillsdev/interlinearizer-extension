import papi, { logger } from '@papi/frontend';
import { Canon } from '@sillsdev/scripture';
import type { Book } from 'interlinearizer';
import type { IUSJBookProjectDataProvider } from 'platform-scripture';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { tokenizeBook } from '../parsers/papi/bookTokenizer';
import { extractBookFromUsj } from '../parsers/papi/usjBookExtractor';
import { indexBook, type BookConcordance } from '../utils/concordance';
import useLatestRef from './useLatestRef';

/** Where reading the project's books has got to. */
export type SourceTextStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Arguments for {@link useSourceTextReader}. */
export interface UseSourceTextReaderArgs {
  /** Source project whose books are read. */
  projectId: string;
  /** BCP 47 tag of the source text, which its tokens are labeled with. */
  writingSystem: string;
  /** The book the editor has loaded, which stands in for that book's reading while it is current. */
  liveBook: Book | undefined;
  /** Whether the text is wanted; nothing is read until it first is, or is requested. */
  enabled: boolean;
  /**
   * Reads every book again, as a refresh does, whenever this changes; results from a read started
   * under an earlier key are dropped.
   */
  readKey?: unknown;
  /** Receives each book as it is read, before only its index is kept. */
  onBookRead?: (book: Book) => void;
  /**
   * Receives, in canonical order, the books found to have text once every book is read; not called
   * for a reading that any book failed.
   */
  onTextRead?: (bookIds: readonly string[]) => void;
}

/** What {@link useSourceTextReader} hands back. */
export interface SourceText {
  status: SourceTextStatus;
  /** How many of the project's books have been read so far. */
  booksRead: number;
  /** How many books the project has; `0` until the list of them has been read. */
  bookCount: number;
  /** Each book's index as last read, by book code; `undefined` until a reading completes. */
  readings: ReadonlyMap<string, BookConcordance> | undefined;
  /** Live versions of books the editor has had loaded, each newer than the book's reading. */
  liveVersions: ReadonlyMap<string, BookConcordance>;
  /** Whether a book failed to read, leaving the readings short of the whole text. */
  isPartial: boolean;
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
 * Reads the books a `platformScripture.booksPresent` flag string marks present — one `'1'` per
 * present book, indexed by canonical book number — in canonical order. Flags past the end of the
 * canon mark nothing.
 */
function presentBookIds(booksPresent: string): string[] {
  const bookCount = Math.min(booksPresent.length, Canon.allBookIds.length);
  const ids: string[] = [];
  for (let index = 0; index < bookCount; index += 1) {
    if (booksPresent[index] === '1') ids.push(Canon.bookNumberToId(index + 1));
  }
  return ids;
}

/**
 * How many books are read at once. Enough to keep the provider busy while earlier books are
 * indexed, few enough that the whole canon's USJ is never in memory at the same time.
 */
const READ_CONCURRENCY = 4;

/** Reads and tokenizes a book, `undefined` when the project serves no text for it. */
async function readBook(
  usjPdp: Pick<IUSJBookProjectDataProvider, 'getBookUSJ'>,
  bookId: string,
  writingSystem: string,
): Promise<Book | undefined> {
  const usj = await usjPdp.getBookUSJ({ book: bookId, chapterNum: 1, verseNum: 1 });
  if (!usj) return undefined;
  return tokenizeBook(extractBookFromUsj(usj, writingSystem));
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
  writingSystem,
  liveBook,
  enabled,
  onBookRead,
  onTextRead,
  readKey,
}: UseSourceTextReaderArgs): SourceText {
  const [status, setStatus] = useState<SourceTextStatus>('idle');
  const [progress, setProgress] = useState({ booksRead: 0, bookCount: 0 });
  const [readings, setReadings] = useState<ReadonlyMap<string, BookConcordance>>();
  const [isPartial, setIsPartial] = useState(false);

  const [liveVersions, setLiveVersions] = useState<ReadonlyMap<string, BookConcordance>>(
    () => new Map(),
  );

  const [requested, setRequested] = useState(false);
  const wanted = enabled || requested;

  /** Bumped to read every book again. */
  const [generation, setGeneration] = useState(0);

  // Read through a ref so the tag settling after the first render does not restart the reads: the
  // tag only labels the tokens, which the index never looks at.
  const writingSystemRef = useLatestRef(writingSystem);

  // Read through refs so a read in flight calls whichever callbacks are current when it lands.
  const onBookReadRef = useLatestRef(onBookRead);
  const onTextReadRef = useLatestRef(onTextRead);
  const readKeyRef = useLatestRef(readKey);

  const readingsRef = useLatestRef(readings);

  useEffect(() => {
    if (!wanted) return undefined;
    let isAbandoned = false;
    const key = readKeyRef.current;
    // `readKeyRef` updates during render, before this cleanup runs, so check the key too.
    const isCurrent = () => !isAbandoned && readKeyRef.current === key;
    setStatus('loading');
    setIsPartial(false);
    setProgress({ booksRead: 0, bookCount: 0 });
    (async () => {
      try {
        const basePdp = await papi.projectDataProviders.get('platform.base', projectId);
        const bookIds = presentBookIds(await basePdp.getSetting('platformScripture.booksPresent'));
        const usjPdp = await papi.projectDataProviders.get('platformScripture.USJ_Book', projectId);
        if (!isCurrent()) return;
        setProgress({ booksRead: 0, bookCount: bookIds.length });

        const read = new Map<string, BookConcordance>();
        const unread = [...bookIds];
        let booksRead = 0;
        let booksFailed = 0;
        const readNext = async (): Promise<void> => {
          const bookId = unread.shift();
          if (bookId === undefined) return;
          let book: Book | undefined;
          try {
            book = await readBook(usjPdp, bookId, writingSystemRef.current);
            if (book) read.set(bookId, indexBook(book));
            else logger.warn(`Source text: project ${projectId} has no text for ${bookId}`);
          } catch (e) {
            booksFailed += 1;
            logger.warn(`Source text: skipping ${bookId} in project ${projectId}`, e);
          }
          if (!isCurrent()) return;
          if (book) onBookReadRef.current?.(book);
          booksRead += 1;
          setProgress({ booksRead, bookCount: bookIds.length });
          await readNext();
        };
        await Promise.all(Array.from({ length: READ_CONCURRENCY }, readNext));
        if (!isCurrent()) return;
        // With nothing read, a failure could be hiding text, so an empty reading would misreport it.
        if (read.size === 0 && booksFailed > 0) {
          logger.error(`Source text: no book of project ${projectId} could be read`);
          setStatus('error');
          return;
        }
        setReadings(read);
        setIsPartial(booksFailed > 0);
        setStatus('ready');
        if (booksFailed === 0) onTextReadRef.current?.(bookIds.filter((id) => read.has(id)));
      } catch (e) {
        if (!isCurrent()) return;
        logger.error(`Source text: could not list the books of project ${projectId}`, e);
        setStatus('error');
      }
    })();
    return () => {
      isAbandoned = true;
    };
  }, [wanted, projectId, generation, readKeyRef, writingSystemRef, onBookReadRef, onTextReadRef]);

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

  const [readKeyRead, setReadKeyRead] = useState(readKey);
  if (readKey !== readKeyRead) {
    setReadKeyRead(readKey);
    refresh();
  }

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
      isPartial,
      textForms,
      refresh,
      request,
    }),
    [status, progress, readings, liveVersions, isPartial, textForms, refresh, request],
  );
}
