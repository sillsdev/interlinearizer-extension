import papi, { logger } from '@papi/backend';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import { isPlatformError } from 'platform-bible-utils';
import { perfTime, perfTrack } from '../utils/perf-marks';

interface BookTextWatch {
  /** The text as first delivered; `undefined` when the project has no text for the book. */
  text: Promise<UsjDocument | undefined>;
  stop: () => Promise<void>;
}

/** A source project's book, kept tokenized until its text changes or the project closes. */
interface HeldBook {
  bookId: string;
  writingSystem: string;
  /** The tokenized `Book` as JSON; `undefined` when the project has no text for the book. */
  json: Promise<string | undefined>;
  watch: BookTextWatch;
}

/** Each source project's most recently requested book. */
const heldBooks = new Map<string, HeldBook>();

/** Tells a request whether its project closed while it was under way. */
const closeCounts = new Map<string, number>();

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

function tokenizeToJson(usj: UsjDocument, writingSystem: string): string {
  const book = perfTime(
    'getTokenizedBook:tokenize',
    () => tokenizeBook(extractBookFromUsj(usj, writingSystem)),
    { writingSystem },
  );
  return perfTime('getTokenizedBook:serialize', () => JSON.stringify(book));
}

function holdBook(sourceProjectId: string, bookId: string, writingSystem: string): HeldBook {
  const watch = watchBookText(sourceProjectId, bookId, () => releaseBook(sourceProjectId, watch));
  const json = perfTrack('getTokenizedBook:usj', watch.text).then(
    (usj) => usj && tokenizeToJson(usj, writingSystem),
  );
  json.catch(() => releaseBook(sourceProjectId, watch));
  return { bookId, writingSystem, json, watch };
}

/**
 * Tokenizes a book of the source project under the project's language tag. Each project's latest
 * book is kept, and served again until its text changes or {@link closeProject} lets it go.
 *
 * @returns The tokenized `Book` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book's text or the project's language tag cannot be read, or the text cannot be
 *   tokenized.
 */
export async function getTokenizedBook(
  sourceProjectId: string,
  bookId: string,
): Promise<string | undefined> {
  const closeCount = closeCounts.get(sourceProjectId);
  const writingSystem = await getWritingSystem(sourceProjectId);
  if (closeCounts.get(sourceProjectId) !== closeCount) {
    // The project closed while its tag was read, so the book is served but not kept.
    const book = holdBook(sourceProjectId, bookId, writingSystem);
    releaseBook(sourceProjectId, book.watch);
    return book.json;
  }
  const held = heldBooks.get(sourceProjectId);
  if (held?.bookId === bookId && held.writingSystem === writingSystem) return held.json;
  if (held) releaseBook(sourceProjectId, held.watch);
  const book = holdBook(sourceProjectId, bookId, writingSystem);
  heldBooks.set(sourceProjectId, book);
  return book.json;
}

/** Lets go of the book kept for the source project, and of any a request under way would keep. */
export async function closeProject(sourceProjectId: string): Promise<void> {
  closeCounts.set(sourceProjectId, (closeCounts.get(sourceProjectId) ?? 0) + 1);
  const held = heldBooks.get(sourceProjectId);
  if (held) await releaseBook(sourceProjectId, held.watch);
}

/** Lets go of every book kept. */
export async function closeAllProjects(): Promise<void> {
  await Promise.all(
    [...heldBooks].map(([sourceProjectId, { watch }]) => releaseBook(sourceProjectId, watch)),
  );
}
