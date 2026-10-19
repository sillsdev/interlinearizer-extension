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
const heldBooks = new Map<string, HeldBook>();

/** Tells a request whether its project closed while it was under way. */
const closeCounts = new Map<string, number>();

/**
 * Each source project's open book, the one whose outline was last asked for, watched apart from
 * {@link heldBooks} since reading other books replaces the held one.
 */
const openBooks = new Map<string, { bookId: string; watch: BookTextWatch }>();

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

/** Stops watching `watch`'s book, and forgets it unless another book has replaced it. */
function releaseBook(sourceProjectId: string, watch: BookTextWatch): Promise<void> {
  if (heldBooks.get(sourceProjectId)?.watch === watch) heldBooks.delete(sourceProjectId);
  return watch.stop();
}

function holdBook(sourceProjectId: string, bookId: string, writingSystem: string): HeldBook {
  const watch = watchBookText(sourceProjectId, bookId, () => releaseBook(sourceProjectId, watch));
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
 * Finds the source project's book tokenized under the project's language tag. Each project's latest
 * book is kept, and served again until its text changes or {@link closeProject} lets it go.
 */
async function heldBook(sourceProjectId: string, bookId: string): Promise<HeldBook> {
  const closeCount = closeCounts.get(sourceProjectId);
  const writingSystem = await getWritingSystem(sourceProjectId);
  if (closeCounts.get(sourceProjectId) !== closeCount) {
    // The project closed while its tag was read, so the book is served but not kept.
    const book = holdBook(sourceProjectId, bookId, writingSystem);
    releaseBook(sourceProjectId, book.watch);
    return book;
  }
  const held = heldBooks.get(sourceProjectId);
  if (held?.bookId === bookId && held.writingSystem === writingSystem) return held;
  if (held) releaseBook(sourceProjectId, held.watch);
  const book = holdBook(sourceProjectId, bookId, writingSystem);
  heldBooks.set(sourceProjectId, book);
  return book;
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
 * Makes `bookId` the source project's open book, watching it in place of the previous open book. A
 * no-op when it is already the open book.
 */
function watchOpenBook(sourceProjectId: string, bookId: string): void {
  const open = openBooks.get(sourceProjectId);
  if (open?.bookId === bookId) return;
  open?.watch.stop();
  const watch = watchBookText(sourceProjectId, bookId, () => {
    // Either watch may hear of the edit first, so the held text goes before any listener refetches.
    const held = heldBooks.get(sourceProjectId);
    if (held?.bookId === bookId) releaseBook(sourceProjectId, held.watch);
    openBookTextListeners.forEach((listener) => listener(sourceProjectId, bookId));
  });
  // A read failure reaches whoever requests the text. Forgetting the watch lets the next outline
  // watch again; stopping it ends a subscription an error delivery leaves open.
  watch.text.catch(() => {
    if (openBooks.get(sourceProjectId)?.watch !== watch) return;
    openBooks.delete(sourceProjectId);
    watch.stop();
  });
  openBooks.set(sourceProjectId, { bookId, watch });
}

function closeOpenBook(sourceProjectId: string): Promise<void> {
  const open = openBooks.get(sourceProjectId);
  if (!open) return Promise.resolve();
  openBooks.delete(sourceProjectId);
  return open.watch.stop();
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
  watchOpenBook(sourceProjectId, bookId);
  const held = await heldBook(sourceProjectId, bookId);
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
  const kept = heldBooks.get(sourceProjectId);
  const held = kept?.bookId === bookId ? kept : await heldBook(sourceProjectId, bookId);
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
 * Lets go of the book kept for the source project, and of any a request under way would keep, and
 * stops watching its open book.
 */
export async function closeProject(sourceProjectId: string): Promise<void> {
  closeCounts.set(sourceProjectId, (closeCounts.get(sourceProjectId) ?? 0) + 1);
  const held = heldBooks.get(sourceProjectId);
  await Promise.all([
    held && releaseBook(sourceProjectId, held.watch),
    closeOpenBook(sourceProjectId),
  ]);
}

/** Lets go of every book kept, and stops watching every open book. */
export async function closeAllProjects(): Promise<void> {
  await Promise.all([
    ...[...heldBooks].map(([sourceProjectId, { watch }]) => releaseBook(sourceProjectId, watch)),
    ...[...openBooks.keys()].map(closeOpenBook),
  ]);
}
