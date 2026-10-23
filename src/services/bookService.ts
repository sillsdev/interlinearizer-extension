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
 * Each source project's whole-text read, from the first status asked for until the project closes,
 * or until its books could not be listed.
 */
const textReads = new Map<string, TextRead>();

/** Receives the source project and book of each edit to a watched book's text. */
type BookTextListener = (sourceProjectId: string, bookId: string) => void;

const bookTextListeners = new Set<BookTextListener>();

function reportEdit(sourceProjectId: string, bookId: string): void {
  bookTextListeners.forEach((listener) => listener(sourceProjectId, bookId));
}

/** Receives the source project and tokenized text of each book a whole-text read files. */
type BookReadListener = (sourceProjectId: string, book: Book) => void;

const bookReadListeners = new Set<BookReadListener>();

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
  const subscription = usjPdp.then((pdp) =>
    // PAPI calls back after the first delivery only for text that differs from the last, or for
    // an error reading it again.
    pdp.subscribeBookUSJ({ book: bookId, chapterNum: 1, verseNum: 1 }, (usj) => {
      if (!isFirstDelivery) {
        onChange();
        return;
      }
      isFirstDelivery = false;
      if (isPlatformError(usj)) rejectText(new Error(usj.message));
      else resolveText(usj);
    }),
  );
  subscription.catch(rejectText);

  return {
    text,
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
    openBooks.set(sourceProjectId, holdBook(sourceProjectId, bookId, writingSystem));
    // The whole-text read's watch may have first read the book before the edit or after it, so the
    // read itself reads the book again over a new watch and reports the edit.
    const read = textReads.get(sourceProjectId);
    if (read?.watches.has(bookId)) rereadTextBook(sourceProjectId, read, bookId);
    else reportEdit(sourceProjectId, bookId);
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
  call: 'getBookOutline' | 'getSegments',
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
 * Calls `listener` with each book that a source project's whole-text read files with text, until
 * the returned function is called: as the read first reaches the book, and again each time the
 * book's text changes. For a change, `listener` is called before {@link onBookTextChanged}'s
 * listeners hear of it. A book whose read fails, or that has no text, is not passed.
 */
export function onBookRead(listener: BookReadListener): () => boolean {
  bookReadListeners.add(listener);
  return () => bookReadListeners.delete(listener);
}

/**
 * Calls `listener` with the books of a source project's text that hold text, until the returned
 * function is called: once its whole-text read has read every book with none failed, and again
 * whenever a book's text appears or goes, or its failed read is the last to read again.
 */
export function onTextRead(listener: TextReadListener): () => boolean {
  textReadListeners.add(listener);
  return () => textReadListeners.delete(listener);
}

/**
 * The books of the source project's text that hold text, as {@link onTextRead} last reported them.
 *
 * @returns `undefined` until the project's whole-text read has read every book, and while any
 *   book's latest read has failed.
 */
export function getTextBookIds(sourceProjectId: string): string[] | undefined {
  const read = textReads.get(sourceProjectId);
  return read && textBookIdsOf(read);
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
  const held =
    [openBooks.get(sourceProjectId), latestBooks.get(sourceProjectId)].find(
      (kept) => kept?.bookId === bookId,
    ) ?? (await heldBook(sourceProjectId, bookId));
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
 * Reads `bookId` of `read`'s text into its form index, passing its text to {@link onBookRead}'s
 * listeners, and watches the book until the read ends or reads it again. An edit to the book lets
 * go of its kept copies, and is reported once the book is read again.
 *
 * @returns Once the book's text has arrived, whether this read filed the book as read or failed.
 */
async function readTextBook(
  sourceProjectId: string,
  read: TextRead,
  bookId: string,
): Promise<boolean> {
  read.watches.get(bookId)?.();
  const { text, stop } = watchBookText(
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
  const delivered = await perfTrack('readText:usj', text)
    .then((usj): { book?: Book; forms: Set<string> } => {
      if (!usj) return { forms: new Set<string>() };
      return perfTime('readText:tokenize', () => {
        const book = tokenizeBook(extractBookFromUsj(usj, read.writingSystem));
        return { book, forms: formsOfBook(book) };
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
  const book = delivered?.book;
  if (book) bookReadListeners.forEach((listener) => listener(sourceProjectId, book));
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
 * books holding text first when the read changes which they are, or clears a failure.
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
function startTextRead(sourceProjectId: string): TextRead {
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
 * each book it has read, reporting its edits through {@link onBookTextChanged}, until the project
 * closes.
 *
 * @returns Once the text's books are known, the `TextReadStatus` as JSON.
 * @throws If the books or the provider of their text cannot be got. The read is dropped, so the
 *   next request starts it again.
 */
export async function getTextReadStatus(sourceProjectId: string): Promise<string> {
  const read = textReads.get(sourceProjectId) ?? startTextRead(sourceProjectId);
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

/** Lets go of the books kept for the source project, and ends its whole-text read. */
async function releaseProject(sourceProjectId: string): Promise<void> {
  const kept = new Set([latestBooks.get(sourceProjectId), openBooks.get(sourceProjectId)]);
  const read = textReads.get(sourceProjectId);
  textReads.delete(sourceProjectId);
  await Promise.all([
    ...[...kept].map((held) => held && releaseBook(sourceProjectId, held.watch)),
    ...[...(read?.watches.values() ?? [])].map((stop) => stop()),
  ]);
}

/**
 * Lets go of the books kept for the source project, and of any a request under way would keep, and
 * ends its whole-text read.
 */
export async function closeProject(sourceProjectId: string): Promise<void> {
  closeCounts.set(sourceProjectId, (closeCounts.get(sourceProjectId) ?? 0) + 1);
  await releaseProject(sourceProjectId);
}

/** Lets go of every book kept, and ends every whole-text read. */
export async function closeAllProjects(): Promise<void> {
  const sourceProjectIds = new Set([
    ...latestBooks.keys(),
    ...openBooks.keys(),
    ...textReads.keys(),
  ]);
  await Promise.all([...sourceProjectIds].map(releaseProject));
}
