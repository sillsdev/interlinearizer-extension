/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import useSourceTextReader, {
  type SourceText,
  type UseSourceTextReaderArgs,
} from '../../hooks/useSourceTextReader';
import { indexBook } from '../../utils/concordance';
import { getMockedPdpGet, getMockedSendCommand } from '../test-helpers';

// A book's index is the concordance core's concern; this stand-in names the one form it holds by
// the book and text version it was built from, so a test can read off which reading went in.
jest.mock('../../utils/concordance');

const mockPdpGet = getMockedPdpGet(papi);
const mockSendCommand = getMockedSendCommand(papi);

/** A stand-in tokenized book, which the stand-in index reads only the code and version of. */
function book(bookRef: string, textVersion: string): Book {
  return { id: bookRef, bookRef, textVersion, segments: [], duplicateVerseIds: [] };
}

/** Wires the host to serve `booksPresent` and each tokenized book from `readBook`. */
function serveProject(
  booksPresent: string,
  readBook: (bookId: string) => Promise<Book | undefined>,
) {
  mockPdpGet.mockResolvedValue({ getSetting: async () => booksPresent });
  mockSendCommand.mockImplementation(
    async (_command: string, _projectId: string, bookId: string) => {
      const read = await readBook(bookId);
      return read && JSON.stringify(read);
    },
  );
  return mockSendCommand;
}

/** A promise with its resolver exposed, for holding a read open mid-test. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

const baseArgs: UseSourceTextReaderArgs = {
  projectId: 'src',
  liveBook: undefined,
  enabled: true,
};

beforeEach(() => {
  jest.mocked(indexBook).mockImplementation((b) => ({
    book: b.bookRef,
    textVersion: b.textVersion,
    occurrencesByForm: new Map([[`${b.bookRef}@${b.textVersion}`, []]]),
    spellingCountsByForm: new Map(),
  }));
});

/** The book and version each of the indexes was built from. */
function builtFrom(indexes: SourceText['readings']): string[] {
  return [...(indexes?.values() ?? [])].map((i) => `${i.book}@${i.textVersion}`).sort();
}

/** The forms the text holds, in a stable order. */
function formsOf(text: SourceText): string[] | undefined {
  return text.textForms && [...text.textForms].sort();
}

describe('useSourceTextReader', () => {
  it('reads nothing until the text is wanted', () => {
    serveProject('1', async () => book('GEN', 'v1'));

    const { result } = renderHook(() => useSourceTextReader({ ...baseArgs, enabled: false }));

    expect(result.current.status).toBe('idle');
    expect(mockPdpGet).not.toHaveBeenCalled();
  });

  it('reads the books once they are requested', async () => {
    serveProject('1', async (id) => book(id, 'v1'));
    const { result } = renderHook(() => useSourceTextReader({ ...baseArgs, enabled: false }));

    act(() => result.current.request());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(formsOf(result.current)).toEqual(['GEN@v1']);
  });

  it('reads every book the project marks present', async () => {
    const readTokenizedBook = serveProject('1010', async (id) => book(id, 'v1'));

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.readings)).toEqual(['GEN@v1', 'LEV@v1']);
    expect(readTokenizedBook.mock.calls.map(([, , bookId]) => bookId)).toEqual(['GEN', 'LEV']);
  });

  it('ignores present-book flags past the end of the canon', async () => {
    const readTokenizedBook = serveProject(`${'0'.repeat(199)}1`, async (id) => book(id, 'v1'));

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(readTokenizedBook).not.toHaveBeenCalled();
  });

  it('reports progress and withholds the readings until every book is read', async () => {
    const exodus = deferred<Book>();
    serveProject('11', (id) => (id === 'EXO' ? exodus.promise : Promise.resolve(book(id, 'v1'))));

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.booksRead).toBe(1));
    expect(result.current).toMatchObject({ status: 'loading', bookCount: 2, readings: undefined });

    await act(async () => exodus.resolve(book('EXO', 'v1')));

    expect(result.current).toMatchObject({ status: 'ready', booksRead: 2, bookCount: 2 });
  });

  it('skips a book the project serves no text for', async () => {
    serveProject('11', async (id) => (id === 'GEN' ? undefined : book(id, 'v1')));

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.readings)).toEqual(['EXO@v1']);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips a book whose text fails to read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return book(id, 'v1');
    });

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.readings)).toEqual(['EXO@v1']);
  });

  it('hands on each book it reads', async () => {
    serveProject('11', async (id) => book(id, 'v1'));
    const onBookRead = jest.fn();

    renderHook(() => useSourceTextReader({ ...baseArgs, onBookRead }));

    await waitFor(() =>
      expect(onBookRead.mock.calls.map(([read]) => read)).toEqual([
        book('GEN', 'v1'),
        book('EXO', 'v1'),
      ]),
    );
  });

  it('reports the books it read text for once every book is in', async () => {
    serveProject('111', async (id) => (id === 'EXO' ? undefined : book(id, 'v1')));
    const onTextRead = jest.fn();

    renderHook(() => useSourceTextReader({ ...baseArgs, onTextRead }));

    await waitFor(() => expect(onTextRead).toHaveBeenCalledWith(['GEN', 'LEV']));
  });

  it('reports no reading of the text while a book of it failed to read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return book(id, 'v1');
    });
    const onTextRead = jest.fn();

    const { result } = renderHook(() => useSourceTextReader({ ...baseArgs, onTextRead }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(onTextRead).not.toHaveBeenCalled();
  });

  it('withholds the text forms while a book of it failed to read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return book(id, 'v1');
    });

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.isPartial).toBe(true);
    expect(result.current.textForms).toBeUndefined();
  });

  it('drops a partial reading while the text is read again', async () => {
    const secondGenesis = deferred<Book>();
    let genesisReads = 0;
    serveProject('11', (id) => {
      if (id !== 'GEN') return Promise.resolve(book(id, 'v1'));
      genesisReads += 1;
      return genesisReads === 1 ? Promise.reject(new Error('unreadable')) : secondGenesis.promise;
    });
    const { result } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(result.current.isPartial).toBe(true));

    act(() => result.current.refresh());

    expect(result.current.status).toBe('loading');
    expect(result.current.isPartial).toBe(false);
  });

  it('reports the text forms once a re-read takes in the book that failed', async () => {
    let genesisReads = 0;
    serveProject('11', async (id) => {
      if (id !== 'GEN') return book(id, 'v1');
      genesisReads += 1;
      if (genesisReads === 1) throw new Error('unreadable');
      return book(id, 'v1');
    });
    const { result } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(result.current.isPartial).toBe(true));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.textForms).toBeDefined());
    expect(formsOf(result.current)).toEqual(['EXO@v1', 'GEN@v1']);
    expect(result.current.isPartial).toBe(false);
  });

  it('reports an error when no book could be read', async () => {
    serveProject('11', async (id) => {
      if (id === 'GEN') throw new Error('unreadable');
      return undefined;
    });

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.readings).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports an empty text when no book has text and none failed', async () => {
    serveProject('11', async () => undefined);

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(formsOf(result.current)).toEqual([]);
  });

  it('reports an error when the list of books cannot be read', async () => {
    mockPdpGet.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useSourceTextReader(baseArgs));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps a live book newer than its reading as a live version', async () => {
    serveProject('11', async (id) => book(id, 'v1'));

    const { result } = renderHook(() =>
      useSourceTextReader({ ...baseArgs, liveBook: book('GEN', 'v2') }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(builtFrom(result.current.liveVersions)).toEqual(['GEN@v2']);
  });

  it('serves the forms of every book, the live one in place of its reading', async () => {
    serveProject('11', async (id) => book(id, 'v1'));

    const { result } = renderHook(() =>
      useSourceTextReader({ ...baseArgs, liveBook: book('GEN', 'v2') }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(formsOf(result.current)).toEqual(['EXO@v1', 'GEN@v2']);
  });

  it('keeps the last live version of a book the editor moves off', async () => {
    serveProject('11', async (id) => book(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: { ...baseArgs, liveBook: book('GEN', 'v2') } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ ...baseArgs, liveBook: book('EXO', 'v2') });

    expect(builtFrom(result.current.liveVersions)).toEqual(['EXO@v2', 'GEN@v2']);
  });

  it('takes live-book edits into the forms', async () => {
    serveProject('1', async (id) => book(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: baseArgs },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ ...baseArgs, liveBook: book('GEN', 'v2') });

    expect(formsOf(result.current)).toEqual(['GEN@v2']);
  });

  it('keeps no live version for a live book whose text matches its reading', async () => {
    serveProject('1', async (id) => book(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: baseArgs },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const { liveVersions } = result.current;

    rerender({ ...baseArgs, liveBook: book('GEN', 'v1') });

    expect(result.current.liveVersions).toBe(liveVersions);
  });

  it('reads every book again on refresh', async () => {
    let version = 'v1';
    serveProject('111', async (id) => book(id, version));
    const { result } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    version = 'v3';
    act(() => result.current.refresh());

    await waitFor(() =>
      expect(builtFrom(result.current.readings)).toEqual(['EXO@v3', 'GEN@v3', 'LEV@v3']),
    );
  });

  it("keeps only the live book's live version on refresh", async () => {
    serveProject('111', async (id) => book(id, 'v1'));
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: { ...baseArgs, liveBook: book('GEN', 'v2') } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...baseArgs, liveBook: book('EXO', 'v2') });

    act(() => result.current.refresh());

    expect(builtFrom(result.current.liveVersions)).toEqual(['EXO@v2']);
  });

  it('forgets live versions of other books on refresh when no book is live', async () => {
    serveProject('1', async (id) => book(id, 'v1'));
    const genesisLive: UseSourceTextReaderArgs = { ...baseArgs, liveBook: book('GEN', 'v2') };
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: genesisLive },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender(baseArgs);

    act(() => result.current.refresh());

    expect(builtFrom(result.current.liveVersions)).toEqual([]);
  });

  it('abandons a read in progress when refreshed', async () => {
    const firstGenesis = deferred<Book>();
    let genesisReads = 0;
    serveProject('11', (id) => {
      if (id !== 'GEN') return Promise.resolve(book(id, 'v1'));
      genesisReads += 1;
      return genesisReads === 1 ? firstGenesis.promise : Promise.resolve(book(id, 'v2'));
    });
    const { result } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(genesisReads).toBe(1));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => firstGenesis.resolve(book('GEN', 'stale')));

    expect(result.current.status).toBe('ready');
    expect(builtFrom(result.current.readings)).toEqual(['EXO@v1', 'GEN@v2']);
  });

  it('hands on no book from a read abandoned by a refresh', async () => {
    const firstGenesis = deferred<Book>();
    let genesisReads = 0;
    serveProject('1', () => {
      genesisReads += 1;
      return genesisReads === 1 ? firstGenesis.promise : Promise.resolve(book('GEN', 'v2'));
    });
    const onBookRead = jest.fn();
    const { result } = renderHook(() => useSourceTextReader({ ...baseArgs, onBookRead }));
    await waitFor(() => expect(genesisReads).toBe(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => firstGenesis.resolve(book('GEN', 'stale')));

    expect(onBookRead.mock.calls.map(([read]) => read)).toEqual([book('GEN', 'v2')]);
  });

  it('reads every book again when its read key changes', async () => {
    let version = 'v1';
    serveProject('1', async (id) => book(id, version));
    const { result, rerender } = renderHook(
      (args: UseSourceTextReaderArgs) => useSourceTextReader(args),
      { initialProps: { ...baseArgs, readKey: 1 } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    version = 'v2';

    rerender({ ...baseArgs, readKey: 2 });

    await waitFor(() => expect(formsOf(result.current)).toEqual(['GEN@v2']));
  });

  it('reads nothing when its read key changes before the text is wanted', () => {
    const readTokenizedBook = serveProject('1', async (id) => book(id, 'v1'));
    const { rerender } = renderHook((args: UseSourceTextReaderArgs) => useSourceTextReader(args), {
      initialProps: { ...baseArgs, enabled: false, readKey: 1 },
    });

    rerender({ ...baseArgs, enabled: false, readKey: 2 });

    expect(readTokenizedBook).not.toHaveBeenCalled();
  });

  it('abandons listing the books when unmounted', async () => {
    const booksPresent = deferred<string>();
    mockPdpGet.mockResolvedValue({ getSetting: () => booksPresent.promise });
    const { unmount } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());

    unmount();
    await act(async () => booksPresent.resolve('1'));

    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('logs nothing when a listing fails after it was abandoned', async () => {
    let fail: (e: Error) => void = () => {};
    mockPdpGet.mockResolvedValue({
      getSetting: () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    });
    const { unmount } = renderHook(() => useSourceTextReader(baseArgs));
    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());

    unmount();
    await act(async () => fail(new Error('gone')));

    expect(logger.error).not.toHaveBeenCalled();
  });
});
