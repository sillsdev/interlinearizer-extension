/// <reference types="jest" />

import { PageClient, type PageSource } from '../../cache/pageClient';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
import { makePhraseLink } from '../test-helpers';
import { BOOK, comparable, glossing, ref, sessionOver } from './session-source';

/** A client over a session's pages, one segment to a page, retrying at once. */
async function clientOver(source?: Partial<PageSource>) {
  const made = await sessionOver();
  const getSegments = jest.fn((start: number, end: number) => made.fetchPage(start, end));
  const getOutline = jest.fn(async (): Promise<BookOutline | undefined> => made.outline);
  const client = new PageClient(
    { getOutline, getSegments, ...source },
    { pageSize: 1, retryDelaysMs: [0], wait: async () => {} },
  );
  await client.open();
  return { ...made, client, getSegments, getOutline };
}

describe('PageClient', () => {
  it('loads the pages a view asks for, as the session serves them', async () => {
    const { client, fetchPage } = await clientOver();

    client.load(0, 3, 'list');
    await client.settled();

    expect(comparable(client.cache?.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
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

    expect(client.cache?.holds(0)).toBe(true);
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

    client.apply(await edit('writeGloss', glossing('earth', 'land')));
    await client.settled();

    expect(comparable(client.cache?.pageAt(0, 3))).toStrictEqual(comparable(await fetchPage(0, 3)));
  });

  it('fetches its held pages again once a reply asks it to', async () => {
    const { client, getSegments, edit } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    getSegments.mockClear();

    client.apply(
      await edit('createPhrase', async (buffer) => {
        buffer.create('phraseAnalysisLinks', makePhraseLink('pl', [ref('In'), ref('said')]));
      }),
    );
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
  });

  it("reloads the outline and each view's range once a reply moves boundaries", async () => {
    const { client, getOutline, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();

    client.apply(
      await edit('split', async (buffer) => {
        buffer.putScope({
          ...(await buffer.getScope()),
          segmentation: {
            removedVerseStarts: [],
            addedStarts: [{ tokenRef: ref('beginning'), surfaceText: 'beginning' }],
          },
        });
      }),
    );
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
    expect(client.cache?.pageAt(0, 3)).toBeDefined();
  });

  it('reloads no range a view released', async () => {
    const { client, getSegments } = await clientOver();
    client.load(0, 1, 'list');
    await client.settled();
    client.release('list');

    await client.open();
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
    expect(client.cache?.holds(0)).toBe(false);
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
    expect(client.cache?.holds(0)).toBe(true);
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
    expect(client.cache?.holds(0)).toBe(true);
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

    expect(client.cache?.holds(0)).toBe(false);
  });

  it("fetches again the held pages another change names, skipping its own replies' changes", async () => {
    const { client, getSegments, edit } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    const reply = await edit('writeGloss', glossing('earth', 'land'));
    client.apply(reply);
    await client.settled();
    getSegments.mockClear();

    client.hear({
      changeId: reply.changeId,
      books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
      analysisIds: [],
      queries: [],
    });
    client.hear({
      changeId: 'other',
      books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
      analysisIds: [],
      queries: [],
    });
    await client.settled();

    expect(getSegments).toHaveBeenCalledTimes(1);
    expect(getSegments).toHaveBeenCalledWith(1, 2);
  });

  it('fetches every held page again for a change naming analyses, and the outline for one naming the book whole', async () => {
    const { client, getSegments, getOutline } = await clientOver();
    client.load(0, 3, 'list');
    await client.settled();
    getSegments.mockClear();

    client.hear({ changeId: 'a', books: [], analysisIds: ['ta-god'], queries: [] });
    await client.settled();
    expect(getSegments).toHaveBeenCalledTimes(3);
    client.hear({ changeId: 'b', books: [{ bookId: BOOK.bookRef }], analysisIds: [], queries: [] });
    await client.settled();

    expect(getOutline).toHaveBeenCalledTimes(2);
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

  it('refuses a reply before the outline has loaded', async () => {
    const { edit } = await sessionOver();
    const client = new PageClient({
      getOutline: async () => undefined,
      getSegments: async () => undefined,
    });

    expect(() =>
      client.apply({ changeId: 'x', changes: { intent: 'x' }, poolBuckets: {}, poolAnalyses: [] }),
    ).toThrow('before the outline loaded');
    expect(edit).toBeDefined();
  });
});
