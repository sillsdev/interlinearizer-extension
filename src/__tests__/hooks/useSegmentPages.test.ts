/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Book, Segment, SegmentationDelta } from 'interlinearizer';
import useSegmentPages, {
  PAGE_RETRY_DELAYS_MS,
  PAGE_SIZE,
  type UseSegmentPagesArgs,
} from '../../hooks/useSegmentPages';
import type { BookOutline, SegmentPage } from '../../types/segment-pages';
import { getMockedSendCommand, makeSegment, makeWordToken, outlineOf } from '../test-helpers';

const mockSendCommand = getMockedSendCommand(papi);

/** A book of `count` one-word verses in chapter 1. */
function makeBook(count: number, textVersion = 'v1'): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion,
    duplicateVerseIds: [],
    segments: Array.from({ length: count }, (_unused, i) =>
      makeSegment(`GEN 1:${i + 1}`, 'word', [makeWordToken(`GEN 1:${i + 1}:0`, 'word')]),
    ),
  };
}

const BOOK = makeBook(100);

/** Merges verse 2 into verse 1. */
const MERGE_1_2: SegmentationDelta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

const VERSE_1: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/** One request the host was sent, held open until the test answers it. */
interface Request {
  command: string;
  args: unknown[];
  respond: () => void;
  reject: (error: Error) => void;
}

/** Answers `requests` from the host's book, together. */
async function answer(...requests: Request[]): Promise<void> {
  await act(async () => requests.forEach((request) => request.respond()));
}

async function fail(request: Request, error: Error): Promise<void> {
  await act(async () => request.reject(error));
}

/**
 * Segments `book` as the host would: one segment per verse, or verses 1 and 2 as one when a request
 * names {@link MERGE_1_2}, the only boundaries these tests name.
 */
function segmentsFor(book: Book, segmentationJson: unknown): readonly Segment[] {
  if (segmentationJson === undefined) return book.segments;
  const [first, second, ...rest] = book.segments;
  return [
    { ...first, endRef: second.endRef, tokens: [...first.tokens, ...second.tokens] },
    ...rest,
  ];
}

/** What the host answers a request with when it serves `book`. */
function hostAnswer(book: Book, command: string, args: unknown[]): string {
  if (command === 'interlinearizer.getBookOutline') {
    const outline: BookOutline = {
      bookRef: book.bookRef,
      textVersion: book.textVersion,
      segments: outlineOf(segmentsFor(book, args[2])),
    };
    return JSON.stringify(outline);
  }
  const [, , start, end, segmentationJson] = args;
  if (typeof start !== 'number' || typeof end !== 'number') throw new Error('Expected a range');
  const page: SegmentPage = {
    textVersion: book.textVersion,
    start,
    segments: segmentsFor(book, segmentationJson).slice(start, end),
  };
  return JSON.stringify(page);
}

/**
 * Has the host answer every request at once from `book`, or hold each open in the returned list
 * when `held`.
 */
function serveHost(book: Book | (() => Book), { held = false } = {}): Request[] {
  const requests: Request[] = [];
  const bookNow = typeof book === 'function' ? book : () => book;
  mockSendCommand.mockImplementation((command: string, ...args: unknown[]) => {
    if (!held) return Promise.resolve(hostAnswer(bookNow(), command, args));
    return new Promise((resolve, reject) => {
      requests.push({
        command,
        args,
        respond: () => resolve(hostAnswer(bookNow(), command, args)),
        reject,
      });
    });
  });
  return requests;
}

/** The `[start, end)` ranges of segments asked of the host so far, a request apiece. */
function rangesAskedFor(): [number, number][] {
  return mockSendCommand.mock.calls
    .filter(([command]) => command === 'interlinearizer.getSegments')
    .map(([, , , start, end]) => [Number(start), Number(end)]);
}

/** The pages asked of the host so far, by index. */
function pagesAskedFor(): number[] {
  return rangesAskedFor().flatMap(([start, end]) =>
    Array.from({ length: (end - start) / PAGE_SIZE }, (_unused, i) => start / PAGE_SIZE + i),
  );
}

/** The arguments {@link renderPages} renders with, but for `overrides`. */
function pageArgs(overrides: Partial<UseSegmentPagesArgs> = {}): UseSegmentPagesArgs {
  return {
    projectId: 'src',
    verseBook: BOOK,
    segmentation: undefined,
    segmentationVersion: 0,
    scrRef: VERSE_1,
    onTextChanged: jest.fn(),
    ...overrides,
  };
}

function renderPages(overrides: Partial<UseSegmentPagesArgs> = {}) {
  return renderHook((props: UseSegmentPagesArgs) => useSegmentPages(props), {
    initialProps: pageArgs(overrides),
  });
}

describe('useSegmentPages', () => {
  it('asks for nothing before the book has loaded', () => {
    serveHost(BOOK);

    const { result } = renderPages({ verseBook: undefined });

    expect(result.current).toEqual({ pages: undefined, isLoading: false, error: undefined });
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("outlines the book by the project's boundaries", async () => {
    serveHost(BOOK);

    const { result } = renderPages({ segmentation: MERGE_1_2 });

    await waitFor(() => expect(result.current.pages).toBeDefined());
    expect(mockSendCommand).toHaveBeenCalledWith(
      'interlinearizer.getBookOutline',
      'src',
      'GEN',
      JSON.stringify(MERGE_1_2),
    );
    expect(result.current.pages?.bookRef).toBe('GEN');
    expect(result.current.pages?.outline.map((seg) => seg.id).slice(0, 2)).toEqual([
      'GEN 1:1',
      'GEN 1:3',
    ]);
  });

  it('outlines one segment per verse when the project has no boundaries', async () => {
    serveHost(BOOK);

    const { result } = renderPages();

    await waitFor(() => expect(result.current.pages?.outline).toHaveLength(100));
    expect(mockSendCommand).toHaveBeenCalledWith(
      'interlinearizer.getBookOutline',
      'src',
      'GEN',
      undefined,
    );
  });

  it('stays loading until the pages around the verse opened on have loaded', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result } = renderPages({ scrRef: { ...VERSE_1, verseNum: 50 } });

    await answer(requests[0]);
    expect(result.current.isLoading).toBe(true);
    expect(pagesAskedFor()).toEqual([0, 1, 2]);
    await answer(...requests.slice(1));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pages?.segmentAt(49)?.id).toBe('GEN 1:50');
  });

  it('serves no segment whose page has not loaded', async () => {
    serveHost(BOOK);

    const { result } = renderPages();

    await waitFor(() => expect(result.current.pages).toBeDefined());
    expect(result.current.pages?.segmentAt(0)?.id).toBe('GEN 1:1');
    expect(result.current.pages?.segmentAt(99)).toBeUndefined();
  });

  it('loads the pages asked for', async () => {
    serveHost(BOOK);
    const { result } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());

    act(() => result.current.pages?.load(90, 100));

    await waitFor(() => expect(result.current.pages?.segmentAt(99)?.id).toBe('GEN 1:100'));
    expect(result.current.pages?.segmentAt(2 * PAGE_SIZE)?.id).toBe(`GEN 1:${2 * PAGE_SIZE + 1}`);
  });

  it('asks for a run of missing pages in one request', async () => {
    serveHost(BOOK);
    const { result } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());

    act(() => result.current.pages?.load(90, 100));

    await waitFor(() => expect(result.current.pages?.segmentAt(99)).toBeDefined());
    expect(rangesAskedFor()).toEqual([
      [0, 2 * PAGE_SIZE],
      [2 * PAGE_SIZE, 4 * PAGE_SIZE],
    ]);
  });

  it('asks for each run of missing pages in a request of its own', async () => {
    serveHost(makeBook(200));
    const { result } = renderPages({
      verseBook: makeBook(200),
      scrRef: { ...VERSE_1, verseNum: 100 },
    });
    await waitFor(() => expect(result.current.pages).toBeDefined());
    mockSendCommand.mockClear();

    act(() => result.current.pages?.load(0, 200));

    await waitFor(() => expect(result.current.pages?.segmentAt(199)).toBeDefined());
    expect(rangesAskedFor()).toEqual([
      [0, PAGE_SIZE],
      [5 * PAGE_SIZE, 7 * PAGE_SIZE],
    ]);
  });

  it('lets subscribers know when pages load', async () => {
    serveHost(BOOK);
    const { result } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());
    const onChange = jest.fn();
    result.current.pages?.subscribe(onChange);
    const version = result.current.pages?.loadedVersion();

    act(() => result.current.pages?.load(90, 100));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(result.current.pages?.loadedVersion()).not.toBe(version);
  });

  it('stops letting a subscriber know once it unsubscribes', async () => {
    serveHost(BOOK);
    const { result } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());
    const onChange = jest.fn();
    result.current.pages?.subscribe(onChange)();

    act(() => result.current.pages?.load(90, 100));

    await waitFor(() => expect(result.current.pages?.segmentAt(99)).toBeDefined());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks for a page once while it loads, and not again once it has', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result } = renderPages();
    await answer(requests[0]);
    await answer(...requests.slice(1));

    act(() => result.current.pages?.load(70, 80));
    act(() => result.current.pages?.load(70, 80));
    await answer(requests[requests.length - 1]);
    act(() => result.current.pages?.load(70, 80));

    expect(pagesAskedFor()).toEqual([0, 1, 2]);
  });

  it('asks for no page beyond the ends of the book', async () => {
    serveHost(BOOK);
    const { result } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());

    act(() => result.current.pages?.load(-50, 500));

    await waitFor(() => expect(pagesAskedFor()).toEqual([0, 1, 2, 3]));
  });

  it('keeps the outline it has while the outline for new boundaries loads', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages();
    await answer(requests[0]);
    await answer(...requests.slice(1));
    const before = result.current.pages;

    rerender(pageArgs({ segmentation: MERGE_1_2, segmentationVersion: 1 }));
    await answer(requests[2]);

    expect(result.current.pages).toBe(before);
    expect(result.current.isLoading).toBe(false);
    await answer(...requests.slice(3));
    expect(result.current.pages?.outline[1].id).toBe('GEN 1:3');
    expect(result.current.pages?.segmentationVersion).toBe(1);
  });

  it('loads the pages last asked for with the outline for new boundaries', async () => {
    serveHost(BOOK);
    const { result, rerender } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());
    act(() => result.current.pages?.load(90, 100));
    await waitFor(() => expect(result.current.pages?.segmentAt(99)).toBeDefined());
    mockSendCommand.mockClear();

    rerender(pageArgs({ segmentation: MERGE_1_2, segmentationVersion: 1 }));

    await waitFor(() => expect(result.current.pages?.segmentationVersion).toBe(1));
    expect(result.current.pages?.segmentAt(98)?.id).toBe('GEN 1:100');
    expect(pagesAskedFor()).toEqual([0, 1, 2, 3]);
  });

  it('carries the boundary-edit count the outline was asked for at', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages({ segmentationVersion: 4 });

    rerender(pageArgs({ segmentationVersion: 5 }));
    await answer(requests[0]);
    await answer(...requests.slice(1));

    expect(result.current.pages?.segmentationVersion).toBe(4);
  });

  it('ignores an outline asked for by boundaries since replaced', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages();

    rerender(pageArgs({ segmentation: MERGE_1_2 }));
    await answer(requests[0]);
    await answer(requests[1]);
    await answer(...requests.slice(2));

    expect(result.current.pages?.outline[1].id).toBe('GEN 1:3');
    expect(pagesAskedFor()).toEqual([0, 1]);
  });

  it('ignores pages of an outline asked for by boundaries since replaced', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages();
    await answer(requests[0]);

    rerender(pageArgs({ segmentation: MERGE_1_2 }));
    await answer(...requests.slice(1, 3));

    expect(result.current.pages).toBeUndefined();
  });

  it('ignores a page loaded for an outline since replaced', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages();
    await answer(requests[0]);
    await answer(...requests.slice(1));
    act(() => result.current.pages?.load(96, 100));
    rerender(pageArgs({ segmentation: MERGE_1_2 }));
    await answer(requests[3]);
    await answer(...requests.slice(4));

    await answer(requests[2]);

    expect(result.current.pages?.segmentAt(97)?.id).toBe('GEN 1:99');
  });

  it('reports a book whose text has changed since it loaded', async () => {
    serveHost(makeBook(100, 'v2'));
    const onTextChanged = jest.fn();

    const { result } = renderPages({ onTextChanged });

    await waitFor(() => expect(onTextChanged).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
  });

  it('reports a book whose text has gone', async () => {
    mockSendCommand.mockResolvedValue(undefined);
    const onTextChanged = jest.fn();

    renderPages({ onTextChanged });

    await waitFor(() => expect(onTextChanged).toHaveBeenCalled());
  });

  it('reports a book whose text changed before its first pages were cut', async () => {
    let book = BOOK;
    const requests = serveHost(() => book, { held: true });
    const onTextChanged = jest.fn();
    const { result } = renderPages({ onTextChanged });
    await answer(requests[0]);

    book = makeBook(100, 'v2');
    await answer(...requests.slice(1));

    expect(onTextChanged).toHaveBeenCalled();
    expect(result.current.pages).toBeUndefined();
  });

  it('reports a book whose text changed before a page asked for later was cut', async () => {
    let book = BOOK;
    serveHost(() => book);
    const onTextChanged = jest.fn();
    const { result } = renderPages({ onTextChanged });
    await waitFor(() => expect(result.current.pages).toBeDefined());

    book = makeBook(100, 'v2');
    act(() => result.current.pages?.load(90, 100));

    await waitFor(() => expect(onTextChanged).toHaveBeenCalled());
    expect(result.current.pages?.segmentAt(99)).toBeUndefined();
  });

  it('reports a book whose text went before a page asked for later was cut', async () => {
    serveHost(BOOK);
    const onTextChanged = jest.fn();
    const { result } = renderPages({ onTextChanged });
    await waitFor(() => expect(result.current.pages).toBeDefined());

    mockSendCommand.mockResolvedValue(undefined);
    act(() => result.current.pages?.load(96, 100));

    await waitFor(() => expect(onTextChanged).toHaveBeenCalled());
  });

  it('reports why the outline could not be loaded', async () => {
    mockSendCommand.mockRejectedValue(new Error('no such book'));

    const { result } = renderPages();

    await waitFor(() => expect(result.current.error).toBe('no such book'));
    expect(result.current.isLoading).toBe(false);
  });

  it('reports a failure that is not an Error by its text', async () => {
    mockSendCommand.mockRejectedValue('offline');

    const { result } = renderPages();

    await waitFor(() => expect(result.current.error).toBe('offline'));
  });

  it('drops a failure once an outline loads', async () => {
    mockSendCommand.mockRejectedValue(new Error('busy'));
    const { result, rerender } = renderPages();
    await waitFor(() => expect(result.current.error).toBe('busy'));

    serveHost(BOOK);
    rerender(pageArgs({ segmentation: MERGE_1_2 }));

    await waitFor(() => expect(result.current.pages).toBeDefined());
    expect(result.current.error).toBeUndefined();
  });

  it('ignores a failure of an outline since replaced', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result, rerender } = renderPages();

    rerender(pageArgs({ segmentation: MERGE_1_2 }));
    await fail(requests[0], new Error('busy'));

    expect(result.current.error).toBeUndefined();
  });

  it('asks again for a page that failed to load', async () => {
    const requests = serveHost(BOOK, { held: true });
    const { result } = renderPages();
    await answer(requests[0]);
    await answer(...requests.slice(1));
    act(() => result.current.pages?.load(96, 100));

    await fail(requests[2], new Error('busy'));
    act(() => result.current.pages?.load(96, 100));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('busy'));
    expect(pagesAskedFor()).toEqual([0, 1, 3, 3]);
  });

  describe('a page that fails to load while shown', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /** Loads the outline, subscribes to its pages, and fails the request for page 3. */
    async function failPage3() {
      const requests = serveHost(BOOK, { held: true });
      const { result } = renderPages();
      await answer(requests[0]);
      await answer(...requests.slice(1));
      const unsubscribe = result.current.pages?.subscribe(jest.fn());
      act(() => result.current.pages?.load(96, 100));
      await fail(requests[2], new Error('busy'));
      return { requests, result, unsubscribe };
    }

    async function advance(ms: number): Promise<void> {
      await act(async () => jest.advanceTimersByTime(ms));
    }

    it('is asked for again once the first retry delay has passed', async () => {
      await failPage3();
      await advance(PAGE_RETRY_DELAYS_MS[0]);

      expect(pagesAskedFor()).toEqual([0, 1, 3, 3]);
    });

    it('is not asked for again before the first retry delay has passed', async () => {
      await failPage3();
      await advance(PAGE_RETRY_DELAYS_MS[0] - 1);

      expect(pagesAskedFor()).toEqual([0, 1, 3]);
    });

    it('loads when a retry succeeds', async () => {
      const { requests, result } = await failPage3();
      await advance(PAGE_RETRY_DELAYS_MS[0]);
      await answer(requests[3]);

      expect(result.current.pages?.segmentAt(96)).toBeDefined();
    });

    it('is given up once every retry has failed', async () => {
      const { requests } = await failPage3();
      await PAGE_RETRY_DELAYS_MS.reduce(async (prior, delay, i) => {
        await prior;
        await advance(delay);
        await fail(requests[3 + i], new Error('busy'));
      }, Promise.resolve());
      await act(async () => jest.runAllTimers());

      expect(pagesAskedFor()).toEqual([0, 1, 3, ...PAGE_RETRY_DELAYS_MS.map(() => 3)]);
    });

    it('in a later run of missing pages is asked for again once the first retry delay has passed', async () => {
      const book = makeBook(200);
      const requests = serveHost(book, { held: true });
      const { result } = renderPages({ verseBook: book, scrRef: { ...VERSE_1, verseNum: 100 } });
      await answer(requests[0]);
      await answer(...requests.slice(1));
      result.current.pages?.subscribe(jest.fn());
      act(() => result.current.pages?.load(0, 200));
      await fail(requests[2], new Error('busy'));
      await fail(requests[3], new Error('busy'));
      await advance(PAGE_RETRY_DELAYS_MS[0]);

      expect(pagesAskedFor()).toEqual([1, 2, 3, 4, 0, 5, 6, 0, 5, 6]);
    });

    it('is not asked for again once nothing is subscribed', async () => {
      const { unsubscribe } = await failPage3();
      unsubscribe?.();
      await advance(PAGE_RETRY_DELAYS_MS[0]);

      expect(pagesAskedFor()).toEqual([0, 1, 3]);
    });
  });

  it('stays loading for another book until its outline loads', async () => {
    serveHost(BOOK);
    const { result, rerender } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());

    rerender(pageArgs({ verseBook: { ...BOOK } }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('asks for nothing once the book has been unloaded', async () => {
    serveHost(BOOK);
    const { result, rerender } = renderPages();
    await waitFor(() => expect(result.current.pages).toBeDefined());
    mockSendCommand.mockClear();

    rerender(pageArgs({ verseBook: undefined }));

    expect(result.current.isLoading).toBe(false);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });
});
