import papi, { logger } from '@papi/backend';
import type { Book, Segment, SegmentationDelta } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import { isPlatformError } from 'platform-bible-utils';
import { isSegmentationDelta } from '../types/type-guards';
import type { SegmentPage } from '../types/segment-pages';
import { buildBookOutline } from '../utils/book-outline';
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
 * other books are read, and its edits are reported to {@link onOpenBookTextChanged}'s listeners.
 */
const openBooks = new Map<string, HeldBook>();

/** Tells a request whether its project closed while it was under way. */
const closeCounts = new Map<string, number>();

/** Receives the source project and book of each edit to an open book's text. */
type OpenBookTextListener = (sourceProjectId: string, bookId: string) => void;

const openBookTextListeners = new Set<OpenBookTextListener>();

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
    // Read again at once, so the book stays watched and a refetch the listeners start reads the
    // edit.
    openBooks.set(sourceProjectId, holdBook(sourceProjectId, bookId, writingSystem));
    openBookTextListeners.forEach((listener) => listener(sourceProjectId, bookId));
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
 * project's latest book, and as its open book too when `isOpen`. A kept book is served again until
 * its text changes, another book takes its place, or {@link closeProject} lets it go.
 */
async function heldBook(
  sourceProjectId: string,
  bookId: string,
  isOpen = false,
): Promise<HeldBook> {
  const closeCount = closeCounts.get(sourceProjectId);
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
  if (isOpen) openBooks.set(sourceProjectId, held);
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
 * Calls `listener` whenever the Scripture text of a source project's open book changes, until the
 * returned function is called. A project's open book is the one whose outline was last asked for,
 * and a book requested once the listener is called reads the edit.
 */
export function onOpenBookTextChanged(listener: OpenBookTextListener): () => boolean {
  openBookTextListeners.add(listener);
  return () => openBookTextListeners.delete(listener);
}

/**
 * Outlines a book of the source project: its segments, segmented by the boundaries
 * `segmentationJson` names, each without its text. The book becomes the project's open book, whose
 * edits {@link onOpenBookTextChanged} reports.
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

/** Lets go of the books kept for the source project. */
async function releaseProject(sourceProjectId: string): Promise<void> {
  const kept = new Set([latestBooks.get(sourceProjectId), openBooks.get(sourceProjectId)]);
  await Promise.all([...kept].map((held) => held && releaseBook(sourceProjectId, held.watch)));
}

/** Lets go of the books kept for the source project, and of any a request under way would keep. */
export async function closeProject(sourceProjectId: string): Promise<void> {
  closeCounts.set(sourceProjectId, (closeCounts.get(sourceProjectId) ?? 0) + 1);
  await releaseProject(sourceProjectId);
}

/** Lets go of every book kept. */
export async function closeAllProjects(): Promise<void> {
  const sourceProjectIds = new Set([...latestBooks.keys(), ...openBooks.keys()]);
  await Promise.all([...sourceProjectIds].map(releaseProject));
}
