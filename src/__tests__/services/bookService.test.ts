/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import {
  closeAllProjects,
  closeProject,
  getTokenizedBook,
  getWritingSystem,
} from '../../services/bookService';

// Tokenizing is the parsers' concern; these stand-ins name the book, text and tag they came from.
jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

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
