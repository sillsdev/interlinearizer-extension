import papi, { logger } from '@papi/backend';
import type { Book, Segment, SegmentationDelta } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import { isPlatformError } from 'platform-bible-utils';
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
  /** Whether subscribing to the book's USJ succeeded, so that edits to it can be heard. */
  isSubscribed: Promise<boolean>;
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
 * How many books each pass of a whole-text read reads at once: the first pass, and each retry of
 * books it could not subscribe to, which may overlap it. Enough to keep the provider busy while
 * earlier books are tokenized, few enough to bound the fetches in flight.
 */
const READ_CONCURRENCY = 4;

/** A source project's whole text, read book by book into a form index, each book watched for edits. */
interface TextRead {
  state: TextReadStatus['state'];
  /** The text's books in canonical order; empty until they are known. */
  bookIds: string[];
  /** The tag the books are tokenized under; `''` until the books are known. */
  writingSystem: string;
  /** Books read at least once, whether or not they failed. */
  readBookIds: Set<string>;
  /** Books whose latest read failed. */
  failedBookIds: Set<string>;
  /** Failed books with no subscription to hear an edit through, read again on the next status. */
  unsubscribedBookIds: Set<string>;
  forms: FormIndex;
  /** Stops watching each book the read has started, by book id. */
  watches: Map<string, () => Promise<void>>;
}

/**
 * Each source project's whole-text read, from the first status asked for until the project closes,
 * or until the read reports its books unlisted.
 */
const textReads = new Map<string, TextRead>();

/** Receives the source project and book of each edit to a watched book's text. */
type BookTextListener = (sourceProjectId: string, bookId: string) => void;

const bookTextListeners = new Set<BookTextListener>();

function reportEdit(sourceProjectId: string, bookId: string): void {
  bookTextListeners.forEach((listener) => listener(sourceProjectId, bookId));
}

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
): BookTextWatch {
  const {
    promise: text,
    resolve: resolveText,
    reject: rejectText,
  } = Promise.withResolvers<UsjDocument | undefined>();
  let isFirstDelivery = true;
  const subscription = papi.projectDataProviders
    .get('platformScripture.USJ_Book', sourceProjectId)
    .then((pdp) =>
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
    isSubscribed: subscription.then(
      () => true,
      () => false,
    ),
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
 * Reads `bookId` of `read`'s text into its form index, and watches the book until the read ends or
 * reads it again. An edit to the book lets go of its kept copies, and is reported once the book is
 * read again.
 *
 * @returns Once the book's text has arrived, whether this read filed the book as read or failed.
 */
async function readTextBook(
  sourceProjectId: string,
  read: TextRead,
  bookId: string,
): Promise<boolean> {
  read.watches.get(bookId)?.();
  const { text, isSubscribed, stop } = watchBookText(sourceProjectId, bookId, () => {
    if (textReads.get(sourceProjectId) !== read || read.watches.get(bookId) !== stop) return;
    rereadHeldBook(sourceProjectId, bookId);
    rereadTextBook(sourceProjectId, read, bookId);
  });
  read.watches.set(bookId, stop);
  const formsRead = perfTrack('readText:usj', text)
    .then((usj) =>
      usj
        ? perfTime('readText:tokenize', () =>
            formsOfBook(tokenizeBook(extractBookFromUsj(usj, read.writingSystem))),
          )
        : new Set<string>(),
    )
    .catch((e) => {
      logger.warn(`Could not read ${bookId} of project ${sourceProjectId}: ${e}`);
      return undefined;
    });
  const [forms, subscribed] = await Promise.all([formsRead, isSubscribed]);
  if (textReads.get(sourceProjectId) !== read) return false;
  // A later read of the book reads newer text, so this one files only a book none has filed.
  if (read.watches.get(bookId) !== stop && read.readBookIds.has(bookId)) return false;
  if (forms) {
    read.forms.setBook(bookId, forms);
    read.failedBookIds.delete(bookId);
  } else {
    read.failedBookIds.add(bookId);
  }
  if (subscribed) read.unsubscribedBookIds.delete(bookId);
  else read.unsubscribedBookIds.add(bookId);
  read.readBookIds.add(bookId);
  return true;
}

/**
 * Reads `bookId` of `read`'s text again, then reports its edit unless the read has ended or a later
 * read of the book will report it.
 */
async function rereadTextBook(
  sourceProjectId: string,
  read: TextRead,
  bookId: string,
): Promise<void> {
  if (await readTextBook(sourceProjectId, read, bookId)) reportEdit(sourceProjectId, bookId);
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

/**
 * Reads `bookIds` of `read`'s text, {@link READ_CONCURRENCY} at a time, until all are read or the
 * read ends.
 */
async function readBooks(
  sourceProjectId: string,
  read: TextRead,
  bookIds: string[],
): Promise<void> {
  const unread = [...bookIds];
  const readNext = async (): Promise<void> => {
    const bookId = unread.shift();
    if (bookId === undefined || textReads.get(sourceProjectId) !== read) return;
    await readTextBook(sourceProjectId, read, bookId);
    await readNext();
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, readNext));
}

/** Lists the books of `read`'s text, then reads each of them. Resolves once the read ends. */
async function readText(sourceProjectId: string, read: TextRead): Promise<void> {
  const isCurrent = () => textReads.get(sourceProjectId) === read;
  const listed = await listBooks(sourceProjectId).catch((e) => {
    logger.warn(`Could not list the books of project ${sourceProjectId}: ${e}`);
    return undefined;
  });
  if (!isCurrent()) return;
  if (!listed) {
    read.state = 'unlisted';
    return;
  }
  read.bookIds = listed.bookIds;
  read.writingSystem = listed.writingSystem;
  read.state = 'reading';
  await readBooks(sourceProjectId, read, read.bookIds);
  if (isCurrent()) read.state = 'read';
}

/**
 * Reports how far reading the source project's whole text has got, starting the read when the
 * project has none. A read whose books could not be listed is reported once, then started again on
 * the next request. Each request also reads again any book that failed with no subscription to hear
 * an edit through. The read keeps a form index that {@link isFormInText} answers from, and watches
 * each book it has read, reporting its edits through {@link onBookTextChanged}, until the project
 * closes.
 *
 * @returns The `TextReadStatus` as JSON.
 */
export function getTextReadStatus(sourceProjectId: string): string {
  let read = textReads.get(sourceProjectId);
  if (!read) {
    read = {
      state: 'listing',
      bookIds: [],
      writingSystem: '',
      readBookIds: new Set(),
      failedBookIds: new Set(),
      unsubscribedBookIds: new Set(),
      forms: new FormIndex(),
      watches: new Map(),
    };
    textReads.set(sourceProjectId, read);
    perfTrack('readText', readText(sourceProjectId, read));
  }
  const unsubscribed = [...read.unsubscribedBookIds];
  read.unsubscribedBookIds.clear();
  readBooks(sourceProjectId, read, unsubscribed);
  const { state, bookIds, readBookIds, failedBookIds } = read;
  if (state === 'unlisted') textReads.delete(sourceProjectId);
  const status: TextReadStatus = {
    state,
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
  if (read?.state !== 'read' || read.failedBookIds.size > 0) return undefined;
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
