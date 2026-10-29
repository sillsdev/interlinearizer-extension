/// <reference types="jest" />

import {
  KEPT_APPLIED,
  PageClient,
  pagesCovering,
  waitMs,
  type PageClientOptions,
  type PageSource,
} from '../../cache/pageClient';
import type { ChangeBuffer } from '../../services/commands/changeBuffer';
import type { CommandReply } from '../../types/command-reply';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
import { makePhraseLink } from '../test-helpers';
import { BOOK, comparable, glossing, ref, sessionOver } from './session-source';

/**
 * A client over a session's pages, one segment to a page and retrying at once unless `options` say
 * otherwise. The client hears each change that the session reports, ahead of the reply to the
 * command that made it.
 */
async function clientOver(source?: Partial<PageSource>, options?: PageClientOptions) {
  const made = await sessionOver();
  const getSegments = jest.fn((start: number, end: number) => made.fetchPage(start, end));
  const getOutline = jest.fn((): Promise<BookOutline | undefined> => made.fetchOutline());
  const client = new PageClient(
    { getOutline, getSegments, ...source },
    { pageSize: 1, retryDelaysMs: [0], wait: async () => {}, ...options },
  );
  made.onChange((change) => client.hear(change));
  await client.open();
  return { ...made, client, getSegments, getOutline };
}

/** A reply to `changeId` that changes nothing. */
const emptyReply = (changeId: string): CommandReply => ({
  changeId,
  changes: { intent: 'x' },
  poolBuckets: {},
  poolAnalyses: [],
  resegmentedBooks: [],
  staleTranslationBooks: [],
});

/** A change naming the first segment of the book. */
const firstSegmentChange = (changeId: string) => ({
  changeId,
  books: [{ bookId: BOOK.bookRef, ranges: [{ start: 0, end: 1 }] }],
  analysisIds: [],
  forms: [],
  queries: [],
});

/** Holds each caller back while closed, letting them all through once opened. */
function gate() {
  let closed = false;
  const waiting: (() => void)[] = [];
  return {
    pass: () =>
      closed
        ? new Promise<void>((resolve) => {
            waiting.push(resolve);
          })
        : Promise.resolve(),
    close: () => {
      closed = true;
    },
    open: () => {
      closed = false;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

const split = async (buffer: ChangeBuffer) => {
  buffer.putScope({
    ...(await buffer.getScope()),
    segmentation: {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: ref('beginning'), surfaceText: 'beginning' }],
    },
  });
};

describe('PageClient', () => {
  it('loads the pages a view asks for, as the session serves them', async () => {
    const { client, fetchPage } = await clientOver();

    client.load(0, 3, 'list');
    await client.settled();

    expect(comparable(client.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('loads a range asked for before the outline, once the outline loads', async () => {
    const made = await sessionOver();
    const client = new PageClient({
      getOutline: async () => made.outline,
      getSegments: (start, end) => made.fetchPage(start, end),
    });

    client.load(0, 1, 'list');
    await client.open();
    await client.settled();

    expect(client.holds(0)).toBe(true);
  });

  it('asks for a held page only once', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 2, 'list');
    await client.settled();

    client.load(0, 3, 'strip');
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(3);
  });

  it('applies a reply, holding what a refetch holds', async () => {
    const { client, fetchPage, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();

    await client.send((changeId) => edit('writeGloss', glossing('earth', 'land'), changeId));
    await client.settled();

    expect(comparable(client.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('fetches its held pages again once a reply asks it to', async () => {
    const { client, getSegments, edit } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    getSegments.mockClear();

    await client.send((changeId) =>
      edit(
        'createPhrase',
        async (buffer) => {
          buffer.create('phraseAnalysisLinks', makePhraseLink('pl', [ref('In'), ref('said')]));
        },
        changeId,
      ),
    );
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
  });

  it("reloads the outline and each view's range once a reply moves boundaries", async () => {
    const { client, getOutline, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();

    await client.send((changeId) => edit('split', split, changeId));
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(client.pageAt(0, 3)).toBeDefined();
  });

  it('reloads no range a view released', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    client.release('list');

    await client.open();
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
    expect(client.holds(0)).toBe(false);
  });

  it('gives up a page that fails every retry, and asks again when told to', async () => {
    const failing = jest.fn(async (): Promise<SegmentPage | undefined> => {
      throw new Error('offline');
    });
    const { client, fetchPage } = await clientOver({ getSegments: failing });
    client.load(0, 1, 'list');
    await client.settled();

    expect(failing).toHaveBeenCalledTimes(2);
    expect([...client.failedPages]).toStrictEqual([0]);
    failing.mockImplementation(() => fetchPage(0, 1));
    client.retryFailed();
    await client.settled();

    expect(client.failedPages.size).toBe(0);
    expect(client.holds(0)).toBe(true);
  });

  it('asks again for the outline when a page comes back cut from other text', async () => {
    let stale = true;
    const { client, getOutline, fetchPage } = await clientOver({
      getSegments: async (start, end) => {
        const page = await fetchPage(start, end);
        if (!stale) return page;
        stale = false;
        return { ...page, textVersion: 'old' };
      },
    });

    client.load(0, 1, 'list');
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(client.holds(0)).toBe(true);
  });

  it('drops a page cut by an outline replaced while it was fetched', async () => {
    let release: () => void = () => {};
    const { client, fetchPage } = await clientOver({
      getSegments: async (start, end) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return fetchPage(start, end);
      },
    });
    client.load(0, 1, 'list');
    client.release('list');

    await client.open();
    release();
    await client.settled();

    expect(client.holds(0)).toBe(false);
  });

  it('loads again a page cut by an outline replaced while it was fetched, for a range still asked for', async () => {
    const pages = gate();
    const { client, fetchPage } = await clientOver({
      getSegments: async (start, end) => {
        await pages.pass();
        return fetchPage(start, end);
      },
    });
    pages.close();
    client.load(0, 1, 'list');

    await client.open();
    pages.open();
    await client.settled();

    expect(client.holds(0)).toBe(true);
  });

  it('serves what a refetch serves when a page lands ahead of the outline a boundary reply asks for', async () => {
    const pages = gate();
    const outlines = gate();
    const { client, fetchPage, fetchOutline, edit, getSegments, getOutline } = await clientOver();
    getSegments.mockImplementation(async (start, end) => {
      await pages.pass();
      return fetchPage(start, end);
    });
    getOutline.mockImplementation(async () => {
      await outlines.pass();
      return fetchOutline();
    });
    client.load(0, 3, 'list');
    await client.settled();
    await client.send(async (changeId) => {
      const reply = await edit('split', split, changeId);
      pages.close();
      client.hear(firstSegmentChange('other'));
      outlines.close();
      return reply;
    });

    pages.open();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(client.holds(0)).toBe(true);
    outlines.open();
    await client.settled();

    expect(comparable(client.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('fetches a page in flight again once it lands, when a change names it meanwhile', async () => {
    const pages = gate();
    const { client, getSegments, fetchPage } = await clientOver();
    getSegments.mockImplementation(async (start, end) => {
      await pages.pass();
      return fetchPage(start, end);
    });
    client.load(0, 1, 'list');
    await client.settled();
    getSegments.mockClear();
    const change = {
      books: [{ bookId: 'GEN', ranges: [{ start: 0, end: 1 }] }],
      analysisIds: [],
      forms: [],
      queries: [],
    };

    pages.close();
    client.hear({ changeId: 'a', ...change });
    client.hear({ changeId: 'b', ...change });
    client.hear({ changeId: 'c', ...change });
    pages.open();
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(2);
  });

  it('skips the change it sent when the session reports it ahead of the reply', async () => {
    const { client, getSegments, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    await client.send((changeId) => edit('writeGloss', glossing('earth', 'land'), changeId));
    await client.settled();

    expect(getSegments).not.toHaveBeenCalled();
  });

  it('skips the change it sent once when the session reports it after the reply', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    const reply = await client.send(async (changeId) => emptyReply(changeId));
    client.hear(firstSegmentChange(reply?.changeId ?? ''));
    client.hear(firstSegmentChange(reply?.changeId ?? ''));
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
  });

  it('hears a change it sent once a reply was missed, beyond the replies it remembers', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    getSegments.mockClear();
    const ids: string[] = [];

    for (let i = 0; i <= KEPT_APPLIED; i += 1)
      // eslint-disable-next-line no-await-in-loop -- each command is sent after the one before
      await client.send(async (changeId) => {
        ids.push(changeId);
        return emptyReply(changeId);
      });
    client.hear(firstSegmentChange(ids[0]));
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
  });

  it('fetches again what a change it sent names when the reply fails after the change was reported', async () => {
    const { client, getSegments, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    await expect(
      client.send(async (changeId) => {
        await edit('writeGloss', glossing('earth', 'land'), changeId);
        throw new Error('lost');
      }),
    ).rejects.toThrow('lost');
    await client.settled();

    expect(getSegments).toHaveBeenCalledWith(1, 2);
  });

  it('applies nothing when a command answers with no reply', async () => {
    const { client } = await clientOver();
    const version = client.loadedVersion();

    await expect(client.send(async () => undefined)).resolves.toBeUndefined();

    expect(client.loadedVersion()).toBe(version);
  });

  it('fetches again the held pages another change names', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({
      changeId: 'other',
      books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
      analysisIds: [],
      forms: [],
      queries: [],
    });
    await client.settled();

    expect(getSegments.mock.calls).toStrictEqual([[1, 2]]);
  });

  it('fetches a page on its first load again when a change names analyses meanwhile', async () => {
    const pages = gate();
    const { client, getSegments, fetchPage } = await clientOver();
    getSegments.mockImplementation(async (start, end) => {
      await pages.pass();
      return fetchPage(start, end);
    });
    pages.close();
    client.load(0, 1, 'list');

    client.hear({ changeId: 'a', books: [], analysisIds: ['ta-god'], forms: [], queries: [] });
    pages.open();
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(2);
    expect(client.holds(0)).toBe(true);
  });

  it('runs one retry chain for a page that a change or a view asks for during backoff', async () => {
    const delays = gate();
    let fail = true;
    const { client, getSegments, fetchPage } = await clientOver(undefined, {
      retryDelaysMs: [0, 0],
      wait: () => delays.pass(),
    });
    getSegments.mockImplementation(async (start, end) => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return fetchPage(start, end);
    });
    delays.close();
    client.load(0, 1, 'list');
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    client.load(0, 1, 'strip');
    client.hear(firstSegmentChange('a'));
    delays.open();
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(2);
    expect(client.holds(0)).toBe(true);
    expect(client.failedPages.size).toBe(0);
  });

  it('fetches again only the held pages that read an analysis a change names', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({ changeId: 'a', books: [], analysisIds: ['ta-god'], forms: [], queries: [] });
    await client.settled();

    expect(getSegments.mock.calls).toStrictEqual([[0, 1]]);
  });

  it('fetches again the held pages that read the pool bucket of a form a change names', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({ changeId: 'a', books: [], analysisIds: ['ta-new'], forms: ['god'], queries: [] });
    await client.settled();

    expect(getSegments.mock.calls).toStrictEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('reloads the outline for a change naming the book whole', async () => {
    const { client, getOutline } = await clientOver();

    client.hear({
      changeId: 'a',
      books: [{ bookId: BOOK.bookRef }],
      analysisIds: [],
      forms: [],
      queries: [],
    });
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
  });

  it('takes fresh counts and fetches its pages again for a change reaching stale translations, serving them meanwhile', async () => {
    const { client, getSegments, getOutline } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({
      changeId: 'a',
      books: [{ bookId: BOOK.bookRef, ranges: [{ start: 1, end: 2 }], staleTranslations: true }],
      analysisIds: ['sa-2'],
      forms: [],
      queries: ['getStaleSummary'],
    });
    expect(client.pageAt(0, 3)).toBeDefined();
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(getSegments).toHaveBeenCalledTimes(3);
  });

  it('fetches only the pages named for a stale change that moves no stale translation', async () => {
    const { client, getSegments, getOutline } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({
      changeId: 'a',
      books: [{ bookId: BOOK.bookRef, ranges: [{ start: 1, end: 2 }] }],
      analysisIds: [],
      forms: [],
      queries: ['getStaleSummary'],
    });
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(1);
    expect(getSegments).toHaveBeenCalledTimes(1);
  });

  it('takes the whole outline when fresh counts come with the book cut otherwise', async () => {
    const { client, getOutline, outline } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getOutline.mockImplementationOnce(async () => ({
      ...outline,
      segments: outline.segments.slice(0, 2),
    }));

    client.hear({
      changeId: 'a',
      books: [{ bookId: BOOK.bookRef, ranges: [{ start: 1, end: 2 }], staleTranslations: true }],
      analysisIds: [],
      forms: [],
      queries: ['getStaleSummary'],
    });
    await client.settled();

    expect(client.outline?.segments).toHaveLength(2);
    expect(client.pageAt(0, 2)).toBeDefined();
  });

  it('tells its listeners when what it holds changes, until they unsubscribe', async () => {
    const { client } = await clientOver();
    const listener = jest.fn();
    const unsubscribe = client.subscribe(listener);
    client.load(0, 1, 'list');
    await client.settled();
    unsubscribe();
    const version = client.loadedVersion();

    client.load(1, 2, 'list');
    await client.settled();

    expect(listener).toHaveBeenCalled();
    expect(client.loadedVersion()).toBeGreaterThan(version);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('refuses to open on a book the source has no text for', async () => {
    await expect(clientOver({ getOutline: async () => undefined })).rejects.toThrow('no text');
  });

  it('refuses to send a command before the outline has loaded', async () => {
    const client = new PageClient({
      getOutline: async () => undefined,
      getSegments: async () => undefined,
    });
    const command = jest.fn(async (changeId: string) => emptyReply(changeId));

    await expect(client.send(command)).rejects.toThrow('before the outline loaded');
    expect(command).not.toHaveBeenCalled();
  });

  it('holds nothing before the outline has loaded', () => {
    const client = new PageClient({
      getOutline: async () => undefined,
      getSegments: async () => undefined,
    });

    expect(client.holds(0)).toBe(false);
    expect(client.pageAt(0, 1)).toBeUndefined();
  });

  it('reads the outline again when a change arrives while the first outline is read', async () => {
    const outlines = gate();
    const made = await sessionOver();
    const getOutline = jest.fn(async () => {
      await outlines.pass();
      return made.fetchOutline();
    });
    const client = new PageClient({ getOutline, getSegments: made.fetchPage });
    outlines.close();
    const opening = client.open();

    client.hear(firstSegmentChange('a'));
    outlines.open();
    await opening;

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(client.outline).toStrictEqual(made.outline);
  });

  it('reads the outline once more, not once per change, for changes arriving during a read', async () => {
    const outlines = gate();
    const { client, getOutline, fetchOutline } = await clientOver();
    getOutline.mockImplementation(async () => {
      await outlines.pass();
      return fetchOutline();
    });
    getOutline.mockClear();
    const whole = { ...firstSegmentChange('a'), books: [{ bookId: BOOK.bookRef }] };
    outlines.close();

    client.hear({ ...whole, changeId: 'a' });
    client.hear({ ...whole, changeId: 'b' });
    client.hear({ ...whole, changeId: 'c' });
    outlines.open();
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
  });

  it('notes a failed outline read and reads it again when told to', async () => {
    const { client, getOutline } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    getOutline.mockRejectedValueOnce(new Error('offline'));

    client.hear({ ...firstSegmentChange('a'), books: [{ bookId: BOOK.bookRef }] });
    await client.settled();
    expect(client.outlineFailed).toBe(true);
    client.retryFailed();
    await client.settled();

    expect(client.outlineFailed).toBe(false);
    expect(getOutline).toHaveBeenCalledTimes(3);
    expect(client.holds(0)).toBe(true);
  });

  it('reads the outline again when a page comes back with no text', async () => {
    let missing = true;
    const { client, getOutline, fetchPage } = await clientOver({
      getSegments: async (start, end) => {
        if (!missing) return fetchPage(start, end);
        missing = false;
        return undefined;
      },
    });

    client.load(0, 1, 'list');
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(client.holds(0)).toBe(true);
  });

  it('takes a page fetched elsewhere, keeping what a later reply wrote', async () => {
    const { client, fetchPage, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    const fetch = client.beginFetch();
    const stale = await fetchPage(0, 3);
    await client.send((changeId) => edit('writeGloss', glossing('earth', 'land'), changeId));

    expect(client.absorb(stale, fetch)).toBe(true);
    await client.settled();

    expect(comparable(client.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('refuses a page fetched under an outline it has since replaced', async () => {
    const { client, fetchPage } = await clientOver();
    const fetch = client.beginFetch();
    const page = await fetchPage(0, 1);
    await client.open();

    expect(client.absorb(page, fetch)).toBe(false);
    expect(client.holds(0)).toBe(false);
  });

  it('keeps the same failed pages until they change', async () => {
    const { client } = await clientOver({
      getSegments: async () => {
        throw new Error('offline');
      },
    });
    const before = client.failedPages;
    client.load(0, 1, 'list');
    await client.settled();

    expect(client.failedPages).not.toBe(before);
    expect(client.failedPages).toBe(client.failedPages);
  });
});

describe('pagesCovering', () => {
  it('names each page that holds part of the range', () => {
    expect(pagesCovering(3, 9, 20, 4)).toStrictEqual([0, 1, 2]);
  });

  it('clips the range to the segments there are', () => {
    expect(pagesCovering(-5, 50, 6, 4)).toStrictEqual([0, 1]);
  });

  it('names no page for an empty range', () => {
    expect(pagesCovering(8, 8, 20, 4)).toStrictEqual([]);
  });
});

describe('waitMs', () => {
  it('resolves once the time has passed', async () => {
    jest.useFakeTimers();
    const resolved = jest.fn();
    const waiting = waitMs(100).then(resolved);
    jest.advanceTimersByTime(99);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await waiting;
    expect(resolved).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
