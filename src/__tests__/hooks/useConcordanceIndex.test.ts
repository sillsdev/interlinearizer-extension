/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';
import useConcordanceIndex, { type UseConcordanceIndexArgs } from '../../hooks/useConcordanceIndex';
import { buildConcordanceEntries, indexBook } from '../../utils/concordance';
import { getMockedPdpGet } from '../test-helpers';

// The index's own contents are the concordance core's concern; these stand-ins name each entry by
// the book and text version it was built from, so a test can read off which reading went in.
jest.mock('../../utils/concordance');
jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

const mockPdpGet = getMockedPdpGet(papi);

/** A stand-in USJ document naming the book and text version it holds. */
function usj(bookId: string, version: string): UsjDocument {
  return { content: [bookId, version] };
}

/** A stand-in tokenized book, which the stand-in index reads only the code and version of. */
function book(bookRef: string, textVersion: string): Book {
  return { id: bookRef, bookRef, textVersion, segments: [], duplicateVerseIds: [] };
}

/** Wires the providers to serve `booksPresent` and each book's text from `readBook`. */
function serveProject(
  booksPresent: string,
  readBook: (bookId: string) => Promise<UsjDocument | undefined>,
) {
  const getBookUSJ = jest.fn(({ book: bookId }: { book: string }) => readBook(bookId));
  mockPdpGet.mockImplementation(async (type: string) =>
    type === 'platform.base' ? { getSetting: async () => booksPresent } : { getBookUSJ },
  );
  return getBookUSJ;
}

/** A promise with its resolver exposed, for holding a read open mid-test. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

const baseArgs: UseConcordanceIndexArgs = {
  projectId: 'src',
  writingSystem: 'en',
  liveBook: undefined,
  enabled: true,
  shown: true,
};

beforeEach(() => {
  jest.mocked(extractBookFromUsj).mockImplementation((doc) => ({
    bookCode: String(doc.content[0]),
    contentHash: String(doc.content[1]),
    writingSystem: 'en',
    duplicateVerseIds: [],
    segments: [],
    frontMatter: [],
  }));
  jest.mocked(tokenizeBook).mockImplementation((raw) => book(raw.bookCode, raw.contentHash));
  jest.mocked(indexBook).mockImplementation((b) => ({
    book: b.bookRef,
    textVersion: b.textVersion,
    occurrencesByForm: new Map(),
    spellingCountsByForm: new Map(),
  }));
  jest.mocked(buildConcordanceEntries).mockImplementation((books) =>
    [...books].map((b) => ({
      form: `${b.book}@${b.textVersion}`,
      displayText: b.book,
      occurrences: [],
      countByBook: new Map(),
    })),
  );
});

/** The book and version each entry was built from. */
function builtFrom(entries: readonly { form: string }[]): string[] {
  return entries.map((e) => e.form).sort();
}

describe('useConcordanceIndex', () => {
  it('reads nothing until the index is wanted', () => {
    serveProject('1', async () => usj('GEN', 'v1'));

    const { result } = renderHook(() => useConcordanceIndex({ ...baseArgs, enabled: false }));

    expect(result.current.status).toBe('idle');
    expect(mockPdpGet).not.toHaveBeenCalled();
  });

  it('reads every book the project marks present', async () => {
    const getBookUSJ = serveProject('1010', async (id) => usj(id, 'v1'));

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.entries)).toEqual(['GEN@v1', 'LEV@v1']);
    expect(getBookUSJ.mock.calls.map(([ref]) => ref.book)).toEqual(['GEN', 'LEV']);
  });

  it('ignores present-book flags past the end of the canon', async () => {
    const getBookUSJ = serveProject(`${'0'.repeat(199)}1`, async (id) => usj(id, 'v1'));

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getBookUSJ).not.toHaveBeenCalled();
  });

  it('reports progress and withholds the entries until every book is read', async () => {
    const exodus = deferred<UsjDocument>();
    serveProject('11', (id) => (id === 'EXO' ? exodus.promise : Promise.resolve(usj(id, 'v1'))));

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.booksRead).toBe(1));
    expect(result.current).toMatchObject({ status: 'loading', bookCount: 2, entries: [] });

    await act(async () => exodus.resolve(usj('EXO', 'v1')));

    expect(result.current).toMatchObject({ status: 'ready', booksRead: 2, bookCount: 2 });
  });

  it('skips a book the project serves no text for', async () => {
    serveProject('11', async (id) => (id === 'GEN' ? undefined : usj(id, 'v1')));

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.entries)).toEqual(['EXO@v1']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips a book whose text fails to read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return usj(id, 'v1');
    });

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.entries)).toEqual(['EXO@v1']);
  });

  it('reports an error when no book could be read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return undefined;
    });

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.entries).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports an empty index when no book has text and none failed', async () => {
    serveProject('11', async () => undefined);

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.entries).toEqual([]);
  });

  it('reports an error when the list of books cannot be read', async () => {
    mockPdpGet.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useConcordanceIndex(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(logger.error).toHaveBeenCalled();
  });

  it('takes the live book in place of its reading', async () => {
    serveProject('11', async (id) => usj(id, 'v1'));

    const { result } = renderHook(() =>
      useConcordanceIndex({ ...baseArgs, liveBook: book('GEN', 'v2') }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.entries)).toEqual(['EXO@v1', 'GEN@v2']);
  });

  it('keeps the last live version of a book the editor moves off', async () => {
    serveProject('11', async (id) => usj(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: { ...baseArgs, liveBook: book('GEN', 'v2') } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ ...baseArgs, liveBook: book('EXO', 'v2') });

    expect(builtFrom(result.current.entries)).toEqual(['EXO@v2', 'GEN@v2']);
  });

  it('holds back live-book edits while the concordance is hidden', async () => {
    serveProject('1', async (id) => usj(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: { ...baseArgs, shown: false } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const builds = jest.mocked(buildConcordanceEntries).mock.calls.length;

    rerender({ ...baseArgs, shown: false, liveBook: book('GEN', 'v2') });

    expect(jest.mocked(buildConcordanceEntries).mock.calls.length).toBe(builds);
    expect(builtFrom(result.current.entries)).toEqual(['GEN@v1']);
  });

  it('takes in edits held back while hidden once the concordance is shown', async () => {
    serveProject('1', async (id) => usj(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: { ...baseArgs, shown: false } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...baseArgs, shown: false, liveBook: book('GEN', 'v2') });

    rerender({ ...baseArgs, liveBook: book('GEN', 'v2') });

    expect(builtFrom(result.current.entries)).toEqual(['GEN@v2']);
  });

  it('does not rebuild for a live book whose text matches its reading', async () => {
    serveProject('1', async (id) => usj(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: baseArgs },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const builds = jest.mocked(buildConcordanceEntries).mock.calls.length;

    rerender({ ...baseArgs, liveBook: book('GEN', 'v1') });

    expect(jest.mocked(buildConcordanceEntries).mock.calls.length).toBe(builds);
  });

  it('reads every book again on refresh, keeping the live one', async () => {
    let version = 'v1';
    serveProject('111', async (id) => usj(id, version));
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: { ...baseArgs, liveBook: book('GEN', 'v2') } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...baseArgs, liveBook: book('EXO', 'v2') });

    version = 'v3';
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.entries)).toEqual(['EXO@v2', 'GEN@v3', 'LEV@v3']);
  });

  it('abandons a read in progress when refreshed', async () => {
    const firstGenesis = deferred<UsjDocument>();
    let genesisReads = 0;
    serveProject('11', (id) => {
      if (id !== 'GEN') return Promise.resolve(usj(id, 'v1'));
      genesisReads += 1;
      return genesisReads === 1 ? firstGenesis.promise : Promise.resolve(usj(id, 'v2'));
    });
    const { result } = renderHook(() => useConcordanceIndex(baseArgs));
    await waitFor(() => expect(genesisReads).toBe(1));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => firstGenesis.resolve(usj('GEN', 'stale')));

    expect(result.current.status).toBe('ready');
    expect(builtFrom(result.current.entries)).toEqual(['EXO@v1', 'GEN@v2']);
  });

  it('forgets live versions of other books on refresh when no book is live', async () => {
    let version = 'v1';
    serveProject('1', async (id) => usj(id, version));
    const genesisLive: UseConcordanceIndexArgs = { ...baseArgs, liveBook: book('GEN', 'v2') };
    const { result, rerender } = renderHook(
      (args: UseConcordanceIndexArgs) => useConcordanceIndex(args),
      { initialProps: genesisLive },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender(baseArgs);

    version = 'v3';
    act(() => result.current.refresh());

    await waitFor(() => expect(builtFrom(result.current.entries)).toEqual(['GEN@v3']));
  });

  it('abandons listing the books when unmounted', async () => {
    const booksPresent = deferred<string>();
    const getBookUSJ = jest.fn();
    mockPdpGet.mockResolvedValue({ getSetting: () => booksPresent.promise, getBookUSJ });
    const { unmount } = renderHook(() => useConcordanceIndex(baseArgs));
    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());

    unmount();
    await act(async () => booksPresent.resolve('1'));

    expect(getBookUSJ).not.toHaveBeenCalled();
  });

  it('logs nothing when a listing fails after it was abandoned', async () => {
    let fail: (e: Error) => void = () => {};
    mockPdpGet.mockResolvedValue({
      getSetting: () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    });
    const { unmount } = renderHook(() => useConcordanceIndex(baseArgs));
    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());

    unmount();
    await act(async () => fail(new Error('gone')));

    expect(logger.error).not.toHaveBeenCalled();
  });
});
