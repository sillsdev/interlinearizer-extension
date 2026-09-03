/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { useProjectData, useProjectSetting } from '@papi/frontend/react';
import { renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj, type RawBook } from 'parsers/papi/usjBookExtractor';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import { makeSegment, makeWordToken } from '../test-helpers';

jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

/** Mock PlatformError shape */
type PlatformError = { message: string; platformErrorVersion: number };

/** Pre-built RawBook for mocking extractBookFromUsj return value */
const TEST_RAW_BOOK: RawBook = {
  bookCode: 'GEN',
  writingSystem: 'en',
  contentHash: 'test-hash',
  duplicateVerseIds: [],
  verses: [
    { sid: 'GEN 1:1', number: '1', text: 'In the beginning.' },
    { sid: 'GEN 1:2', number: '2', text: 'And the earth.' },
    { sid: 'GEN 2:1', number: '1', text: 'The second day.' },
  ],
};

/** Pre-built Book for mocking tokenizeBook return value */
const TEST_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  duplicateVerseIds: [],
  segments: [
    makeSegment('GEN 1:1', 'In the beginning.', [makeWordToken('GEN 1:1:0', 'In')]),
    makeSegment('GEN 1:2', 'And the earth.', [makeWordToken('GEN 1:2:0', 'And')]),
    makeSegment('GEN 2:1', 'The second day.', [makeWordToken('GEN 2:1:0', 'The')]),
  ],
};

const GEN_1_1_SRC_REF = { book: 'GEN', chapterNum: 1, verseNum: 1 };

function mockUseProjectSettings(defaultState: string | PlatformError | undefined) {
  jest.mocked(useProjectSetting).mockReturnValue([defaultState, jest.fn(), jest.fn(), false]);
}

describe('useInterlinearizerBookData', () => {
  /**
   * Configures useProjectData to return a resolved USJ object so the hook can proceed to
   * extractBookFromUsj and tokenizeBook without hitting the error-state branches.
   */
  const setupDefaultProjectDataMock = () => {
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [{ USJ: 'mock-usj' }, jest.fn(), false],
    });
  };

  beforeEach(() => {
    jest.mocked(logger.error).mockImplementation(() => {});
    setupDefaultProjectDataMock();
    // A valid writing-system tag so the hook doesn't fall back to 'und'.
    mockUseProjectSettings('en');
  });

  it('returns isLoading=true and no book when USJ data has not arrived', () => {
    jest.mocked(useProjectData).mockReturnValue({ BookUSJ: () => [undefined, jest.fn(), true] });
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.bookError).toBeUndefined();
  });

  it('returns error when USJ book data is a PlatformError', () => {
    const platformError: PlatformError = { message: 'Project not found', platformErrorVersion: 1 };
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [platformError, jest.fn(), false],
    });

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.bookError).toBe('Project not found');
    expect(result.current.tokenizeError).toBeUndefined();
  });

  it('returns error when USJ book is unavailable', () => {
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [undefined, jest.fn(), false],
    });

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.bookError).toContain('No USJ book available');
  });

  it('returns tokenization error when extractBookFromUsj throws', () => {
    const error = new Error('Invalid USJ format');
    jest.mocked(extractBookFromUsj).mockImplementation(() => {
      throw error;
    });

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.tokenizeError?.message).toBe('Invalid USJ format');
    expect(result.current.tokenizeError?.raw).toBe(error);
  });

  it('returns tokenization error when tokenizeBook throws non-Error', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);

    const nonErrorValue = 'some string error';
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw nonErrorValue;
    });

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.tokenizeError?.message).toBe('some string error');
    expect(result.current.tokenizeError?.raw).toBe(nonErrorValue);
  });

  it('returns the whole tokenized book without filtering segments by chapter', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);
    expect(result.current.book?.segments).toBe(TEST_BOOK.segments);
  });

  it('falls back to "und" writing system when useProjectSetting returns PlatformError', () => {
    const platformError: PlatformError = {
      message: 'Setting unavailable',
      platformErrorVersion: 1,
    };
    mockUseProjectSettings(platformError);
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);
    expect(jest.mocked(extractBookFromUsj)).toHaveBeenCalledWith({ USJ: 'mock-usj' }, 'und');
  });

  it('reports the writing system the book was tokenized under', () => {
    mockUseProjectSettings('el');
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.writingSystem).toBe('el');
  });

  it('falls back to "und" writing system when useProjectSetting returns empty string', () => {
    mockUseProjectSettings('');
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);
    expect(jest.mocked(extractBookFromUsj)).toHaveBeenCalledWith({ USJ: 'mock-usj' }, 'und');
  });

  it('reports the "und" fallback before the book has loaded', () => {
    jest.mocked(useProjectData).mockReturnValue({ BookUSJ: () => [undefined, jest.fn(), true] });
    mockUseProjectSettings('');

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBeUndefined();
    expect(result.current.writingSystem).toBe('und');
  });

  it('logs tokenization error when hook has projectId and tokenizeError occurs', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);

    const error = new Error('Tokenization failed');
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw error;
    });

    renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
      'Failed to parse/tokenize USJ book',
      error,
      {
        book: 'GEN',
        message: 'Tokenization failed',
        projectId: 'test-project',
        writingSystem: 'en',
      },
    );
  });

  it('preserves book identity when PAPI delivers a duplicate result for the same book', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const usjPayload = { USJ: 'mock-usj' };
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [usjPayload, jest.fn(), false],
    });

    const { result, rerender } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    const firstBook = result.current.book;
    expect(firstBook).toBe(TEST_BOOK);

    const callsBefore = jest.mocked(extractBookFromUsj).mock.calls.length;

    const duplicatePayload = { USJ: 'mock-usj' };
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [duplicatePayload, jest.fn(), false],
    });

    rerender();

    expect(result.current.book).toBe(firstBook);
    expect(jest.mocked(extractBookFromUsj).mock.calls.length).toBe(callsBefore);
  });

  it('re-tokenizes when PAPI delivers genuinely new content', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [{ USJ: 'first-usj' }, jest.fn(), false],
    });

    const { result, rerender } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);

    const updatedBook: Book = { ...TEST_BOOK, textVersion: 'v2' };
    jest.mocked(tokenizeBook).mockReturnValue(updatedBook);
    jest.mocked(useProjectData).mockReturnValue({
      BookUSJ: () => [{ USJ: 'updated-usj' }, jest.fn(), false],
    });

    rerender();

    expect(result.current.book).toBe(updatedBook);
    expect(jest.mocked(extractBookFromUsj)).toHaveBeenCalledTimes(2);
  });

  it('logs tokenization error with the resolved writing system', () => {
    const platformError: PlatformError = {
      message: 'Setting unavailable',
      platformErrorVersion: 1,
    };
    mockUseProjectSettings(platformError);
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);

    const error = new Error('Tokenization failed');
    jest.mocked(tokenizeBook).mockImplementation(() => {
      throw error;
    });

    renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
      'Failed to parse/tokenize USJ book',
      error,
      {
        book: 'GEN',
        message: 'Tokenization failed',
        projectId: 'test-project',
        writingSystem: 'und',
      },
    );
  });

  describe('duplicate verse markers', () => {
    /** A tokenized book carrying the SIDs the extractor skipped as duplicates. */
    const BOOK_WITH_DUPLICATES: Book = { ...TEST_BOOK, duplicateVerseIds: ['GEN 1:1'] };

    beforeEach(() => {
      jest.mocked(logger.warn).mockImplementation(() => {});
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    });

    it('still returns the book when verse markers were skipped as duplicates', () => {
      jest.mocked(tokenizeBook).mockReturnValue(BOOK_WITH_DUPLICATES);

      const { result } = renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );

      expect(result.current.book).toBe(BOOK_WITH_DUPLICATES);
      expect(result.current.tokenizeError).toBeUndefined();
    });

    it('sends a warning notification naming no specific verse', () => {
      jest.mocked(tokenizeBook).mockReturnValue(BOOK_WITH_DUPLICATES);

      renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_warning_duplicateVerses%',
        severity: 'warning',
      });
    });

    it('logs the skipped SIDs', () => {
      jest.mocked(tokenizeBook).mockReturnValue(BOOK_WITH_DUPLICATES);

      renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );

      expect(jest.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('GEN 1:1'));
    });

    it('warns only once when the platform re-delivers the same book', () => {
      // A fresh USJ object each render re-tokenizes into a new Book, which is what makes the
      // warn-once effect re-run at all.
      let usjCounter = 0;
      jest.mocked(useProjectData).mockReturnValue({
        BookUSJ: () => {
          usjCounter += 1;
          return [{ USJ: `mock-usj-${usjCounter}` }, jest.fn(), false];
        },
      });
      jest
        .mocked(tokenizeBook)
        .mockImplementation(() => ({ ...BOOK_WITH_DUPLICATES, duplicateVerseIds: ['GEN 1:1'] }));

      const { rerender } = renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );
      rerender();
      rerender();

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledTimes(1);
    });

    it('warns again when an edit adds a duplicate marker to the same book', () => {
      let usjCounter = 0;
      jest.mocked(useProjectData).mockReturnValue({
        BookUSJ: () => {
          usjCounter += 1;
          return [{ USJ: `mock-usj-${usjCounter}` }, jest.fn(), false];
        },
      });
      jest.mocked(tokenizeBook).mockReturnValue(BOOK_WITH_DUPLICATES);

      const { rerender } = renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );

      jest
        .mocked(tokenizeBook)
        .mockReturnValue({ ...TEST_BOOK, duplicateVerseIds: ['GEN 1:1', 'GEN 5:3'] });
      rerender();

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledTimes(2);
      expect(jest.mocked(logger.warn)).toHaveBeenLastCalledWith(expect.stringContaining('GEN 5:3'));
    });

    it('does not warn for a book with no duplicates', () => {
      jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

      renderHook(() =>
        useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
      );

      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });
  });
});
