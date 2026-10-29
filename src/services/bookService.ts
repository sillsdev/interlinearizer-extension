import papi, { logger } from '@papi/backend';
import type { Book, Segment, SegmentationDelta } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import { isPlatformError } from 'platform-bible-utils';
import type { IUSJBookProjectDataProvider } from 'platform-scripture';
import type { SegmentPage } from '../types/segment-pages';
import type { TextReadStatus } from '../types/text-read-status';
import { isSegmentationDelta } from '../types/type-guards';
import { normalizeSurfaceForm } from '../utils/analysis-identity';
import { buildBookOutline } from '../utils/book-outline';
import { presentBookIds } from '../utils/books-present';
import { FormIndex, formsOfBook } from '../utils/form-index';
import { perfTime, perfTrack } from '../utils/perf-marks';
import { reanchorSegmentation } from '../utils/segmentation';

interface BookTextWatch {
  /** The text as first delivered; `undefined` when the project has no text for the book. */
  text: Promise<UsjDocument | undefined>;
  /** The read's number among reads of the book, given as it subscribes. */
  readNumber: Promise<number>;
  stop: () => Promise<void>;
}

/** A source project's book, kept tokenized until its text changes or the project closes. */
interface HeldBook {
  bookId: string;
  writingSystem: string;
  /** `undefined` when the project has no text for the book. */
  book: Promise<Book | undefined>;
  /** The tokenized book as JSON, once it has been asked for whole. */
  json?: Promise<string | undefined>;
  /** The book segmented by the boundaries last asked for, keyed by their JSON. */
  segmented?: { key: string; segments: readonly Segment[] };
  watch: BookTextWatch;
}

/** Each source project's most recently requested book. */
const latestBooks = new Map<string, HeldBook>();

/**
 * Each source project's open book, the one whose outline was last asked for. It stays kept while
 * other books are read, and its edits are reported to {@link onBookTextChanged}'s listeners.
 */
const openBooks = new Map<string, HeldBook>();

/** Tells a request whether its project closed while it was under way. */
const closeCounts = new Map<string, number>();

/** Tells an outline request whether a later one, which picks the open book instead, has started. */
const outlineCounts = new Map<string, number>();

/**
 * How many books a whole-text read reads at once. Enough to keep the provider busy while earlier
 * books are tokenized, few enough to bound the fetches in flight.
 */
const READ_CONCURRENCY = 4;

/** A source project's whole text, read book by book into a form index, each book watched for edits. */
interface TextRead {
  /**
   * The text's books in canonical order, with the tag their text is written in; rejects when they,
   * or the provider of their text, could not be got.
   */
  listed: Promise<{ bookIds: string[]; writingSystem: string }>;
  /** The provider each book is read from, got as the books are listed. */
  usjPdp: Promise<IUSJBookProjectDataProvider>;
  /** The tag the books are tokenized under; `''` until the books are known. */
  writingSystem: string;
  /** Whether every book has been read once. */
  isRead: boolean;
  /** Books read at least once, whether or not they failed. */
  readBookIds: Set<string>;
  /** Books whose latest read failed. */
  failedBookIds: Set<string>;
  /** Books whose latest read found text. */
  textBookIds: Set<string>;
  forms: FormIndex;
  /** Stops watching each book the read has started, by book id. */
  watches: Map<string, () => Promise<void>>;
}

/**
 * Each source project's whole-text read. A read starts with the first status asked for, or with
 * {@link startTextRead}. It ends with {@link stopTextRead}, or once its books could not be listed.
 * Closing the project ends it too, except between {@link startTextRead} and {@link stopTextRead}.
 */
const textReads = new Map<string, TextRead>();

/**
 * The source projects that {@link startTextRead} has been called for, and {@link stopTextRead} has
 * not been called for since.
 */
const heldReads = new Set<string>();

/** Receives the source project and book of each edit to a watched book's text. */
type BookTextListener = (sourceProjectId: string, bookId: string) => void;

const bookTextListeners = new Set<BookTextListener>();

function reportEdit(sourceProjectId: string, bookId: string): void {
  bookTextListeners.forEach((listener) => listener(sourceProjectId, bookId));
}

/**
 * Receives the source project and tokenized text of each book that a whole-text read takes in, and
 * of the open book once it is edited.
 */
type BookReadListener = (sourceProjectId: string, book: Book) => void;

const bookReadListeners = new Set<BookReadListener>();

/**
 * The latest number given to a read of a book. Keyed by source project, then book id.
 *
 * Reads are numbered as they subscribe, because a read that subscribes later sees text at least as
 * new.
 */
const startedReads = new Map<string, Map<string, number>>();

/**
 * The number of the latest read that found a book's text, or found that it has none. Keyed by
 * source project, then book id.
 */
const finishedReads = new Map<string, Map<string, number>>();

function startRead(sourceProjectId: string, bookId: string): number {
  const started = startedReads.get(sourceProjectId) ?? new Map<string, number>();
  const readNumber = (started.get(bookId) ?? 0) + 1;
  started.set(bookId, readNumber);
  startedReads.set(sourceProjectId, started);
  return readNumber;
}

/**
 * Passes `book` to {@link onBookRead}'s listeners unless a read numbered above `readNumber` has
 * already found the book's text, or found that it has none. A read that found no text passes
 * nothing, and earlier reads that finish after it pass nothing either.
 */
function finishRead(
  sourceProjectId: string,
  bookId: string,
  readNumber: number,
  book: Book | undefined,
): void {
  const finished = finishedReads.get(sourceProjectId) ?? new Map<string, number>();
  if ((finished.get(bookId) ?? 0) > readNumber) return;
  finished.set(bookId, readNumber);
  finishedReads.set(sourceProjectId, finished);
  if (book) bookReadListeners.forEach((listener) => listener(sourceProjectId, book));
}

/** Receives the source project and the books holding text, of a whole-text read with none failed. */
type TextReadListener = (sourceProjectId: string, textBookIds: string[]) => void;

const textReadListeners = new Set<TextReadListener>();

/**
 * Resolves the writing system tag of the source project's text, `und` when the project declares
 * none.
 */
export async function getWritingSystem(sourceProjectId: string): Promise<string> {
  const basePdp = await papi.projectDataProviders.get('platform.base', sourceProjectId);
  const languageTag = await basePdp.getSetting('platform.languageTag');
  return typeof languageTag === 'string' && languageTag !== '' ? languageTag : 'und';
}

/** Watches a book's USJ, calling `onChange` on each delivery after the first. */
function watchBookText(
  sourceProjectId: string,
  bookId: string,
  onChange: () => void,
  usjPdp = papi.projectDataProviders.get('platformScripture.USJ_Book', sourceProjectId),
): BookTextWatch {
  const {
    promise: text,
    resolve: resolveText,
    reject: rejectText,
  } = Promise.withResolvers<UsjDocument | undefined>();
  let isFirstDelivery = true;
  const subscribed = usjPdp.then((pdp) => ({
    readNumber: startRead(sourceProjectId, bookId),
    // PAPI calls back after the first delivery only for text that differs from the last, or for
    // an error reading it again.
    unsubscribe: pdp.subscribeBookUSJ({ book: bookId, chapterNum: 1, verseNum: 1 }, (usj) => {
      if (!isFirstDelivery) {
        onChange();
        return;
      }
      isFirstDelivery = false;
      if (isPlatformError(usj)) rejectText(new Error(usj.message));
      else resolveText(usj);
    }),
  }));
  const subscription = subscribed.then(({ unsubscribe }) => unsubscribe);
  subscription.catch(rejectText);
  const readNumber = subscribed.then((watched) => watched.readNumber);
  // Rejects only alongside `text`, whose readers handle the failure.
  readNumber.catch(() => undefined);

  return {
    text,
    readNumber,
    stop: async () => {
      // Unsubscribing ahead of the first delivery would leave `text` unsettled.
      await text.catch(() => undefined);
      const unsubscribe = await subscription.catch(() => undefined);
      await unsubscribe?.().catch(
        /* v8 ignore next -- defensive: core's unsubscriber never rejects */
        (e) => logger.warn(`Could not stop watching ${bookId} of project ${sourceProjectId}: ${e}`),
      );
    },
  };
}

/** Stops watching `watch`'s book, and forgets it wherever the source project keeps it. */
function releaseBook(sourceProjectId: string, watch: BookTextWatch): Promise<void> {
  if (latestBooks.get(sourceProjectId)?.watch === watch) latestBooks.delete(sourceProjectId);
  if (openBooks.get(sourceProjectId)?.watch === watch) openBooks.delete(sourceProjectId);
  return watch.stop();
}

/** Stops watching `held`'s book once the source project keeps it neither as latest nor as open. */
function dropUnlessKept(sourceProjectId: string, held: HeldBook | undefined): void {
  if (!held) return;
  if (latestBooks.get(sourceProjectId) === held || openBooks.get(sourceProjectId) === held) return;
  held.watch.stop();
}

function holdBook(sourceProjectId: string, bookId: string, writingSystem: string): HeldBook {
  const watch = watchBookText(sourceProjectId, bookId, () => {
    const isOpen = openBooks.get(sourceProjectId)?.watch === watch;
    releaseBook(sourceProjectId, watch);
    if (!isOpen) return;
    // Read again at once, so the book stays watched and a refetch started by the listeners sees
    // the edit.
    const reheld = holdBook(sourceProjectId, bookId, writingSystem);
    openBooks.set(sourceProjectId, reheld);
    // The whole-text read's watch may have first read the book before the edit or after it, so the
    // read itself reads the book again over a new watch and reports the edit.
    const read = textReads.get(sourceProjectId);
    if (read?.watches.has(bookId)) rereadTextBook(sourceProjectId, read, bookId);
    else reportOpenBookEdit(sourceProjectId, reheld);
  });
  const book = perfTrack('getTokenizedBook:usj', watch.text).then(
    (usj) =>
      usj &&
      perfTime(
        'getTokenizedBook:tokenize',
        () => tokenizeBook(extractBookFromUsj(usj, writingSystem)),
        { writingSystem },
      ),
  );
  book.catch(() => releaseBook(sourceProjectId, watch));
  return { bookId, writingSystem, book, watch };
}

/**
 * Unless the project closes meanwhile, passes the open book's edited text to {@link onBookRead}'s
 * listeners once the book is read again, then reports the edit. A book that fails to read again, or
 * has no text, is reported all the same.
 *
 * When a read of the book that started later finishes before this text arrives, the edit is
 * reported without its text. That read found text at least as new, or found none.
 */
async function reportOpenBookEdit(sourceProjectId: string, held: HeldBook): Promise<void> {
  const closeCount = closeCounts.get(sourceProjectId);
  const delivered = await Promise.all([held.book, held.watch.readNumber]).then(
    ([book, readNumber]) => ({ book, readNumber }),
    () => undefined,
  );
  if (closeCounts.get(sourceProjectId) !== closeCount) return;
  if (delivered) finishRead(sourceProjectId, held.bookId, delivered.readNumber, delivered.book);
  reportEdit(sourceProjectId, held.bookId);
}

/**
 * Finds the source project's book tokenized under the project's language tag, and keeps it as the
 * project's latest book, and as its open book too when `isOpen` and no later outline request has
 * started. A kept book is served again until its text changes, another book takes its place, or
 * {@link closeProject} lets it go.
 */
async function heldBook(
  sourceProjectId: string,
  bookId: string,
  isOpen = false,
): Promise<HeldBook> {
  const closeCount = closeCounts.get(sourceProjectId);
  const outlineCount = (outlineCounts.get(sourceProjectId) ?? 0) + 1;
  if (isOpen) outlineCounts.set(sourceProjectId, outlineCount);
  const writingSystem = await getWritingSystem(sourceProjectId);
  if (closeCounts.get(sourceProjectId) !== closeCount) {
    // The project closed while its tag was read, so the book is served but not kept.
    const book = holdBook(sourceProjectId, bookId, writingSystem);
    releaseBook(sourceProjectId, book.watch);
    return book;
  }
  const latest = latestBooks.get(sourceProjectId);
  const open = openBooks.get(sourceProjectId);
  const held =
    [latest, open].find(
      (kept) => kept?.bookId === bookId && kept.writingSystem === writingSystem,
    ) ?? holdBook(sourceProjectId, bookId, writingSystem);
  latestBooks.set(sourceProjectId, held);
  if (isOpen && outlineCounts.get(sourceProjectId) === outlineCount)
    openBooks.set(sourceProjectId, held);
  dropUnlessKept(sourceProjectId, latest);
  dropUnlessKept(sourceProjectId, open);
  return held;
}

/**
 * Tokenizes a book of the source project under the project's language tag.
 *
 * @returns The tokenized `Book` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book's text or the project's language tag cannot be read, or the text cannot be
 *   tokenized.
 */
export async function getTokenizedBook(
  sourceProjectId: string,
  bookId: string,
): Promise<string | undefined> {
  const held = await heldBook(sourceProjectId, bookId);
  held.json ??= held.book.then(
    (book) => book && perfTime('getTokenizedBook:serialize', () => JSON.stringify(book)),
  );
  return held.json;
}

/**
 * Reads the boundaries a request names, none when it names none (over PAPI, `null`).
 *
 * @throws If they are not a JSON `SegmentationDelta`.
 */
function parseSegmentation(segmentationJson: string | undefined): SegmentationDelta | undefined {
  if (!segmentationJson) return undefined;
  const delta: unknown = JSON.parse(segmentationJson);
  if (!isSegmentationDelta(delta)) throw new Error('The segmentation is not a SegmentationDelta');
  return delta;
}

/**
 * Segments `held`'s book by the boundaries `segmentationJson` names, once for the latest boundaries
 * asked for, timed as part of `call`.
 *
 * @throws If `segmentationJson` is not a JSON `SegmentationDelta`.
 */
function segmentsOf(
  held: HeldBook,
  book: Book,
  segmentationJson: string | undefined,
  call: 'getBookOutline' | 'getSegments' | 'getBookSegments',
): readonly Segment[] {
  const key = segmentationJson || '';
  if (held.segmented?.key !== key) {
    const delta = parseSegmentation(segmentationJson);
    const segments = perfTime(
      `${call}:resegment`,
      () => resegmentBook(book, reanchorSegmentation(book, delta)).segments,
    );
    held.segmented = { key, segments };
  }
  return held.segmented.segments;
}

/**
 * Calls `listener` whenever the Scripture text changes in a book the service watches, until the
 * returned function is called. A source project's watched books are its open book, the one whose
 * outline was last asked for, and every book its whole-text read has read. Once the listener is
 * called, a request for the book reads the edit, and the whole-text read's answers include it.
 */
export function onBookTextChanged(listener: BookTextListener): () => boolean {
  bookTextListeners.add(listener);
  return () => bookTextListeners.delete(listener);
}

/**
 * Calls `listener` with each book of a source project that holds text, until the returned function
 * is called. A book is passed when the whole-text read first reaches it, and again each time its
 * text changes. The open book's edited text is passed even before the read reaches that book.
 *
 * For a change, `listener` is called before {@link onBookTextChanged}'s listeners hear of it. The
 * change's text is not passed when a read of the book that started later has finished first. That
 * read passed text at least as new, or found none. A book whose read fails, or that holds no text,
 * is not passed.
 */
export function onBookRead(listener: BookReadListener): () => boolean {
  bookReadListeners.add(listener);
  return () => bookReadListeners.delete(listener);
}

/**
 * Calls `listener` with the books of a source project that hold text, until the returned function
 * is called. `listener` is first called once the whole-text read has read every book with none
 * failed.
 *
 * `listener` is called again whenever a book gains or loses its text. `listener` is also called
 * when a retried read succeeds and no other book's read is still failing.
 */
export function onTextRead(listener: TextReadListener): () => boolean {
  textReadListeners.add(listener);
  return () => textReadListeners.delete(listener);
}

/**
 * Outlines a book of the source project: its segments, segmented by the boundaries
 * `segmentationJson` names, each without its text. The book becomes the project's open book, whose
 * edits {@link onBookTextChanged} reports.
 *
 * @returns The `BookOutline` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or tokenized, or `segmentationJson` is not a JSON
 *   `SegmentationDelta`.
 */
export async function getBookOutline(
  sourceProjectId: string,
  bookId: string,
  segmentationJson?: string,
): Promise<string | undefined> {
  const held = await heldBook(sourceProjectId, bookId, true);
  const book = await held.book;
  if (!book) return undefined;
  const segments = segmentsOf(held, book, segmentationJson, 'getBookOutline');
  return perfTime('getBookOutline:serialize', () =>
    JSON.stringify(buildBookOutline(book, segments)),
  );
}

/**
 * Finds the source project's book as the project's open or latest book holds it, so that the book
 * keeps the language tag it was last read under. A book the project keeps as neither is read under
 * the project's language tag and kept as the project's latest.
 */
async function keptBook(sourceProjectId: string, bookId: string): Promise<HeldBook> {
  return (
    [openBooks.get(sourceProjectId), latestBooks.get(sourceProjectId)].find(
      (kept) => kept?.bookId === bookId,
    ) ?? heldBook(sourceProjectId, bookId)
  );
}

/**
 * Serves the segments at outline indexes `[start, end)` of a book of the source project, segmented
 * by the boundaries `segmentationJson` names. Pages keep the language tag the book was last read
 * under, so they match its outline.
 *
 * @returns The `SegmentPage` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or tokenized, or `segmentationJson` is not a JSON
 *   `SegmentationDelta`.
 */
export async function getSegments(
  sourceProjectId: string,
  bookId: string,
  start: number,
  end: number,
  segmentationJson?: string,
): Promise<string | undefined> {
  const held = await keptBook(sourceProjectId, bookId);
  const book = await held.book;
  if (!book) return undefined;
  const segments = segmentsOf(held, book, segmentationJson, 'getSegments');
  const from = Math.max(0, start);
  const page: SegmentPage = {
    textVersion: book.textVersion,
    start: from,
    segments: segments.slice(from, Math.max(from, end)),
  };
  return perfTime('getSegments:serialize', () => JSON.stringify(page));
}

/**
 * Reads a book of the source project, tokenized one segment per verse: the book that
 * {@link getSegments} resegments into its pages. The book is shared, so the caller must not change
 * it.
 *
 * @returns `undefined` when the project has no text for the book.
 * @throws If the book's text or the project's language tag cannot be read, or the text cannot be
 *   tokenized.
 */
export async function getVerseBook(
  sourceProjectId: string,
  bookId: string,
): Promise<Book | undefined> {
  return (await keptBook(sourceProjectId, bookId)).book;
}

/**
 * Reads a book of the source project, segmented by the boundaries `segmentationJson` names, as
 * {@link getSegments} pages it. The segments are shared, so the caller must not change them.
 *
 * @returns `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or tokenized, or `segmentationJson` is not a JSON
 *   `SegmentationDelta`.
 */
export async function getBookSegments(
  sourceProjectId: string,
  bookId: string,
  segmentationJson?: string,
): Promise<readonly Segment[] | undefined> {
  const held = await keptBook(sourceProjectId, bookId);
  const book = await held.book;
  if (!book) return undefined;
  return segmentsOf(held, book, segmentationJson, 'getBookSegments');
}

/** Lets go of the source project's kept copies of `bookId`, holding its open book again at once. */
function rereadHeldBook(sourceProjectId: string, bookId: string): void {
  const open = openBooks.get(sourceProjectId);
  new Set([latestBooks.get(sourceProjectId), open]).forEach((held) => {
    if (held?.bookId === bookId) releaseBook(sourceProjectId, held.watch);
  });
  if (open?.bookId === bookId)
    openBooks.set(sourceProjectId, holdBook(sourceProjectId, bookId, open.writingSystem));
}

/**
 * Reads `bookId` of `read`'s text into its form index, and watches the book until the read ends or
 * reads it again. The book's text is passed to {@link onBookRead}'s listeners unless the whole-text
 * read has ended, or a later read of the book supersedes this one. An edit to the book lets go of
 * its kept copies, and is reported once the book is read again.
 *
 * @returns Once the book's text has arrived, whether this read filed the book as read or failed.
 */
async function readTextBook(
  sourceProjectId: string,
  read: TextRead,
  bookId: string,
): Promise<boolean> {
  read.watches.get(bookId)?.();
  const { text, readNumber, stop } = watchBookText(
    sourceProjectId,
    bookId,
    () => {
      if (textReads.get(sourceProjectId) !== read || read.watches.get(bookId) !== stop) return;
      rereadHeldBook(sourceProjectId, bookId);
      rereadTextBook(sourceProjectId, read, bookId);
    },
    read.usjPdp,
  );
  read.watches.set(bookId, stop);
  const delivered = await Promise.all([perfTrack('readText:usj', text), readNumber])
    .then(([usj, number]): { book?: Book; forms: Set<string>; readNumber: number } => {
      if (!usj) return { forms: new Set<string>(), readNumber: number };
      return perfTime('readText:tokenize', () => {
        const book = tokenizeBook(extractBookFromUsj(usj, read.writingSystem));
        return { book, forms: formsOfBook(book), readNumber: number };
      });
    })
    .catch((e) => {
      logger.warn(`Could not read ${bookId} of project ${sourceProjectId}: ${e}`);
      return undefined;
    });
  if (textReads.get(sourceProjectId) !== read) return false;
  // A later read of the book reads newer text, so this one files only a book none has filed.
  if (read.watches.get(bookId) !== stop && read.readBookIds.has(bookId)) return false;
  if (delivered) {
    read.forms.setBook(bookId, delivered.forms);
    read.failedBookIds.delete(bookId);
    if (delivered.book) read.textBookIds.add(bookId);
    else read.textBookIds.delete(bookId);
  } else {
    read.failedBookIds.add(bookId);
  }
  read.readBookIds.add(bookId);
  if (delivered) finishRead(sourceProjectId, bookId, delivered.readNumber, delivered.book);
  return true;
}

/** The books of `read`'s text that hold text, once every book is read and none failed. */
function textBookIdsOf(read: TextRead): string[] | undefined {
  if (!read.isRead || read.failedBookIds.size > 0) return undefined;
  return [...read.textBookIds];
}

/** Tells {@link onTextRead}'s listeners which books hold text, once `read` knows. */
function reportTextRead(sourceProjectId: string, read: TextRead): void {
  const textBookIds = textBookIdsOf(read);
  if (textBookIds)
    textReadListeners.forEach((listener) => listener(sourceProjectId, [...textBookIds]));
}

/**
 * Reads `bookId` of `read`'s text again, then reports its edit unless the read has ended, a later
 * read of the book will report it, or the book failed to read both before and again. Reports the
 * books holding text first when the read changes which they are, or when the read clears a
 * failure.
 */
async function rereadTextBook(
  sourceProjectId: string,
  read: TextRead,
  bookId: string,
): Promise<void> {
  const wasFailed = read.failedBookIds.has(bookId);
  const hadText = read.textBookIds.has(bookId);
  if (!(await readTextBook(sourceProjectId, read, bookId))) return;
  const isFailed = read.failedBookIds.has(bookId);
  if (!isFailed && (wasFailed || hadText !== read.textBookIds.has(bookId)))
    reportTextRead(sourceProjectId, read);
  // Core calls back with an error after every save while a book can't be read.
  if (!wasFailed || !isFailed) reportEdit(sourceProjectId, bookId);
}

/** Lists the source project's books in canonical order, with the tag their text is written in. */
async function listBooks(
  sourceProjectId: string,
): Promise<{ bookIds: string[]; writingSystem: string }> {
  const basePdp = await papi.projectDataProviders.get('platform.base', sourceProjectId);
  const [booksPresent, writingSystem] = await Promise.all([
    basePdp.getSetting('platformScripture.booksPresent'),
    getWritingSystem(sourceProjectId),
  ]);
  return { bookIds: presentBookIds(booksPresent), writingSystem };
}

/** Reads each book of `read`'s text once the books are listed. Resolves once the read ends. */
async function readText(sourceProjectId: string, read: TextRead): Promise<void> {
  const isCurrent = () => textReads.get(sourceProjectId) === read;
  const listed = await read.listed.catch(() => {
    // Dropped before the failure reaches any request, so the next request starts the read again.
    if (isCurrent()) textReads.delete(sourceProjectId);
    return undefined;
  });
  if (!listed || !isCurrent()) return;
  read.writingSystem = listed.writingSystem;
  const unread = [...listed.bookIds];
  const readNext = async (): Promise<void> => {
    const bookId = unread.shift();
    if (bookId === undefined || !isCurrent()) return;
    await readTextBook(sourceProjectId, read, bookId);
    await readNext();
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, readNext));
  if (!isCurrent()) return;
  read.isRead = true;
  reportTextRead(sourceProjectId, read);
}

/** Starts reading the source project's whole text. */
function beginTextRead(sourceProjectId: string): TextRead {
  const usjPdp = papi.projectDataProviders.get('platformScripture.USJ_Book', sourceProjectId);
  const read: TextRead = {
    listed: Promise.all([listBooks(sourceProjectId), usjPdp]).then(([listed]) => listed),
    usjPdp,
    writingSystem: '',
    isRead: false,
    readBookIds: new Set(),
    failedBookIds: new Set(),
    textBookIds: new Set(),
    forms: new FormIndex(),
    watches: new Map(),
  };
  textReads.set(sourceProjectId, read);
  perfTrack('readText', readText(sourceProjectId, read));
  return read;
}

/**
 * Reports how far reading the source project's whole text has got, starting the read when the
 * project has none. The read keeps a form index that {@link isFormInText} answers from, and watches
 * each book it has read, reporting its edits through {@link onBookTextChanged}, until the read
 * ends.
 *
 * @returns Once the text's books are known, the `TextReadStatus` as JSON.
 * @throws If the books or the provider of their text cannot be got. The read is dropped, so the
 *   next request starts it again.
 */
export async function getTextReadStatus(sourceProjectId: string): Promise<string> {
  const read = textReads.get(sourceProjectId) ?? beginTextRead(sourceProjectId);
  const { bookIds } = await read.listed;
  const { readBookIds, failedBookIds } = read;
  const status: TextReadStatus = {
    booksRead: readBookIds.size,
    bookCount: bookIds.length,
    failedBookIds: bookIds.filter((bookId) => failedBookIds.has(bookId)),
  };
  return JSON.stringify(status);
}

/**
 * Whether the source project's whole text holds `form`, matched as analyses match forms.
 *
 * @returns `undefined` until every book has been read, and while any book's latest read has failed.
 */
export function isFormInText(sourceProjectId: string, form: string): boolean | undefined {
  const read = textReads.get(sourceProjectId);
  if (!read?.isRead || read.failedBookIds.size > 0) return undefined;
  return read.forms.has(normalizeSurfaceForm(form));
}

/**
 * Starts reading the source project's whole text afresh, ending any read already under way, so that
 * {@link onBookRead}'s listeners hear again of each book holding text, and {@link onTextRead}'s hear
 * once the read is done. A failure to list the books is left for {@link getTextReadStatus} to
 * report.
 *
 * The read lasts until {@link stopTextRead}; closing the project leaves it running.
 *
 * @returns Once the read it replaced has stopped watching its books; the new read goes on.
 */
export function startTextRead(sourceProjectId: string): Promise<void> {
  heldReads.add(sourceProjectId);
  const ended = endTextRead(sourceProjectId);
  beginTextRead(sourceProjectId);
  return ended;
}

/** Ends the source project's whole-text read, leaving the books its view keeps. */
export async function stopTextRead(sourceProjectId: string): Promise<void> {
  heldReads.delete(sourceProjectId);
  await endTextRead(sourceProjectId);
}

/** Forgets the source project's whole-text read, and stops watching each book it read. */
async function endTextRead(sourceProjectId: string): Promise<void> {
  const read = textReads.get(sourceProjectId);
  textReads.delete(sourceProjectId);
  await Promise.all([...(read?.watches.values() ?? [])].map((stop) => stop()));
}

/** Lets go of the books kept for the source project. */
async function releaseKeptBooks(sourceProjectId: string): Promise<void> {
  const kept = new Set([latestBooks.get(sourceProjectId), openBooks.get(sourceProjectId)]);
  await Promise.all([...kept].map((held) => held && releaseBook(sourceProjectId, held.watch)));
}

/**
 * Lets go of the books kept for the source project, and of any a request under way would keep. Ends
 * the project's whole-text read too, except between {@link startTextRead} and {@link stopTextRead}.
 */
export async function closeProject(sourceProjectId: string): Promise<void> {
  closeCounts.set(sourceProjectId, (closeCounts.get(sourceProjectId) ?? 0) + 1);
  await Promise.all([
    releaseKeptBooks(sourceProjectId),
    !heldReads.has(sourceProjectId) && endTextRead(sourceProjectId),
  ]);
}

/**
 * Lets go of every book kept, and ends every whole-text read, those {@link startTextRead} began
 * included.
 */
export async function closeAllProjects(): Promise<void> {
  const sourceProjectIds = new Set([
    ...latestBooks.keys(),
    ...openBooks.keys(),
    ...textReads.keys(),
  ]);
  heldReads.clear();
  await Promise.all(
    [...sourceProjectIds].map((sourceProjectId) =>
      Promise.all([releaseKeptBooks(sourceProjectId), endTextRead(sourceProjectId)]),
    ),
  );
}
