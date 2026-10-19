/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import type { Book } from 'interlinearizer';
import type { SegmentPages } from '../../hooks/useSegmentPages';
import useStripSegments, {
  STRIP_PREFETCH_SEGMENTS,
  type UseStripSegmentsArgs,
} from '../../hooks/useStripSegments';
import { STRIP_MARGIN_WORDS } from '../../utils/strip-range';
import { makeSegment, makeWordToken, outlineOf } from '../test-helpers';

/** A book of `count` one-word verses in chapter 1. */
function makeBook(count: number): Book {
  return {
    id: 'GEN',
    bookRef: 'GEN',
    textVersion: 'v1',
    duplicateVerseIds: [],
    segments: Array.from({ length: count }, (_unused, i) =>
      makeSegment(`GEN 1:${i + 1}`, 'word', [makeWordToken(tokenAt(i), 'word')]),
    ),
  };
}

/** Ref of the one token of the segment at `index`. */
function tokenAt(index: number): string {
  return `GEN 1:${index + 1}:0`;
}

const BOOK = makeBook(200);

/** Every segment the outline places each token in. */
const TOKEN_SEGMENTS: ReadonlyMap<string, string> = new Map(
  BOOK.segments.map((segment) => [segment.tokens[0].ref, segment.id]),
);

/** Pages of `book` loaded across `[start, end)`, which `loadMore` widens. */
function makePages(book: Book, start = 0, end = book.segments.length) {
  let loaded = { start, end };
  let version = 0;
  const listeners = new Set<() => void>();
  const pages: SegmentPages = {
    bookRef: book.bookRef,
    outline: outlineOf(book.segments),
    segmentationVersion: 0,
    segmentAt: (index) =>
      index >= loaded.start && index < loaded.end ? book.segments[index] : undefined,
    load: jest.fn(),
    release: jest.fn(),
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    loadedVersion: () => version,
  };
  const loadMore = (nextStart: number, nextEnd: number) =>
    act(() => {
      loaded = { start: nextStart, end: nextEnd };
      version += 1;
      listeners.forEach((listener) => listener());
    });
  return { pages, loadMore };
}

/** Pages of {@link BOOK}, every one loaded. */
const LOADED = makePages(BOOK).pages;

function stripArgs(overrides: Partial<UseStripSegmentsArgs>): UseStripSegmentsArgs {
  return {
    pages: LOADED,
    focusTokenRef: tokenAt(100),
    nextFocusTokenRef: tokenAt(100),
    tokenSegmentMap: TOKEN_SEGMENTS,
    ...overrides,
  };
}

function renderStrip(overrides: Partial<UseStripSegmentsArgs> = {}) {
  return renderHook((props: UseStripSegmentsArgs) => useStripSegments(props), {
    initialProps: stripArgs(overrides),
  });
}

/** The outline indexes of the segments held, first and last. */
function heldRange(segments: readonly { id: string }[]): [number, number] {
  const indexOf = (id: string | undefined) => BOOK.segments.findIndex((s) => s.id === id);
  return [indexOf(segments[0]?.id), indexOf(segments.at(-1)?.id)];
}

describe('useStripSegments', () => {
  it('holds the segments around the focus, a margin of words each side', () => {
    const { result } = renderStrip();

    expect(heldRange(result.current.segments)).toEqual([
      100 - STRIP_MARGIN_WORDS,
      100 + STRIP_MARGIN_WORDS,
    ]);
  });

  it('holds the segments around the focus being moved to when the one shown is not in the book', () => {
    const { result } = renderStrip({ focusTokenRef: 'EXO 1:1:0', nextFocusTokenRef: tokenAt(150) });

    expect(heldRange(result.current.segments)).toEqual([
      150 - STRIP_MARGIN_WORDS,
      150 + STRIP_MARGIN_WORDS,
    ]);
  });

  it('holds segments from the start of the book when nothing is focused', () => {
    const { result } = renderStrip({ focusTokenRef: undefined, nextFocusTokenRef: undefined });

    expect(heldRange(result.current.segments)).toEqual([0, STRIP_MARGIN_WORDS]);
  });

  it('holds only the segments whose pages have loaded', () => {
    const { result } = renderStrip({ pages: makePages(BOOK, 90, 110).pages });

    expect(heldRange(result.current.segments)).toEqual([90, 109]);
  });

  it('holds nothing until the page holding the focus has loaded', () => {
    const { result } = renderStrip({ pages: makePages(BOOK, 0, 10).pages });

    expect(result.current.segments).toEqual([]);
  });

  it('holds segments as their pages load', () => {
    const { pages, loadMore } = makePages(BOOK, 90, 110);
    const { result } = renderStrip({ pages });

    loadMore(0, 200);

    expect(heldRange(result.current.segments)).toEqual([
      100 - STRIP_MARGIN_WORDS,
      100 + STRIP_MARGIN_WORDS,
    ]);
  });

  it('keeps the segments it holds while pages load elsewhere', () => {
    const { pages, loadMore } = makePages(BOOK, 0, 150);
    const { result } = renderStrip({ pages });
    const before = result.current.segments;

    loadMore(0, 200);

    expect(result.current.segments).toBe(before);
  });

  it('follows the segments mounted, a margin of words past them', () => {
    const { result } = renderStrip();

    act(() => result.current.setMounted(tokenAt(95), tokenAt(140)));

    expect(heldRange(result.current.segments)).toEqual([
      95 - STRIP_MARGIN_WORDS,
      140 + STRIP_MARGIN_WORDS,
    ]);
  });

  it('holds a focus that stays put within the margin of the segments mounted away from it', () => {
    const { result } = renderStrip();

    act(() => result.current.setMounted(tokenAt(110), tokenAt(120)));

    expect(heldRange(result.current.segments)).toEqual([
      110 - STRIP_MARGIN_WORDS,
      120 + STRIP_MARGIN_WORDS,
    ]);
    expect(result.current.isFocusLeftBehind).toBe(false);
  });

  it('lets go of a focus that stays put once the segments mounted move past its margin', () => {
    const { result } = renderStrip();

    act(() => result.current.setMounted(tokenAt(150), tokenAt(160)));

    expect(heldRange(result.current.segments)).toEqual([
      150 - STRIP_MARGIN_WORDS,
      160 + STRIP_MARGIN_WORDS,
    ]);
    expect(result.current.isFocusLeftBehind).toBe(true);
  });

  it('holds the segments around a focus left behind again when asked', () => {
    const { result } = renderStrip();
    act(() => result.current.setMounted(tokenAt(150), tokenAt(160)));

    act(() => result.current.holdFocus());

    expect(heldRange(result.current.segments)).toEqual([
      100 - STRIP_MARGIN_WORDS,
      100 + STRIP_MARGIN_WORDS,
    ]);
    expect(result.current.isFocusLeftBehind).toBe(false);
  });

  it('keeps following the segments mounted when the focus moves within them', () => {
    const { result, rerender } = renderStrip();
    act(() => result.current.setMounted(tokenAt(95), tokenAt(140)));

    rerender(stripArgs({ focusTokenRef: tokenAt(120) }));

    expect(heldRange(result.current.segments)).toEqual([
      95 - STRIP_MARGIN_WORDS,
      140 + STRIP_MARGIN_WORDS,
    ]);
  });

  it('holds only the segments around a focus that moves clear of those mounted', () => {
    const { result, rerender } = renderStrip();
    act(() => result.current.setMounted(tokenAt(95), tokenAt(105)));

    rerender(stripArgs({ focusTokenRef: tokenAt(180) }));

    expect(heldRange(result.current.segments)).toEqual([180 - STRIP_MARGIN_WORDS, 199]);
  });

  it('asks for the pages it holds, and some beyond', () => {
    const { pages } = makePages(BOOK);

    renderStrip({ pages });

    expect(pages.load).toHaveBeenCalledWith(
      100 - STRIP_MARGIN_WORDS - STRIP_PREFETCH_SEGMENTS,
      100 + STRIP_MARGIN_WORDS + 1 + STRIP_PREFETCH_SEGMENTS,
      'strip',
    );
  });

  it('asks for the pages around a focus it is moving to', () => {
    const { pages } = makePages(BOOK);

    renderStrip({ pages, nextFocusTokenRef: tokenAt(180) });

    expect(pages.load).toHaveBeenLastCalledWith(
      180 - STRIP_MARGIN_WORDS - STRIP_PREFETCH_SEGMENTS,
      200 + STRIP_PREFETCH_SEGMENTS,
      'strip',
    );
  });

  it('asks for nothing more for a focus it is moving to among the segments it holds', () => {
    const { pages } = makePages(BOOK);

    renderStrip({ pages, nextFocusTokenRef: tokenAt(110) });

    expect(pages.load).toHaveBeenCalledTimes(1);
  });

  it('releases the pages it asked for when it unmounts', () => {
    const { pages } = makePages(BOOK);
    const { unmount } = renderStrip({ pages });

    unmount();

    expect(pages.release).toHaveBeenCalledWith('strip');
  });

  it('tells a token whose page has loaded', () => {
    const { result } = renderStrip({ pages: makePages(BOOK, 90, 110).pages });

    expect(result.current.hasPage(tokenAt(95))).toBe(true);
  });

  it('tells a token whose page has not loaded', () => {
    const { result } = renderStrip({ pages: makePages(BOOK, 90, 110).pages });

    expect(result.current.hasPage(tokenAt(150))).toBe(false);
  });

  it('tells no page for a token of no segment', () => {
    const { result } = renderStrip();

    expect(result.current.hasPage('elsewhere')).toBe(false);
  });

  it('keeps placing the tokens it holds while the boundaries given lag the outline', () => {
    const { result, rerender } = renderStrip();
    const before = result.current.segments;

    // A split the outline has yet to give files the focus in a segment it does not list.
    const split = new Map(TOKEN_SEGMENTS);
    split.set(tokenAt(100), 'GEN 1:101:4');
    rerender(stripArgs({ tokenSegmentMap: split }));

    expect(result.current.segments).toBe(before);
  });

  it('places the focus by the boundaries given once a new outline arrives', () => {
    const { result, rerender } = renderStrip();

    rerender(stripArgs({ pages: makePages(BOOK).pages, focusTokenRef: tokenAt(150) }));

    expect(heldRange(result.current.segments)).toEqual([
      150 - STRIP_MARGIN_WORDS,
      150 + STRIP_MARGIN_WORDS,
    ]);
  });
});
