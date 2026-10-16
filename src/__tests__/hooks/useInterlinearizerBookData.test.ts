/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { useProjectSetting } from '@papi/frontend/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book } from 'interlinearizer';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import { getMockedSendCommand, makeSegment, makeWordToken } from '../test-helpers';

/** Mock PlatformError shape */
type PlatformError = { message: string; platformErrorVersion: number };

const mockSendCommand = getMockedSendCommand(papi);

const TEST_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  duplicateVerseIds: [],
  segments: [
    makeSegment('GEN 1:1', 'In the beginning.', [makeWordToken('GEN 1:1:0', 'In')]),
    makeSegment('GEN 1:2', 'And the earth.', [makeWordToken('GEN 1:2:0', 'And')]),
  ],
};

const EXO_BOOK: Book = { ...TEST_BOOK, id: 'EXO', bookRef: 'EXO' };

const GEN_1_1: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
const EXO_1_1: SerializedVerseRef = { book: 'EXO', chapterNum: 1, verseNum: 1 };

function mockLanguageTag(tag: string | PlatformError, isLoading = false) {
  jest.mocked(useProjectSetting).mockReturnValue([tag, jest.fn(), jest.fn(), isLoading]);
}

/** Serves each book the host is asked for from `books`, `undefined` for any other. */
function serveBooks(...books: Book[]) {
  mockSendCommand.mockImplementation(
    async (_command: string, _projectId: string, bookId: string) => {
      const book = books.find((b) => b.bookRef === bookId);
      return book && JSON.stringify(book);
    },
  );
}

/** A promise with its resolver exposed, for holding a fetch open mid-test. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  let fail: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

function renderBookData(scrRef: SerializedVerseRef = GEN_1_1) {
  return renderHook(
    (props: { scrRef: SerializedVerseRef }) =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: props.scrRef }),
    { initialProps: { scrRef } },
  );
}

describe('useInterlinearizerBookData', () => {
  beforeEach(() => {
    mockLanguageTag('en');
    serveBooks(TEST_BOOK, EXO_BOOK);
  });

  it('fetches the tokenized book from the host', async () => {
    const { result } = renderBookData();

    await waitFor(() => expect(result.current.book).toEqual(TEST_BOOK));
    expect(result.current.isLoading).toBe(false);
    expect(mockSendCommand).toHaveBeenCalledWith(
      'interlinearizer.getTokenizedBook',
      'test-project',
      'GEN',
    );
  });

  it('is loading while the book is fetched', () => {
    mockSendCommand.mockReturnValue(new Promise(() => {}));

    const { result } = renderBookData();

    expect(result.current).toMatchObject({
      book: undefined,
      isLoading: true,
      bookError: undefined,
    });
  });

  it('fetches nothing until the language tag has loaded', () => {
    mockLanguageTag('', true);

    const { result } = renderBookData();

    expect(result.current.isLoading).toBe(true);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it('fetches the book again when the language tag changes', async () => {
    const { result, rerender } = renderBookData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockLanguageTag('fr');
    rerender({ scrRef: GEN_1_1 });

    await waitFor(() => expect(mockSendCommand).toHaveBeenCalledTimes(2));
  });

  it('fetches nothing more when the reference moves within the book', async () => {
    const { result, rerender } = renderBookData();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ scrRef: { book: 'GEN', chapterNum: 2, verseNum: 1 } });

    expect(mockSendCommand).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous book while the next one loads', async () => {
    const { result, rerender } = renderBookData();
    await waitFor(() => expect(result.current.book).toEqual(TEST_BOOK));
    mockSendCommand.mockReturnValue(new Promise(() => {}));

    rerender({ scrRef: EXO_1_1 });

    expect(result.current).toMatchObject({ book: TEST_BOOK, isLoading: true });
  });

  it('drops a book that arrives after the reference moved on', async () => {
    const genesis = deferred<string>();
    mockSendCommand.mockReturnValueOnce(genesis.promise);
    const { result, rerender } = renderBookData();
    rerender({ scrRef: EXO_1_1 });
    await waitFor(() => expect(result.current.book).toEqual(EXO_BOOK));

    await act(async () => genesis.resolve(JSON.stringify(TEST_BOOK)));

    expect(result.current.book).toEqual(EXO_BOOK);
  });

  it('drops a failure that arrives after the reference moved on', async () => {
    const genesis = deferred<string>();
    mockSendCommand.mockReturnValueOnce(genesis.promise);
    const { result, rerender } = renderBookData();
    rerender({ scrRef: EXO_1_1 });
    await waitFor(() => expect(result.current.book).toEqual(EXO_BOOK));

    await act(async () => genesis.reject(new Error('too late')));

    expect(result.current.book).toEqual(EXO_BOOK);
  });

  it('reports an error when the project has no text for the book', async () => {
    serveBooks();

    const { result } = renderBookData();

    await waitFor(() =>
      expect(result.current.bookError).toBe('No text available for GEN in project test-project'),
    );
    expect(result.current.book).toBeUndefined();
  });

  it('reports why the book could not be fetched', async () => {
    mockSendCommand.mockRejectedValue(new Error('Project not found'));

    const { result } = renderBookData();

    await waitFor(() => expect(result.current.bookError).toBe('Project not found'));
  });

  it('reports a failure that is not an Error as text', async () => {
    mockSendCommand.mockRejectedValue('no connection');

    const { result } = renderBookData();

    await waitFor(() => expect(result.current.bookError).toBe('no connection'));
  });

  it("reports no earlier book's error while the next book loads", async () => {
    mockSendCommand.mockRejectedValueOnce(new Error('Project not found'));
    const { result, rerender } = renderBookData();
    await waitFor(() => expect(result.current.bookError).toBe('Project not found'));
    mockSendCommand.mockReturnValue(new Promise(() => {}));

    rerender({ scrRef: EXO_1_1 });

    expect(result.current).toMatchObject({ bookError: undefined, isLoading: true });
  });

  describe('writing system', () => {
    // The tag is reported at once, so the fetch is left pending rather than landing after the test.
    beforeEach(() => mockSendCommand.mockReturnValue(new Promise(() => {})));

    it("reports the project's language tag as the writing system", () => {
      mockLanguageTag('el');

      const { result } = renderBookData();

      expect(result.current.writingSystem).toBe('el');
    });

    it('falls back to "und" when the language tag cannot be read', () => {
      mockLanguageTag({ message: 'Setting unavailable', platformErrorVersion: 1 });

      const { result } = renderBookData();

      expect(result.current.writingSystem).toBe('und');
    });

    it('falls back to "und" for an empty language tag', () => {
      mockLanguageTag('');

      const { result } = renderBookData();

      expect(result.current.writingSystem).toBe('und');
    });
  });

  describe('duplicate verse markers', () => {
    /** A tokenized book carrying the SIDs the extractor skipped as duplicates. */
    const BOOK_WITH_DUPLICATES: Book = { ...TEST_BOOK, duplicateVerseIds: ['GEN 1:1'] };

    beforeEach(() => {
      jest.mocked(logger.warn).mockImplementation(() => {});
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    });

    it('sends a warning notification naming no specific verse', async () => {
      serveBooks(BOOK_WITH_DUPLICATES);

      renderBookData();

      await waitFor(() =>
        expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
          message: '%interlinearizer_warning_duplicateVerses%',
          severity: 'warning',
        }),
      );
    });

    it('logs the skipped SIDs', async () => {
      serveBooks(BOOK_WITH_DUPLICATES);

      renderBookData();

      await waitFor(() =>
        expect(jest.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('GEN 1:1')),
      );
    });

    it('warns only once when the same book is fetched again', async () => {
      serveBooks(BOOK_WITH_DUPLICATES);
      const { result, rerender } = renderBookData();
      await waitFor(() => expect(jest.mocked(papi.notifications.send)).toHaveBeenCalled());

      mockLanguageTag('fr');
      rerender({ scrRef: GEN_1_1 });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledTimes(1);
    });

    it('warns again when the book is fetched with another duplicate marker', async () => {
      serveBooks(BOOK_WITH_DUPLICATES);
      const { rerender } = renderBookData();
      await waitFor(() => expect(jest.mocked(papi.notifications.send)).toHaveBeenCalled());

      serveBooks({ ...TEST_BOOK, duplicateVerseIds: ['GEN 1:1', 'GEN 5:3'] });
      mockLanguageTag('fr');
      rerender({ scrRef: GEN_1_1 });

      await waitFor(() => expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledTimes(2));
      expect(jest.mocked(logger.warn)).toHaveBeenLastCalledWith(expect.stringContaining('GEN 5:3'));
    });

    it('does not warn for a book with no duplicates', async () => {
      const { result } = renderBookData();

      await waitFor(() => expect(result.current.book).toEqual(TEST_BOOK));
      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });
  });
});
