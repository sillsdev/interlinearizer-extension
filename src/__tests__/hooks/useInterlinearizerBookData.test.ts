/** @file Unit tests for useInterlinearizerBookData hook. */
/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { useProjectData, useProjectSetting } from '@papi/frontend/react';
import { renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { extractBookFromUsj, type RawBook } from 'parsers/papi/usjBookExtractor';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';

jest.mock('parsers/papi/bookTokenizer');
jest.mock('parsers/papi/usjBookExtractor');

/** Mock PlatformError shape */
type PlatformError = { message: string; platformErrorVersion: number };

/** Pre-built RawBook for mocking extractBookFromUsj return value */
const TEST_RAW_BOOK: RawBook = {
  bookCode: 'GEN',
  writingSystem: 'en',
  contentHash: 'test-hash',
  verses: [
    { sid: 'GEN 1:1', text: 'In the beginning.' },
    { sid: 'GEN 1:2', text: 'And the earth.' },
    { sid: 'GEN 2:1', text: 'The second day.' },
  ],
};

/** Pre-built Book for mocking tokenizeBook return value */
const TEST_BOOK: Book = {
  id: 'GEN',
  bookRef: 'GEN',
  textVersion: 'v1',
  segments: [
    {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          id: 'GEN 1:1:0',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
      ],
    },
    {
      id: 'GEN 1:2',
      startRef: { book: 'GEN', chapter: 1, verse: 2 },
      endRef: { book: 'GEN', chapter: 1, verse: 2 },
      baselineText: 'And the earth.',
      tokens: [
        {
          id: 'GEN 1:2:0',
          surfaceText: 'And',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 3,
        },
      ],
    },
    {
      id: 'GEN 2:1',
      startRef: { book: 'GEN', chapter: 2, verse: 1 },
      endRef: { book: 'GEN', chapter: 2, verse: 1 },
      baselineText: 'The second day.',
      tokens: [
        {
          id: 'GEN 2:1:0',
          surfaceText: 'The',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 3,
        },
      ],
    },
  ],
};

const GEN_1_1_SRC_REF = { book: 'GEN', chapterNum: 1, verseNum: 1 };

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

  /**
   * Configures useProjectSetting to return the writing system code 'en' so the hook uses a
   * valid BCP 47 tag rather than falling back to 'und'.
   */
  const setupDefaultProjectSettingMock = () => {
    jest.mocked(useProjectSetting).mockReturnValue(['en', jest.fn(), jest.fn(), false]);
  };

  beforeEach(() => {
    jest.mocked(logger.error).mockImplementation(() => {});
    setupDefaultProjectDataMock();
    setupDefaultProjectSettingMock();
  });

  it('returns book data when project is set and data loads successfully', () => {
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

  it('filters segments to current chapter', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.chapterSegments).toHaveLength(2); // Only GEN 1:1 and GEN 1:2
    expect(result.current.chapterSegments[0].id).toBe('GEN 1:1');
    expect(result.current.chapterSegments[1].id).toBe('GEN 1:2');
  });

  it('filters segments for different chapters correctly', () => {
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({
        projectId: 'test-project',
        scrRef: { book: 'GEN', chapterNum: 2, verseNum: 1 },
      }),
    );

    expect(result.current.chapterSegments).toHaveLength(1); // Only GEN 2:1
    expect(result.current.chapterSegments[0].id).toBe('GEN 2:1');
  });

  it('falls back to "und" writing system when useProjectSetting returns PlatformError', () => {
    const platformError: PlatformError = {
      message: 'Setting unavailable',
      platformErrorVersion: 1,
    };
    jest.mocked(useProjectSetting).mockReturnValue([platformError, jest.fn(), jest.fn(), false]);
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);
    expect(jest.mocked(extractBookFromUsj)).toHaveBeenCalledWith({ USJ: 'mock-usj' }, 'und');
  });

  it('falls back to "und" writing system when useProjectSetting returns empty string', () => {
    jest.mocked(useProjectSetting).mockReturnValue(['', jest.fn(), jest.fn(), false]);
    jest.mocked(extractBookFromUsj).mockReturnValue(TEST_RAW_BOOK);
    jest.mocked(tokenizeBook).mockReturnValue(TEST_BOOK);

    const { result } = renderHook(() =>
      useInterlinearizerBookData({ projectId: 'test-project', scrRef: { ...GEN_1_1_SRC_REF } }),
    );

    expect(result.current.book).toBe(TEST_BOOK);
    expect(jest.mocked(extractBookFromUsj)).toHaveBeenCalledWith({ USJ: 'mock-usj' }, 'und');
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

  it('logs tokenization error with PlatformError writing system', () => {
    const platformError: PlatformError = {
      message: 'Setting unavailable',
      platformErrorVersion: 1,
    };
    jest.mocked(useProjectSetting).mockReturnValue([platformError, jest.fn(), jest.fn(), false]);
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

  it('logs tokenization error with empty string writing system', () => {
    jest.mocked(useProjectSetting).mockReturnValue(['', jest.fn(), jest.fn(), false]);
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
});
