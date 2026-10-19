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
  getSegments,
  getTokenizedBook,
  getWritingSystem,
  onOpenBookTextChanged,
} from '../../services/bookService';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
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
 * at once unless `text` is omitted, which leaves delivering to the test.
 */
function serveProject(text?: (bookId: string) => Delivery) {
  const project: { languageTag: unknown; subscriptions: Subscription[] } = {
    languageTag: 'en',
    subscriptions: [],
  };
  const subscribeBookUSJ = jest.fn(
    async ({ book }: { book: string }, callback: (usj: Delivery) => void) => {
      const unsubscribe = jest.fn(async () => true);
      project.subscriptions.push({ bookId: book, deliver: callback, unsubscribe });
      if (text) queueMicrotask(() => callback(text(book)));
      return unsubscribe;
    },
  );
  mockPdpGet.mockImplementation(async (type: string) =>
    type === 'platform.base'
      ? { getSetting: async () => project.languageTag }
      : { subscribeBookUSJ },
  );
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

describe('onOpenBookTextChanged', () => {
  const unsubscribers: Array<() => boolean> = [];

  /** A listener registered for the test, removed once it ends. */
  function listen(onCall?: () => void) {
    const listener = jest.fn(onCall);
    unsubscribers.push(onOpenBookTextChanged(listener));
    return listener;
  }

  /** The subscriptions made to `bookId`, oldest first. */
  function subscriptionsTo(project: ReturnType<typeof serveProject>, bookId: string) {
    return project.subscriptions.filter((s) => s.bookId === bookId);
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

    expect(tokenizeBook).not.toHaveBeenCalled();
    expect(subscriptionsTo(project, 'GEN')).toHaveLength(1);
    expect(subscriptionsTo(project, 'GEN')[0].unsubscribe).not.toHaveBeenCalled();
  });

  it('serves pages of the outlined book after another book was read whole', async () => {
    const project = serveProject((bookId) => usj(bookId));
    await getBookOutline('src', 'GEN');
    await getTokenizedBook('src', 'EXO');
    jest.mocked(tokenizeBook).mockClear();

    const page = parsePage(await getSegments('src', 'GEN', 0, 2));

    expect(page.segments.map((seg) => seg.id)).toEqual(['GEN 1:1', 'GEN 1:3']);
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

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('src', 'GEN');
  });

  it('reports an edit to every listener', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listeners = [listen(), listen()];
    await getBookOutline('src', 'GEN');

    project.subscriptions[0].deliver(usj('GEN', 'v2'));

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

  it('stops watching an outlined book that fails to read, and watches it again on the next outline', async () => {
    let delivery: Delivery = platformError('busy');
    const project = serveProject(() => delivery);
    const listener = listen();
    await expect(getBookOutline('src', 'GEN')).rejects.toThrow('busy');
    await settle();
    delivery = usj('GEN');

    await getBookOutline('src', 'GEN');
    const [failed, watch] = subscriptionsTo(project, 'GEN');
    watch.deliver(usj('GEN', 'v2'));

    expect(failed.unsubscribe).toHaveBeenCalled();
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

    expect(listener).toHaveBeenCalledTimes(1);
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

  it('does not call a listener once it is removed', async () => {
    const project = serveProject((bookId) => usj(bookId));
    const listener = jest.fn();
    const unsubscribe = onOpenBookTextChanged(listener);
    await getBookOutline('src', 'GEN');

    unsubscribe();
    project.subscriptions[0].deliver(usj('GEN', 'v2'));

    expect(listener).not.toHaveBeenCalled();
  });
});
