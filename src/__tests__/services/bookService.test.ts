/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { Book, SegmentationDelta } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import {
  closeAllProjects,
  closeProject,
  getBookOutline,
  getBookSegments,
  getSegments,
  getTextReadStatus,
  getTokenizedBook,
  getVerseBook,
  getWritingSystem,
  isFormInText,
  onBookRead,
  onBookTextChanged,
  onTextRead,
  startTextRead,
  stopTextRead,
} from '../../services/bookService';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
import type { TextReadStatus } from '../../types/text-read-status';
import { buildBookOutline } from '../../utils/book-outline';
import * as perfMarks from '../../utils/perf-marks';
import { reanchorSegmentation } from '../../utils/segmentation';
import { makeSegment, makeWordToken } from '../test-helpers';

// Tokenizing is the parsers' concern; these stand-ins name the book, text and tag they came from.
jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');
// Segmenting and outlining have suites of their own; these stand-ins record what they were given.
jest.mock('parsers/papi/resegmentBook');
jest.mock('../../utils/book-outline');
jest.mock('../../utils/segmentation');

function isBackendMock(m: unknown): m is { __mockProjectDataProvidersGet: jest.Mock } {
  return !!m && typeof m === 'object' && '__mockProjectDataProvidersGet' in m;
}

if (!isBackendMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend');
const { __mockProjectDataProvidersGet: mockPdpGet } = papiBackendMock;

type Delivery = UsjDocument | undefined | { message: string; platformErrorVersion: number };

/** One subscription the service made to a book's USJ. */
interface Subscription {
  bookId: string;
  deliver: (usj: Delivery) => void;
  isDelivered: boolean;
  unsubscribe: jest.Mock;
}

/** A stand-in USJ document naming the book and text version it holds. */
function usj(bookId: string, version = 'v1'): UsjDocument {
  return { content: [bookId, version] };
}

function platformError(message: string) {
  return { message, platformErrorVersion: 1 };
}

/**
 * Wires the providers to serve one source project. Each subscription delivers `text` for its book
 * at once unless `text` is omitted, which leaves delivering to the test. Listing the project's
 * books throws `booksPresent` when it is an error, getting the USJ provider throws
 * `usjProviderError` while it is set, and subscribing throws `subscribeError` while it is set.
 */
function serveProject(text?: (bookId: string) => Delivery) {
  const project: {
    languageTag: unknown;
    booksPresent: string | Error;
    usjProviderError: Error | undefined;
    subscribeError: Error | undefined;
    subscriptions: Subscription[];
  } = {
    languageTag: 'en',
    booksPresent: '',
    usjProviderError: undefined,
    subscribeError: undefined,
    subscriptions: [],
  };
  const subscribeBookUSJ = jest.fn(
    async ({ book }: { book: string }, callback: (usj: Delivery) => void) => {
      if (project.subscribeError) throw project.subscribeError;
      const unsubscribe = jest.fn(async () => true);
      const subscription: Subscription = {
        bookId: book,
        deliver: (delivery) => {
          subscription.isDelivered = true;
          callback(delivery);
        },
        isDelivered: false,
        unsubscribe,
      };
      project.subscriptions.push(subscription);
      if (text) queueMicrotask(() => subscription.deliver(text(book)));
      return unsubscribe;
    },
  );
  const getSetting = async (key: string) => {
    if (key !== 'platformScripture.booksPresent') return project.languageTag;
    if (project.booksPresent instanceof Error) throw project.booksPresent;
    return project.booksPresent;
  };
  mockPdpGet.mockImplementation(async (type: string) => {
    if (type === 'platform.base') return { getSetting };
    if (project.usjProviderError) throw project.usjProviderError;
    return { subscribeBookUSJ };
  });
  return project;
}

/** Lets every pending promise callback run. */
function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function parseBook(json: string | undefined): Book {
  if (!json) throw new Error('Expected a tokenized book');
  return JSON.parse(json);
}

function parseOutline(json: string | undefined): BookOutline {
  if (!json) throw new Error('Expected an outline');
  return JSON.parse(json);
}

function parsePage(json: string | undefined): SegmentPage {
  if (!json) throw new Error('Expected a page');
  return JSON.parse(json);
}

async function readStatus(sourceProjectId = 'src'): Promise<TextReadStatus> {
  return JSON.parse(await getTextReadStatus(sourceProjectId));
}

/**
 * Delivers each book a read awaits, and those it goes on to read, so a project can close without
 * waiting on a delivery.
 */
async function finishReading(project: ReturnType<typeof serveProject>) {
  const pending = project.subscriptions.filter((s) => !s.isDelivered);
  if (pending.length === 0) return;
  pending.forEach((s) => s.deliver(usj(s.bookId)));
  await settle();
  await finishReading(project);
}

/** The subscriptions made to `bookId`, oldest first. */
function subscriptionsTo(project: ReturnType<typeof serveProject>, bookId: string) {
  return project.subscriptions.filter((s) => s.bookId === bookId);
}

/**
 * Has each book tokenize to the word `shared` and a word naming its book and text version, such as
 * `GEN-v1`.
 */
function tokenizeToWords() {
  jest.mocked(tokenizeBook).mockImplementation((raw) => ({
    id: raw.bookCode,
    bookRef: raw.bookCode,
    textVersion: `${raw.contentHash}@${raw.writingSystem}`,
    duplicateVerseIds: [],
    segments: [
      makeSegment(`${raw.bookCode} 1:1`, `shared ${raw.bookCode}-${raw.contentHash}`, [
        makeWordToken(`${raw.bookCode} 1:1:0`, 'shared'),
        makeWordToken(`${raw.bookCode} 1:1:7`, `${raw.bookCode}-${raw.contentHash}`, 7),
      ]),
    ],
  }));
}

/** A tokenized Genesis 1:1–3, standing in for whatever text the project holds. */
const VERSE_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1@en',
  duplicateVerseIds: [],
  segments: [1, 2, 3].map((verse) =>
    makeSegment(`GEN 1:${verse}`, 'word', [makeWordToken(`GEN 1:${verse}:0`, 'word')]),
  ),
};

/** Has the project's text tokenize to {@link VERSE_BOOK}. */
function tokenizeToVerseBook() {
  jest.mocked(tokenizeBook).mockReturnValue(VERSE_BOOK);
}

/** Merges verse 2 into verse 1. */
const DELTA: SegmentationDelta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

/** {@link DELTA} as re-anchoring it to the book's text gives it. */
const REANCHORED: SegmentationDelta = {
  removedVerseStarts: ['GEN 1:2:0'],
  addedStarts: [{ tokenRef: 'GEN 1:3:0', surfaceText: 'word' }],
};

/** The book's segments under {@link REANCHORED}, as segmenting gives them. */
const SEGMENTED = [VERSE_BOOK.segments[0], VERSE_BOOK.segments[2]];

/** Has the book segment to {@link SEGMENTED} under any boundaries, and outline to a stand-in. */
function segmentStandIns() {
  jest.mocked(reanchorSegmentation).mockReturnValue(REANCHORED);
  jest.mocked(resegmentBook).mockImplementation((book) => ({ ...book, segments: SEGMENTED }));
  jest.mocked(buildBookOutline).mockImplementation((book, segments) => ({
    bookRef: book.bookRef,
    textVersion: book.textVersion,
    segments: segments.map((segment) => ({
      id: segment.id,
      startRef: segment.startRef,
      verseStarts: segment.verseStarts,
      tokenCount: 0,
      wordTokenCount: 0,
      textLength: 0,
    })),
  }));
}

beforeEach(() => {
  jest.mocked(extractBookFromUsj).mockImplementation((doc, writingSystem) => ({
    bookCode: String(doc.content[0]),
    contentHash: String(doc.content[1]),
    writingSystem,
    duplicateVerseIds: [],
    segments: [],
    frontMatter: [],
  }));
  jest.mocked(tokenizeBook).mockImplementation((raw) => ({
    id: raw.bookCode,
    bookRef: raw.bookCode,
    textVersion: `${raw.contentHash}@${raw.writingSystem}`,
    segments: [],
    duplicateVerseIds: [],
  }));
});

afterEach(() => closeAllProjects());

describe('getWritingSystem', () => {
  it("reads the project's language tag", async () => {
    serveProject();

    await expect(getWritingSystem('src')).resolves.toBe('en');
  });

  it('falls back to und for an empty tag', async () => {
    serveProject().languageTag = '';

    await expect(getWritingSystem('src')).resolves.toBe('und');
  });

  it('falls back to und when the project has no tag', async () => {
    serveProject().languageTag = undefined;

    await expect(getWritingSystem('src')).resolves.toBe('und');
  });
});

describe('getTokenizedBook', () => {
  it("tokenizes the book under the project's language tag", async () => {
    serveProject((bookId) => usj(bookId));

    const book = parseBook(await getTokenizedBook('src', 'GEN'));

    expect(book).toMatchObject({ bookRef: 'GEN', textVersion: 'v1@en' });
    expect(mockPdpGet).toHaveBeenCalledWith('platformScripture.USJ_Book', 'src');
  });

  it('resolves undefined when the project has no text for the book', async () => {
    serveProject(() => undefined);

    await expect(getTokenizedBook('src', 'GEN')).resolves.toBeUndefined();
  });

  it('serves a book asked for again without reading it again', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const first = await getTokenizedBook('src', 'GEN');

    const second = await getTokenizedBook('src', 'GEN');

    expect(second).toBe(first);
    expect(project.subscriptions).toHaveLength(1);
    expect(tokenizeBook).toHaveBeenCalledTimes(1);
  });

  it('tokenizes once for requests made at the same time', async () => {
    serveProject((bookId) => usj(bookId));

    const [first, second] = await Promise.all([
      getTokenizedBook('src', 'GEN'),
      getTokenizedBook('src', 'GEN'),
    ]);

    expect(second).toBe(first);
    expect(tokenizeBook).toHaveBeenCalledTimes(1);
  });

  it('tokenizes the book again once the language tag changes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');
    project.languageTag = 'fr';

    const book = parseBook(await getTokenizedBook('src', 'GEN'));

    expect(book.textVersion).toBe('v1@fr');
  });

  it('keeps the books of different projects apart', async () => {
    serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');

    await getTokenizedBook('other', 'GEN');
    await getTokenizedBook('src', 'GEN');

    expect(tokenizeBook).toHaveBeenCalledTimes(2);
  });

  it('reads the book again once its text changes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');
    const [first] = project.subscriptions;

    first.deliver(usj('GEN', 'v2'));
    await settle();
    await getTokenizedBook('src', 'GEN');

    expect(first.unsubscribe).toHaveBeenCalled();
    expect(project.subscriptions).toHaveLength(2);
  });

  it("lets go of a project's book once another of its books is asked for", async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');

    await getTokenizedBook('src', 'EXO');
    await settle();

    expect(project.subscriptions.map((s) => [s.bookId, s.unsubscribe.mock.calls.length])).toEqual([
      ['GEN', 1],
      ['EXO', 0],
    ]);
  });

  it("rejects when the book's text cannot be read", async () => {
    serveProject(() => platformError('no such book'));

    await expect(getTokenizedBook('src', 'GEN')).rejects.toThrow('no such book');
  });

  it('reads the book again after a read that failed', async () => {
    let fails = true;
    const project = serveProject((bookId) => (fails ? platformError('busy') : usj(bookId)));
    await expect(getTokenizedBook('src', 'GEN')).rejects.toThrow('busy');
    fails = false;

    const book = parseBook(await getTokenizedBook('src', 'GEN'));

    expect(book.bookRef).toBe('GEN');
    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
  });

  it('rejects when the text cannot be tokenized', async () => {
    serveProject((bookId) => usj(bookId));
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw new Error('bad text');
    });

    await expect(getTokenizedBook('src', 'GEN')).rejects.toThrow('bad text');
  });

  it("rejects when the book's text cannot be subscribed to", async () => {
    mockPdpGet.mockImplementation(async (type: string) =>
      type === 'platform.base'
        ? { getSetting: async () => 'en' }
        : { subscribeBookUSJ: async () => Promise.reject(new Error('no provider')) },
    );

    await expect(getTokenizedBook('src', 'GEN')).rejects.toThrow('no provider');
  });
});

describe('getBookOutline', () => {
  beforeEach(() => {
    tokenizeToVerseBook();
    segmentStandIns();
  });

  it('outlines the book segmented by the boundaries named, re-anchored to its text', async () => {
    serveProject((bookId) => usj(bookId));

    const outline = parseOutline(await getBookOutline('src', 'GEN', JSON.stringify(DELTA)));

    expect(reanchorSegmentation).toHaveBeenCalledWith(VERSE_BOOK, DELTA);
    expect(resegmentBook).toHaveBeenCalledWith(VERSE_BOOK, REANCHORED);
    expect(buildBookOutline).toHaveBeenCalledWith(VERSE_BOOK, SEGMENTED);
    expect(outline.segments.map((seg) => seg.id)).toEqual(['GEN 1:1', 'GEN 1:3']);
  });

  it('names no boundaries to segment by when none are given', async () => {
    serveProject((bookId) => usj(bookId));

    await getBookOutline('src', 'GEN');

    expect(reanchorSegmentation).toHaveBeenCalledWith(VERSE_BOOK, undefined);
  });

  it('names no boundaries to segment by when they arrive as null', async () => {
    serveProject((bookId) => usj(bookId));
    // Over PAPI an omitted argument arrives as null, which the signature has no room for.
    // eslint-disable-next-line no-null/no-null
    const args = ['src', 'GEN', null];

    await Reflect.apply(getBookOutline, undefined, args);

    expect(reanchorSegmentation).toHaveBeenCalledWith(VERSE_BOOK, undefined);
  });

  it('resolves undefined when the project has no text for the book', async () => {
    serveProject(() => undefined);

    await expect(getBookOutline('src', 'GEN')).resolves.toBeUndefined();
  });

  it('rejects boundaries that are not a SegmentationDelta', async () => {
    serveProject((bookId) => usj(bookId));

    await expect(getBookOutline('src', 'GEN', '{"removed":[]}')).rejects.toThrow(
      'not a SegmentationDelta',
    );
  });

  it('rejects boundaries that are not JSON', async () => {
    serveProject((bookId) => usj(bookId));

    await expect(getBookOutline('src', 'GEN', '{')).rejects.toThrow(SyntaxError);
  });

  it('tokenizes the book once for its outline and for the whole book', async () => {
    serveProject((bookId) => usj(bookId));

    await Promise.all([getTokenizedBook('src', 'GEN'), getBookOutline('src', 'GEN')]);

    expect(tokenizeBook).toHaveBeenCalledTimes(1);
  });

  it('segments the book once for its outline and its pages under the same boundaries', async () => {
    serveProject((bookId) => usj(bookId));
    const json = JSON.stringify(DELTA);

    await getBookOutline('src', 'GEN', json);
    await getSegments('src', 'GEN', 0, 2, json);

    expect(resegmentBook).toHaveBeenCalledTimes(1);
  });

  it('segments the book again for other boundaries', async () => {
    serveProject((bookId) => usj(bookId));

    await getBookOutline('src', 'GEN', JSON.stringify(DELTA));
    await getBookOutline('src', 'GEN');

    expect(resegmentBook).toHaveBeenCalledTimes(2);
  });
});

describe('getSegments', () => {
  beforeEach(() => {
    tokenizeToVerseBook();
    segmentStandIns();
  });

  it('serves the segments at the outline indexes asked for', async () => {
    serveProject((bookId) => usj(bookId));

    const page = parsePage(await getSegments('src', 'GEN', 1, 2, JSON.stringify(DELTA)));

    expect(resegmentBook).toHaveBeenCalledWith(VERSE_BOOK, REANCHORED);
    expect(page).toEqual({ textVersion: 'v1@en', start: 1, segments: [SEGMENTED[1]] });
  });

  it('serves the segments the book has of a range running past its end', async () => {
    serveProject((bookId) => usj(bookId));

    const page = parsePage(await getSegments('src', 'GEN', 1, 50));

    expect(page.segments).toEqual([SEGMENTED[1]]);
  });

  it('starts a range running before the book at its first segment', async () => {
    serveProject((bookId) => usj(bookId));

    const page = parsePage(await getSegments('src', 'GEN', -5, 1));

    expect(page).toMatchObject({ start: 0, segments: [SEGMENTED[0]] });
  });

  it('serves no segments for a range that ends before it starts', async () => {
    serveProject((bookId) => usj(bookId));

    const page = parsePage(await getSegments('src', 'GEN', 2, 1));

    expect(page.segments).toEqual([]);
  });

  it('resolves undefined when the project has no text for the book', async () => {
    serveProject(() => undefined);

    await expect(getSegments('src', 'GEN', 0, 1)).resolves.toBeUndefined();
  });

  it('times segmenting the book for a page as part of the page request', async () => {
    const timed = jest.spyOn(perfMarks, 'perfTime');
    serveProject((bookId) => usj(bookId));

    await getSegments('src', 'GEN', 0, 1);

    expect(timed).toHaveBeenCalledWith('getSegments:resegment', expect.any(Function));
  });

  it("serves a kept book's segments without reading the language tag again", async () => {
    serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    mockPdpGet.mockClear();

    await getSegments('src', 'GEN', 0, 1);

    expect(mockPdpGet).not.toHaveBeenCalledWith('platform.base', 'src');
  });

  it("reads the language tag for a book it doesn't keep", async () => {
    serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    mockPdpGet.mockClear();

    await getSegments('src', 'EXO', 0, 1);

    expect(mockPdpGet).toHaveBeenCalledWith('platform.base', 'src');
  });
});

describe('getVerseBook', () => {
  beforeEach(() => {
    tokenizeToVerseBook();
    segmentStandIns();
  });

  it('serves the book its pages are segmented from', async () => {
    serveProject((bookId) => usj(bookId));
    await getSegments('src', 'GEN', 0, 1);

    const served = await getVerseBook('src', 'GEN');

    expect(served).toBe(VERSE_BOOK);
    expect(jest.mocked(resegmentBook).mock.calls[0][0]).toBe(served);
  });

  it('serves a kept book without reading the language tag again', async () => {
    serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    mockPdpGet.mockClear();

    await getVerseBook('src', 'GEN');

    expect(mockPdpGet).not.toHaveBeenCalledWith('platform.base', 'src');
  });

  it('resolves undefined when the project has no text for the book', async () => {
    serveProject(() => undefined);

    await expect(getVerseBook('src', 'GEN')).resolves.toBeUndefined();
  });
});

describe('getBookSegments', () => {
  beforeEach(() => {
    tokenizeToVerseBook();
    segmentStandIns();
  });

  it('serves the book segmented by the boundaries named', async () => {
    serveProject((bookId) => usj(bookId));

    const segments = await getBookSegments('src', 'GEN', JSON.stringify(DELTA));

    expect(segments).toBe(SEGMENTED);
    expect(resegmentBook).toHaveBeenCalledWith(VERSE_BOOK, REANCHORED);
  });

  it('serves the segments its pages hold for the same boundaries without segmenting again', async () => {
    serveProject((bookId) => usj(bookId));
    await getSegments('src', 'GEN', 0, 1, JSON.stringify(DELTA));

    await getBookSegments('src', 'GEN', JSON.stringify(DELTA));

    expect(resegmentBook).toHaveBeenCalledTimes(1);
  });

  it('times segmenting the book as part of the request', async () => {
    const timed = jest.spyOn(perfMarks, 'perfTime');
    serveProject((bookId) => usj(bookId));

    await getBookSegments('src', 'GEN');

    expect(timed).toHaveBeenCalledWith('getBookSegments:resegment', expect.any(Function));
  });

  it('resolves undefined when the project has no text for the book', async () => {
    serveProject(() => undefined);

    await expect(getBookSegments('src', 'GEN')).resolves.toBeUndefined();
  });
});

describe('closeProject', () => {
  it("lets go of the project's book", async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');

    await closeProject('src');
    await getTokenizedBook('src', 'GEN');

    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
    expect(tokenizeBook).toHaveBeenCalledTimes(2);
  });

  it('stops watching a book only once its text has arrived', async () => {
    const project = serveProject();
    const pending = getTokenizedBook('src', 'GEN');
    await settle();
    const [subscription] = project.subscriptions;

    const closing = closeProject('src');
    await settle();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    subscription.deliver(usj('GEN'));
    await closing;

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(parseBook(await pending).bookRef).toBe('GEN');
  });

  it('does not keep a book asked for before the project closed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const pending = getTokenizedBook('src', 'GEN');

    await closeProject('src');
    const book = parseBook(await pending);
    await settle();

    expect(book.bookRef).toBe('GEN');
    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
  });

  it('keeps a book asked for after the project closed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await closeProject('src');

    await getTokenizedBook('src', 'GEN');
    await getTokenizedBook('src', 'GEN');

    expect(project.subscriptions).toHaveLength(1);
  });

  it('does nothing for a project with no book', async () => {
    await expect(closeProject('src')).resolves.toBeUndefined();
  });
});

describe('closeAllProjects', () => {
  it("lets go of every project's book", async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getTokenizedBook('src', 'GEN');
    await getTokenizedBook('other', 'EXO');

    await closeAllProjects();

    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});

describe('onBookTextChanged', () => {
  const unsubscribers: Array<() => boolean> = [];

  /** A listener registered for the test, removed once it ends. */
  function listen(onCall?: () => void) {
    const listener = jest.fn(onCall);
    unsubscribers.push(onBookTextChanged(listener));
    return listener;
  }

  beforeEach(() => {
    segmentStandIns();
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('subscribes once to a book that is outlined and read whole', async () => {
    const project = serveProject((bookId) => usj(bookId));

    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'GEN');
    await getSegments('src', 'GEN', 0, 1);

    expect(project.subscriptions).toHaveLength(1);
  });

  it('subscribes once to a book however often it is outlined', async () => {
    const project = serveProject((bookId) => usj(bookId));

    await getBookOutline('src', 'GEN');
    await getBookOutline('src', 'GEN');

    expect(project.subscriptions).toHaveLength(1);
  });

  it('keeps the outlined book while other books are read whole', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    await getTokenizedBook('src', 'LEV');
    await settle();
    jest.mocked(tokenizeBook).mockClear();

    await getTokenizedBook('src', 'GEN');
    await getBookOutline('src', 'GEN');
    const page = parsePage(await getSegments('src', 'GEN', 0, 2));

    expect(page.segments).toHaveLength(2);
    expect(tokenizeBook).not.toHaveBeenCalled();
    expect(subscriptionsTo(project, 'GEN')).toHaveLength(1);
  });

  it('lets go of a book read whole once another replaces it, but not the outlined book', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');

    await getTokenizedBook('src', 'LEV');
    await settle();

    expect(project.subscriptions.map((s) => [s.bookId, s.unsubscribe.mock.calls.length])).toEqual([
      ['GEN', 0],
      ['EXO', 1],
      ['LEV', 0],
    ]);
  });

  it('reports an edit to the outlined book with its project and book', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = listen();
    await getBookOutline('src', 'GEN');

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'GEN');
  });

  it('reports an edit to every listener', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listeners = [listen(), listen()];
    await getBookOutline('src', 'GEN');

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    listeners.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1));
  });

  it('watches the book again once an edit to it is reported', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    const [first] = project.subscriptions;

    first.deliver(usj('GEN', 'v2'));
    await settle();

    expect(subscriptionsTo(project, 'GEN')).toHaveLength(2);
    expect(first.unsubscribe).toHaveBeenCalled();
  });

  it('reads the edited text when the book is next requested', async () => {
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    await getBookOutline('src', 'GEN');
    version = 'v2';

    project.subscriptions[0].deliver(usj('GEN', version));
    await settle();

    expect(parseBook(await getTokenizedBook('src', 'GEN')).textVersion).toBe('v2@en');
  });

  it('reads the edited text after other books were read in between', async () => {
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    const listener = listen();
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    await getTokenizedBook('src', 'LEV');
    version = 'v2';

    project.subscriptions[0].deliver(usj('GEN', version));
    await settle();

    expect(listener).toHaveBeenCalledWith('src', 'GEN');
    expect(parseBook(await getTokenizedBook('src', 'GEN')).textVersion).toBe('v2@en');
    expect(parseOutline(await getBookOutline('src', 'GEN')).textVersion).toBe('v2@en');
  });

  it('reports later edits through the book watched again', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = listen();
    await getBookOutline('src', 'GEN');
    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    subscriptionsTo(project, 'GEN')[1].deliver(usj('GEN', 'v3'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the book held for another when the outlined book is edited', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    const [exo] = subscriptionsTo(project, 'EXO');

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(exo.unsubscribe).not.toHaveBeenCalled();
  });

  it('stops watching an outlined book that fails to read', async () => {
    const project = serveProject(() => platformError('busy'));

    await expect(getBookOutline('src', 'GEN')).rejects.toThrow('busy');
    await settle();

    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
  });

  it('watches an outlined book again on the next outline once it fails to read', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject(() => delivery);
    const listener = listen();
    await expect(getBookOutline('src', 'GEN')).rejects.toThrow('busy');
    await settle();
    delivery = usj('GEN');

    await getBookOutline('src', 'GEN');
    subscriptionsTo(project, 'GEN')[1].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'GEN');
  });

  it('keeps the newer outlined book when the one it replaced fails to read', async () => {
    const project = serveProject();
    getBookOutline('src', 'GEN').catch(() => undefined);
    await settle();
    const replaced = project.subscriptions[0];
    const outline = getBookOutline('src', 'EXO');
    await settle();
    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO'));
    await outline;

    replaced.deliver(platformError('busy'));
    await settle();
    await getBookOutline('src', 'EXO');

    expect(subscriptionsTo(project, 'EXO')).toHaveLength(1);
  });

  it('reports nothing for an edit to a book only read whole', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = listen();
    await getTokenizedBook('src', 'GEN');
    await getSegments('src', 'GEN', 0, 1);

    project.subscriptions[0].deliver(usj('GEN', 'v2'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops watching the previous outlined book once another is outlined', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    const [gen] = project.subscriptions;

    await getBookOutline('src', 'LEV');
    await settle();

    expect(gen.unsubscribe).toHaveBeenCalled();
  });

  it('reports edits to the newly outlined book', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = listen();
    await getBookOutline('src', 'GEN');
    await getBookOutline('src', 'EXO');

    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'EXO');
  });

  it('keeps the later outlined book open when an earlier outline reads its language tag last', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = listen();
    const tag = Promise.withResolvers<string>();
    project.languageTag = tag.promise;
    const earlier = getBookOutline('src', 'GEN');
    await settle();
    project.languageTag = 'en';
    await getBookOutline('src', 'EXO');
    tag.resolve('en');
    await earlier;

    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledWith('src', 'EXO');
  });

  it("stops watching the project's books once it closes", async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');

    await closeProject('src');

    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('stops watching an outlined book that is also the latest once the project closes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');

    await closeProject('src');

    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops watching every outlined book once all projects close', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    await getBookOutline('other', 'LEV');

    await closeAllProjects();

    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('reports an edit to a book the whole-text read has read', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '11';
    const listener = listen();
    readStatus();
    await settle();

    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'EXO');
  });

  it('reports nothing for an error on a book that still cannot be read', async () => {
    const project = serveProject(() => platformError('busy'));
    project.booksPresent = '1';
    const listener = listen();
    readStatus();
    await settle();

    subscriptionsTo(project, 'GEN').at(-1)?.deliver(platformError('busy'));
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect((await readStatus()).failedBookIds).toEqual(['GEN']);
  });

  it('reports an edit to a book that failed to read once it reads', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject(() => delivery);
    project.booksPresent = '1';
    const listener = listen();
    readStatus();
    await settle();

    delivery = usj('GEN', 'v2');
    subscriptionsTo(project, 'GEN').at(-1)?.deliver(delivery);
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports a book the whole-text read has read once it fails to read', async () => {
    let delivery: Delivery = usj('GEN');
    const project = serveProject(() => delivery);
    project.booksPresent = '1';
    const listener = listen();
    readStatus();
    await settle();

    delivery = platformError('busy');
    subscriptionsTo(project, 'GEN').at(-1)?.deliver(delivery);
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((await readStatus()).failedBookIds).toEqual(['GEN']);
  });

  it("reports an edit once the whole-text read's answers include it", async () => {
    tokenizeToWords();
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    project.booksPresent = '1';
    readStatus();
    await settle();
    const answers: unknown[] = [];
    listen(() => answers.push(isFormInText('src', 'gen-v2')));

    version = 'v2';
    project.subscriptions[0].deliver(usj('GEN', version));
    await settle();

    expect(answers).toEqual([true]);
  });

  it("reports an edit once the whole-text read's answers include it when a later edit replaces its read", async () => {
    tokenizeToWords();
    const project = serveProject();
    project.booksPresent = '1';
    readStatus();
    await settle();
    subscriptionsTo(project, 'GEN')[0].deliver(usj('GEN'));
    await settle();
    const answers: unknown[] = [];
    listen(() => answers.push(isFormInText('src', 'gen-v1')));

    subscriptionsTo(project, 'GEN')[0].deliver(usj('GEN', 'v2'));
    await settle();
    const replaced = subscriptionsTo(project, 'GEN')[1];
    replaced.deliver(usj('GEN', 'v2'));
    replaced.deliver(usj('GEN', 'v3'));
    await settle();
    subscriptionsTo(project, 'GEN')[2].deliver(usj('GEN', 'v3'));
    await settle();

    expect(answers).toEqual([false]);
  });

  it('reports an edit to the outlined book once when the whole-text read has read it too', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = listen();
    await getBookOutline('src', 'GEN');
    readStatus();
    await settle();

    subscriptionsTo(project, 'GEN').forEach((s) => s.deliver(usj('GEN', 'v2')));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports an edit to the outlined book the whole-text read has yet to read', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const listener = listen();
    const outline = getBookOutline('src', 'GEN');
    await settle();
    project.subscriptions[0].deliver(usj('GEN'));
    await outline;
    readStatus();
    await settle();

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await finishReading(project);

    expect(listener).toHaveBeenCalledWith('src', 'GEN');
  });

  it('reports an edit to the outlined book once when the whole-text read first reads the text from before it', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const listener = listen();
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    readStatus();
    await settle();
    const [, read] = subscriptionsTo(project, 'GEN');

    open.deliver(usj('GEN', 'v2'));
    read.deliver(usj('GEN'));
    await settle();
    read.deliver(usj('GEN', 'v2'));
    await finishReading(project);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports an edit to the outlined book the whole-text read first read with the edit in it', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const listener = listen();
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    readStatus();
    await settle();
    subscriptionsTo(project, 'GEN')[1].deliver(usj('GEN', 'v2'));
    await settle();

    open.deliver(usj('GEN', 'v2'));
    await settle();
    await finishReading(project);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports an edit to the outlined book the whole-text read could not watch', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = listen();
    await getBookOutline('src', 'GEN');
    project.subscribeError = new Error('no provider');
    readStatus();
    await settle();
    project.subscribeError = undefined;

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'GEN');
  });

  it('serves the edited outlined book when the whole-text read hears of the edit first', async () => {
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    project.booksPresent = '1';
    await getBookOutline('src', 'GEN');
    readStatus();
    await settle();
    const [, read] = subscriptionsTo(project, 'GEN');
    const listener = listen();

    version = 'v2';
    read.deliver(usj('GEN', version));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(parseOutline(await getBookOutline('src', 'GEN')).textVersion).toBe('v2@en');
  });

  it('reports nothing for an edit that lands while the project closes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();
    const listener = listen();

    const closing = closeProject('src');
    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await closing;
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(project.subscriptions).toHaveLength(1);
  });

  it('reports nothing for an edit read again only after the project closes', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    readStatus();
    await settle();
    await finishReading(project);
    const listener = listen();
    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    const closing = closeProject('src');
    project.subscriptions[1].deliver(usj('GEN', 'v2'));
    await closing;
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports each edit once, through the watch that heard it', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();
    const listener = listen();
    const [replaced] = project.subscriptions;
    replaced.deliver(usj('GEN', 'v2'));
    await settle();

    replaced.deliver(usj('GEN', 'v3'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(replaced.unsubscribe).toHaveBeenCalled();
  });

  it('does not call a listener once it is removed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = jest.fn();
    const unsubscribe = onBookTextChanged(listener);
    await getBookOutline('src', 'GEN');

    unsubscribe();
    project.subscriptions[0].deliver(usj('GEN', 'v2'));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onBookRead', () => {
  const unsubscribers: Array<() => boolean> = [];

  /** A listener for books read, registered for the test and removed once it ends. */
  function listenForBooks(onCall?: (sourceProjectId: string, book: Book) => void) {
    const listener = jest.fn(onCall);
    unsubscribers.push(onBookRead(listener));
    return listener;
  }

  beforeEach(() => {
    segmentStandIns();
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('passes each book the whole-text read reads, tokenized, with its project', async () => {
    tokenizeToWords();
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '101';
    const listener = listenForBooks();

    readStatus();
    await settle();

    expect(
      listener.mock.calls.map(([sourceProjectId, book]) => [sourceProjectId, book.id]),
    ).toEqual([
      ['src', 'GEN'],
      ['src', 'LEV'],
    ]);
    expect(listener.mock.calls[0][1].segments[0].tokens[1].surfaceText).toBe('GEN-v1');
  });

  it('passes no book that fails to read or has no text', async () => {
    const project = serveProject((bookId) =>
      bookId === 'GEN' ? platformError('busy') : undefined,
    );
    project.booksPresent = '11';
    const listener = listenForBooks();

    readStatus();
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('passes an edited book again before the edit is reported', async () => {
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    project.booksPresent = '1';
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(`read ${book.textVersion}`));
    unsubscribers.push(onBookTextChanged(() => heard.push('edited')));
    readStatus();
    await settle();

    version = 'v2';
    project.subscriptions[0].deliver(usj('GEN', version));
    await settle();

    expect(heard).toEqual(['read v1@en', 'read v2@en', 'edited']);
  });

  it('passes the edited open book before the edit is reported, ahead of the read', async () => {
    let version = 'v1';
    const project = serveProject((bookId) => usj(bookId, version));
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(`read ${book.textVersion}`));
    unsubscribers.push(onBookTextChanged(() => heard.push('edited')));
    await getBookOutline('src', 'GEN');

    version = 'v2';
    project.subscriptions[0].deliver(usj('GEN', version));
    await settle();

    expect(heard).toEqual(['read v2@en', 'edited']);
  });

  it("passes no text of an open book's edit that a later edit's read overtook", async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(book.textVersion));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, firstReread] = subscriptionsTo(project, 'GEN');
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');
    read.deliver(usj('GEN', 'v2'));
    await settle();
    heard.length = 0;

    read.deliver(usj('GEN', 'v3'));
    await settle();
    subscriptionsTo(project, 'GEN')
      .slice(3)
      .forEach((s) => s.deliver(usj('GEN', 'v3')));
    await settle();
    firstReread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(heard).toEqual(['v3@en']);
  });

  it("reports an open book's edit whose text a later edit's read overtook", async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const edits = jest.fn();
    unsubscribers.push(onBookTextChanged(edits));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, firstReread] = subscriptionsTo(project, 'GEN');
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');
    read.deliver(usj('GEN', 'v2'));
    await settle();

    read.deliver(usj('GEN', 'v3'));
    await settle();
    subscriptionsTo(project, 'GEN')
      .slice(3)
      .forEach((s) => s.deliver(usj('GEN', 'v3')));
    await settle();
    firstReread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(edits).toHaveBeenCalledTimes(2);
  });

  it('passes an edited book once read again after another opens, though the whole-text read fails it', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(`${book.id} ${book.textVersion}`));
    const edits = jest.fn();
    unsubscribers.push(onBookTextChanged(edits));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, reread] = subscriptionsTo(project, 'GEN');
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');

    const otherOutline = getBookOutline('src', 'EXO');
    await settle();
    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO'));
    await otherOutline;
    read.deliver(platformError('busy'));
    await settle();
    reread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(heard).toEqual(['GEN v2@en']);
    expect(edits).toHaveBeenCalledWith('src', 'GEN');
  });

  it("passes the text of an open book's edit whose later reads all failed", async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(book.textVersion));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, firstReread] = subscriptionsTo(project, 'GEN');
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');
    read.deliver(platformError('busy'));
    await settle();

    read.deliver(usj('GEN', 'v3'));
    await settle();
    subscriptionsTo(project, 'GEN')
      .slice(3)
      .forEach((s) => s.deliver(platformError('busy')));
    await settle();
    firstReread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(heard).toEqual(['v2@en']);
  });

  it("passes no text of an open book's edit that a later whole-text read overtook", async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const heard: string[] = [];
    listenForBooks((_, book) => heard.push(`${book.id} ${book.textVersion}`));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, firstReread] = subscriptionsTo(project, 'GEN');

    const otherOutline = getBookOutline('src', 'EXO');
    await settle();
    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO'));
    await otherOutline;
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');
    read.deliver(usj('GEN', 'v3'));
    await settle();
    firstReread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(heard).toEqual(['GEN v3@en']);
  });

  it("passes no text of an open book's edit once a later whole-text read finds none", async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const listener = listenForBooks();
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    open.deliver(usj('GEN', 'v2'));
    await settle();
    const [, firstReread] = subscriptionsTo(project, 'GEN');

    const otherOutline = getBookOutline('src', 'EXO');
    await settle();
    subscriptionsTo(project, 'EXO')[0].deliver(usj('EXO'));
    await otherOutline;
    readStatus();
    await settle();
    const [, , read] = subscriptionsTo(project, 'GEN');
    read.deliver(undefined);
    await settle();
    firstReread.deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports an edit to the open book that no longer reads, passing nothing', async () => {
    let delivery: Delivery = usj('GEN');
    const project = serveProject(() => delivery);
    const listener = listenForBooks();
    const edits = jest.fn();
    unsubscribers.push(onBookTextChanged(edits));
    await getBookOutline('src', 'GEN');

    delivery = platformError('busy');
    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(edits).toHaveBeenCalledTimes(1);
  });

  it('passes and reports nothing for an open book edited as the project closes', async () => {
    const project = serveProject();
    const listener = listenForBooks();
    const edits = jest.fn();
    unsubscribers.push(onBookTextChanged(edits));
    const outline = getBookOutline('src', 'GEN');
    await settle();
    project.subscriptions[0].deliver(usj('GEN'));
    await outline;

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    const closed = closeProject('src');
    await settle();
    subscriptionsTo(project, 'GEN')[1].deliver(usj('GEN', 'v2'));
    await closed;
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(edits).not.toHaveBeenCalled();
  });

  it('passes a book that failed to read once it reads', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject(() => delivery);
    project.booksPresent = '1';
    const listener = listenForBooks();
    readStatus();
    await settle();

    delivery = usj('GEN', 'v2');
    subscriptionsTo(project, 'GEN').at(-1)?.deliver(delivery);
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1].textVersion).toBe('v2@en');
  });

  it('passes nothing once the project closes', async () => {
    const project = serveProject();
    project.booksPresent = '1';
    const listener = listenForBooks();
    readStatus();
    await settle();

    const closed = closeProject('src');
    project.subscriptions[0].deliver(usj('GEN'));
    await closed;
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not call a listener once it is removed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = jest.fn();
    onBookRead(listener)();

    readStatus();
    await settle();

    expect(project.subscriptions).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onTextRead', () => {
  const unsubscribers: Array<() => boolean> = [];

  /** A listener for the books holding text, registered for the test and removed once it ends. */
  function listenForText() {
    const listener = jest.fn();
    unsubscribers.push(onTextRead(listener));
    return listener;
  }

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('reports the books holding text once every book is read', async () => {
    const project = serveProject((bookId) => (bookId === 'EXO' ? undefined : usj(bookId)));
    project.booksPresent = '111';
    const listener = listenForText();

    readStatus();
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBe('src');
    expect([...listener.mock.calls[0][1]].sort()).toEqual(['GEN', 'LEV']);
  });

  it('reports nothing while some books are still being read', async () => {
    const project = serveProject();
    project.booksPresent = '11';
    const listener = listenForText();
    readStatus();
    await settle();

    project.subscriptions[0].deliver(usj('GEN'));
    await settle();

    expect(listener).not.toHaveBeenCalled();
    await finishReading(project);
  });

  it('reports nothing while a book has failed to read, then reports once it reads', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject((bookId) => (bookId === 'GEN' ? delivery : usj(bookId)));
    project.booksPresent = '11';
    const listener = listenForText();
    readStatus();
    await settle();

    expect(listener).not.toHaveBeenCalled();

    delivery = usj('GEN');
    subscriptionsTo(project, 'GEN').at(-1)?.deliver(delivery);
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports again when an edit takes away the text of a book', async () => {
    let delivery: Delivery = usj('GEN');
    const project = serveProject((bookId) => (bookId === 'GEN' ? delivery : usj(bookId)));
    project.booksPresent = '11';
    const listener = listenForText();
    readStatus();
    await settle();

    delivery = undefined;
    subscriptionsTo(project, 'GEN').at(-1)?.deliver(delivery);
    await settle();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][1]).toEqual(['EXO']);
  });

  it('reports nothing again for an edit that leaves the same books holding text', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = listenForText();
    readStatus();
    await settle();

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not call a listener once it is removed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = jest.fn();
    onTextRead(listener)();

    readStatus();
    await settle();

    expect(project.subscriptions).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('startTextRead and stopTextRead', () => {
  const unsubscribers: Array<() => boolean> = [];

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  });

  it('starts reading the whole text without waiting for it', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '11';
    const listener = jest.fn();
    unsubscribers.push(onBookRead(listener));

    await startTextRead('src');
    await settle();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(await readStatus()).toEqual({ booksRead: 2, bookCount: 2, failedBookIds: [] });
  });

  it('reads the text again when a read is already done, passing every book again', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = jest.fn();
    unsubscribers.push(onBookRead(listener));
    readStatus();
    await settle();

    await startTextRead('src');
    await settle();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops watching the books of the read it replaces', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();
    const [replaced] = project.subscriptions;

    await startTextRead('src');

    expect(replaced.unsubscribe).toHaveBeenCalled();
  });

  it('leaves listing failures for the status to report', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = new Error('offline');

    await expect(startTextRead('src')).resolves.toBeUndefined();
    await settle();

    await expect(readStatus()).rejects.toThrow('offline');
  });

  it('ends the read, stopping its watches and its answers', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();

    await stopTextRead('src');

    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
    expect(isFormInText('src', 'shared')).toBeUndefined();
  });

  it('keeps the outlined book while ending the read', async () => {
    segmentStandIns();
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    await getBookOutline('src', 'EXO');
    readStatus();
    await settle();

    await stopTextRead('src');

    expect(subscriptionsTo(project, 'EXO')[0].unsubscribe).not.toHaveBeenCalled();
  });

  it('does nothing for a project whose text is not being read', async () => {
    await expect(stopTextRead('src')).resolves.toBeUndefined();
  });

  it('keeps reading when the project closes, passing each edited book', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    const listener = jest.fn();
    unsubscribers.push(onBookRead(listener));
    await startTextRead('src');
    await settle();

    await closeProject('src');
    subscriptionsTo(project, 'GEN')[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(await readStatus()).toEqual({ booksRead: 1, bookCount: 1, failedBookIds: [] });
  });

  it('lets go of the kept books when the project closes during its read', async () => {
    segmentStandIns();
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    await getBookOutline('src', 'EXO');
    await startTextRead('src');
    await settle();

    await closeProject('src');

    expect(subscriptionsTo(project, 'EXO')[0].unsubscribe).toHaveBeenCalled();
    expect(subscriptionsTo(project, 'GEN')[0].unsubscribe).not.toHaveBeenCalled();
  });

  it('ends a stopped read when the project closes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    await startTextRead('src');
    await stopTextRead('src');
    readStatus();
    await settle();

    await closeProject('src');

    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('ends the read once all projects close', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    await startTextRead('src');
    await settle();

    await closeAllProjects();

    expect(project.subscriptions[0].unsubscribe).toHaveBeenCalled();
    expect(isFormInText('src', 'shared')).toBeUndefined();
  });
});

describe('getTextReadStatus', () => {
  it('answers once the books are known, before any is read', async () => {
    const project = serveProject();
    project.booksPresent = '11';

    expect(await readStatus()).toEqual({ booksRead: 0, bookCount: 2, failedBookIds: [] });
    await finishReading(project);
  });

  it("reads every book the project's text holds, under its language tag", async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '101';

    readStatus();
    await settle();

    expect(await readStatus()).toEqual({ booksRead: 2, bookCount: 2, failedBookIds: [] });
    expect(project.subscriptions.map((s) => s.bookId)).toEqual(['GEN', 'LEV']);
    expect(extractBookFromUsj).toHaveBeenCalledWith(usj('LEV'), 'en');
  });

  it('reports the books read so far while others are still being read', async () => {
    const project = serveProject();
    project.booksPresent = '111';
    readStatus();
    await settle();

    project.subscriptions[0].deliver(usj('GEN'));
    project.subscriptions[1].deliver(usj('EXO'));
    await settle();

    expect(await readStatus()).toEqual({
      booksRead: 2,
      bookCount: 3,
      failedBookIds: [],
    });
    await finishReading(project);
  });

  it('reads a few books at a time', async () => {
    const project = serveProject();
    project.booksPresent = '111111';
    readStatus();
    await settle();
    const started = project.subscriptions.length;

    project.subscriptions[0].deliver(usj('GEN'));
    await settle();

    expect(started).toBeLessThan(6);
    expect(project.subscriptions).toHaveLength(started + 1);
    await finishReading(project);
  });

  it('reads the text once however often its status is asked for', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';

    readStatus();
    readStatus();
    await settle();
    readStatus();

    expect(project.subscriptions).toHaveLength(1);
  });

  it('reports a book that fails to read, and reads the rest', async () => {
    const project = serveProject((bookId) =>
      bookId === 'EXO' ? platformError('busy') : usj(bookId),
    );
    project.booksPresent = '111';

    readStatus();
    await settle();

    expect(await readStatus()).toEqual({
      booksRead: 3,
      bookCount: 3,
      failedBookIds: ['EXO'],
    });
  });

  it('counts a book the project has no text for as read', async () => {
    const project = serveProject(() => undefined);
    project.booksPresent = '1';

    readStatus();
    await settle();

    expect(await readStatus()).toEqual({ booksRead: 1, bookCount: 1, failedBookIds: [] });
  });

  it('rejects when the books cannot be listed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = new Error('offline');

    await expect(readStatus()).rejects.toThrow('offline');
    expect(project.subscriptions).toHaveLength(0);
  });

  it('rejects when the project has no provider for its text', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    project.usjProviderError = new Error('no provider');

    await expect(readStatus()).rejects.toThrow('no provider');
    expect(project.subscriptions).toHaveLength(0);
  });

  it('gets the provider of the text once for every book', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '111';

    readStatus();
    await settle();

    expect(project.subscriptions).toHaveLength(3);
    expect(
      mockPdpGet.mock.calls.filter(([type]) => type === 'platformScripture.USJ_Book'),
    ).toHaveLength(1);
  });

  it('lists the books again on the request after one that could not', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = new Error('offline');
    await expect(readStatus()).rejects.toThrow('offline');

    project.booksPresent = '1';
    readStatus();
    await settle();

    expect(await readStatus()).toEqual({ booksRead: 1, bookCount: 1, failedBookIds: [] });
  });

  it('clears a failed book once an edit lets it read', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject(() => delivery);
    project.booksPresent = '1';
    readStatus();
    await settle();

    delivery = usj('GEN', 'v2');
    project.subscriptions[0].deliver(delivery);
    await settle();

    expect((await readStatus()).failedBookIds).toEqual([]);
  });

  it('reads a book it could not watch again once the outlined book is edited', async () => {
    segmentStandIns();
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    await getBookOutline('src', 'GEN');
    project.subscribeError = new Error('no provider');
    readStatus();
    await settle();
    project.subscribeError = undefined;

    project.subscriptions[0].deliver(usj('GEN', 'v2'));
    await settle();

    expect((await readStatus()).failedBookIds).toEqual([]);
  });

  it('stops watching the books once the project closes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '11';
    readStatus();
    await settle();

    await closeProject('src');

    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('reads no further books once the project closes', async () => {
    const project = serveProject();
    project.booksPresent = '111111';
    readStatus();
    await settle();
    const started = project.subscriptions.length;

    const closing = closeProject('src');
    project.subscriptions.forEach((s) => s.deliver(usj(s.bookId)));
    await closing;
    await settle();

    expect(project.subscriptions).toHaveLength(started);
  });

  it('reads no book once the project closes while its books are listed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();

    await closeProject('src');
    await settle();

    expect(project.subscriptions).toHaveLength(0);
  });

  it('reads the text again once the project has closed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();
    await closeProject('src');

    readStatus();
    await settle();

    expect(await readStatus()).toEqual({ booksRead: 1, bookCount: 1, failedBookIds: [] });
    expect(project.subscriptions).toHaveLength(2);
  });

  it('stops watching the books of every project once all close', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus('src');
    readStatus('other');
    await settle();

    await closeAllProjects();

    expect(project.subscriptions).toHaveLength(2);
    expect(project.subscriptions.every((s) => s.unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});

describe('isFormInText', () => {
  beforeEach(() => {
    tokenizeToWords();
  });

  it('answers nothing for a project whose text has not been read', () => {
    expect(isFormInText('src', 'shared')).toBeUndefined();
  });

  it('answers nothing until every book has been read', async () => {
    const project = serveProject();
    project.booksPresent = '11';
    readStatus();
    await settle();

    project.subscriptions[0].deliver(usj('GEN'));
    await settle();

    expect(isFormInText('src', 'shared')).toBeUndefined();
    await finishReading(project);
  });

  it('finds the forms any book of the text holds', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '11';
    readStatus();
    await settle();

    expect(['shared', 'gen-v1', 'exo-v1'].map((f) => isFormInText('src', f))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('misses a form no book of the text holds', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '11';
    readStatus();
    await settle();

    expect(isFormInText('src', 'lev-v1')).toBe(false);
  });

  it('matches a form however it is cased', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();

    expect(isFormInText('src', 'Shared')).toBe(true);
  });

  it('answers nothing while a book has failed to read', async () => {
    const project = serveProject((bookId) =>
      bookId === 'EXO' ? platformError('busy') : usj(bookId),
    );
    project.booksPresent = '11';
    readStatus();
    await settle();

    expect(isFormInText('src', 'gen-v1')).toBeUndefined();
  });

  it('answers from the edited text when a read it replaced delivers older text last', async () => {
    segmentStandIns();
    tokenizeToWords();
    const project = serveProject();
    project.booksPresent = '1';
    const outline = getBookOutline('src', 'GEN');
    await settle();
    const [open] = project.subscriptions;
    open.deliver(usj('GEN'));
    await outline;
    readStatus();
    await settle();
    const [, replaced] = subscriptionsTo(project, 'GEN');
    open.deliver(usj('GEN', 'v2'));
    await settle();

    subscriptionsTo(project, 'GEN').at(-1)?.deliver(usj('GEN', 'v2'));
    await settle();
    replaced.deliver(usj('GEN'));
    await finishReading(project);

    expect(isFormInText('src', 'gen-v1')).toBe(false);
    expect(isFormInText('src', 'gen-v2')).toBe(true);
  });

  it('answers nothing once a project closes', async () => {
    const project = serveProject((bookId) => usj(bookId));
    project.booksPresent = '1';
    readStatus();
    await settle();

    await closeProject('src');

    expect(isFormInText('src', 'shared')).toBeUndefined();
  });
});
