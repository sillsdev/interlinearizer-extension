import papi, { logger } from '@papi/frontend';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { Book, Segment, SegmentationDelta } from 'interlinearizer';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PAGE_RETRY_DELAYS_MS,
  PAGE_SIZE,
  pagesCovering,
  waitMs,
  type PageCaller,
} from '../cache/pageClient';
import type { BookOutline, OutlineSegment, SegmentPage } from '../types/segment-pages';
import { perfTime, perfTrack } from '../utils/perf-marks';
import useLatestRef from './useLatestRef';
import { EXTEND_CHUNK, INITIAL_WINDOW_HALF, findAnchorIndex } from './useSegmentWindow';

/**
 * The loaded book's segment list, as the host segments and serves it. One object per outline: pages
 * loading into it change none of its fields, only what {@link SegmentPages.segmentAt} answers.
 */
export interface SegmentPages {
  bookRef: string;
  /** Every segment of the book in document order. */
  outline: readonly OutlineSegment[];
  /** The boundary-edit count the outline was segmented at. */
  segmentationVersion: number;
  /** The segment at `index` of the outline, `undefined` until its page has loaded. */
  segmentAt: (index: number) => Segment | undefined;
  /**
   * Asks for the segments at outline indexes `[start, end)`, clamped to the outline. The latest
   * range that each `caller` asked for is reloaded whenever a new outline loads. A page that fails
   * to load is retried, after {@link PAGE_RETRY_DELAYS_MS}, while anything is subscribed.
   */
  load: (start: number, end: number, caller: PageCaller) => void;
  /** Drops the range that `caller` last asked for, so that later outlines do not reload it. */
  release: (caller: PageCaller) => void;
  /** Calls `onChange` whenever pages load, until the returned function is called. */
  subscribe: (onChange: () => void) => () => void;
  /** A number that changes whenever pages load. */
  loadedVersion: () => number;
}

/** Arguments for {@link useSegmentPages}. */
export interface UseSegmentPagesArgs {
  /** PAPI project ID of the source text. */
  projectId: string;
  /** The book as its verses tokenize it; nothing is fetched until it has loaded. */
  verseBook: Book | undefined;
  /** The book's custom boundaries; `undefined` for one segment per verse. */
  segmentation: SegmentationDelta | undefined;
  /** The boundary-edit count `segmentation` is at. */
  segmentationVersion: number;
  /** The verse the view opens on, whose pages load with the outline. */
  scrRef: SerializedVerseRef;
  /** Called when the host's text for the book differs from `verseBook`'s. */
  onTextChanged: () => void;
}

/** Return value of {@link useSegmentPages}. */
export interface UseSegmentPagesResult {
  /**
   * The pages of the latest outline to load; those of an earlier one while a later one loads, and
   * `undefined` before any has loaded.
   */
  pages: SegmentPages | undefined;
  /** `true` until the outline of `verseBook` has loaded or failed to. */
  isLoading: boolean;
  /** Why the outline of `verseBook` could not be loaded, once every retry has failed. */
  error: string | undefined;
}

/** What a request for pages is asked of. */
type PageSource = Readonly<{
  projectId: string;
  outline: BookOutline;
  segmentationJson: string | undefined;
}>;

/** Groups page indexes, ascending, into runs of consecutive pages. */
function runsOf(pageIndexes: readonly number[]): number[][] {
  const runs: number[][] = [];
  pageIndexes.forEach((pageIndex) => {
    const run = runs.at(-1);
    if (run && run.at(-1) === pageIndex - 1) run.push(pageIndex);
    else runs.push([pageIndex]);
  });
  return runs;
}

/**
 * Fetches a run of consecutive pages in one request.
 *
 * @returns Each page's segments by page index, or `undefined` when the host's text is no longer the
 *   outline's.
 * @throws If the host cannot serve them.
 */
async function fetchRun(
  { projectId, outline, segmentationJson }: PageSource,
  run: readonly number[],
): Promise<Map<number, readonly Segment[]> | undefined> {
  const first = run[0];
  const json = await perfTrack(
    'page-fetch',
    papi.commands.sendCommand(
      'interlinearizer.getSegments',
      projectId,
      outline.bookRef,
      first * PAGE_SIZE,
      (first + run.length) * PAGE_SIZE,
      segmentationJson,
    ),
    { pages: run.length },
  );
  const page: SegmentPage | undefined =
    json && perfTime('page-parse', () => JSON.parse(json), { bytes: json.length });
  if (page?.textVersion !== outline.textVersion) return undefined;
  return new Map(
    run.map((pageIndex, i) => [pageIndex, page.segments.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)]),
  );
}

/**
 * Fetches `pageIndexes`, a request per run of consecutive pages.
 *
 * @returns Every page's segments by page index, or `undefined` when the host's text is no longer
 *   the outline's.
 * @throws If the host cannot serve them.
 */
async function fetchPages(
  source: PageSource,
  pageIndexes: readonly number[],
): Promise<Map<number, readonly Segment[]> | undefined> {
  const runs = await Promise.all(runsOf(pageIndexes).map((run) => fetchRun(source, run)));
  const fetched = runs.filter((run) => run !== undefined);
  if (fetched.length < runs.length) return undefined;
  return new Map(fetched.flatMap((run) => [...run]));
}

/** What a {@link SegmentPages} is built from. */
type SegmentPagesSource = PageSource &
  Readonly<{
    segmentationVersion: number;
    /** The pages already fetched, by page index. */
    loaded: ReadonlyMap<number, readonly Segment[]>;
    onTextChanged: () => void;
    /** Called with each range asked for. */
    onLoad: (start: number, end: number, caller: PageCaller) => void;
    /** Called with each caller released. */
    onRelease: (caller: PageCaller) => void;
  }>;

function createSegmentPages(source: SegmentPagesSource): SegmentPages {
  const { outline, segmentationVersion, loaded, onTextChanged, onLoad, onRelease } = source;
  const pages = new Map(loaded);
  const inFlight = new Set<number>();
  const listeners = new Set<() => void>();
  let version = 0;

  const loadRun = async (run: readonly number[], attempt = 0): Promise<void> => {
    try {
      const fetched = await fetchRun(source, run);
      if (!fetched) {
        onTextChanged();
        return;
      }
      fetched.forEach((segments, pageIndex) => pages.set(pageIndex, segments));
      version += 1;
      listeners.forEach((listener) => listener());
    } catch (e) {
      logger.warn(
        `Interlinearizer: could not load segments ${run[0] * PAGE_SIZE}+ of ${outline.bookRef}: ${e}`,
      );
      // Pages with no subscriber are no longer shown, so are not worth asking for again.
      const delay = PAGE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || listeners.size === 0) return;
      await waitMs(delay);
      if (listeners.size > 0) await loadRun(run, attempt + 1);
    } finally {
      run.forEach((pageIndex) => inFlight.delete(pageIndex));
    }
  };

  return {
    bookRef: outline.bookRef,
    outline: outline.segments,
    segmentationVersion,
    segmentAt: (index) => pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    load: (start, end, caller) => {
      onLoad(start, end, caller);
      const missing = pagesCovering(start, end, outline.segments.length).filter(
        (pageIndex) => !pages.has(pageIndex) && !inFlight.has(pageIndex),
      );
      missing.forEach((pageIndex) => inFlight.add(pageIndex));
      runsOf(missing).forEach((run) => loadRun(run));
    },
    release: onRelease,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    loadedVersion: () => version,
  };
}

/**
 * Serves the segment list of the loaded book from the host: its outline, segmented by the given
 * boundaries, and the pages of segments asked for. A new outline is published only with the pages
 * around the verse the view opens on, and around the segments each caller last asked for, already
 * loaded.
 */
export default function useSegmentPages({
  projectId,
  verseBook,
  segmentation,
  segmentationVersion,
  scrRef,
  onTextChanged,
}: Readonly<UseSegmentPagesArgs>): UseSegmentPagesResult {
  const segmentationJson = useMemo(
    () => (segmentation ? JSON.stringify(segmentation) : undefined),
    [segmentation],
  );
  const [published, setPublished] = useState<{ verseBook: Book; pages: SegmentPages }>();
  const [failure, setFailure] = useState<{ verseBook: Book; message: string }>();

  const segmentationVersionRef = useLatestRef(segmentationVersion);
  const scrRefRef = useLatestRef(scrRef);
  const onTextChangedRef = useLatestRef(onTextChanged);
  /** The range each caller last asked for, at the indexes of the outline it was asked of. */
  const lastRangesRef = useRef(
    new Map<PageCaller, { outline: BookOutline; start: number; end: number }>(),
  );

  useEffect(() => {
    if (!verseBook) return undefined;
    setFailure(undefined);
    let isCurrent = true;
    const bookId = verseBook.bookRef;
    const requestedVersion = segmentationVersionRef.current;
    const attempt = async (retry = 0): Promise<void> => {
      try {
        const json = await perfTrack(
          'outline-fetch',
          papi.commands.sendCommand(
            'interlinearizer.getBookOutline',
            projectId,
            bookId,
            segmentationJson,
          ),
        );
        if (!isCurrent) return;
        const outline: BookOutline | undefined =
          json && perfTime('outline-parse', () => JSON.parse(json), { bytes: json.length });
        if (outline?.textVersion !== verseBook.textVersion) {
          onTextChangedRef.current();
          return;
        }
        const count = outline.segments.length;
        const anchor = findAnchorIndex(outline.segments, scrRefRef.current);
        const reach = INITIAL_WINDOW_HALF + EXTEND_CHUNK;
        const pageIndexes = new Set(pagesCovering(anchor - reach, anchor + reach + 1, count));
        // A boundary edit moves the segments after it by at most one place, and a Scripture edit
        // seldom by more, so the range shown before either is about where it falls now.
        lastRangesRef.current.forEach((last) => {
          if (last.outline.bookRef === bookId)
            pagesCovering(last.start - 1, last.end + 1, count).forEach((p) => pageIndexes.add(p));
        });
        const source = { projectId, outline, segmentationJson };
        const loaded = await fetchPages(
          source,
          [...pageIndexes].sort((a, b) => a - b),
        );
        if (!isCurrent) return;
        if (!loaded) {
          onTextChangedRef.current();
          return;
        }
        const pages = createSegmentPages({
          ...source,
          segmentationVersion: requestedVersion,
          loaded,
          onTextChanged: () => onTextChangedRef.current(),
          onLoad: (start, end, caller) => {
            lastRangesRef.current.set(caller, { outline, start, end });
          },
          onRelease: (caller) => {
            lastRangesRef.current.delete(caller);
          },
        });
        setPublished({ verseBook, pages });
        setFailure(undefined);
      } catch (e) {
        if (!isCurrent) return;
        logger.warn(`Interlinearizer: could not load the outline of ${bookId}: ${e}`);
        const delay = PAGE_RETRY_DELAYS_MS[retry];
        if (delay === undefined) {
          setFailure({ verseBook, message: e instanceof Error ? e.message : String(e) });
          return;
        }
        await waitMs(delay);
        if (isCurrent) await attempt(retry + 1);
      }
    };
    attempt();
    return () => {
      isCurrent = false;
    };
  }, [projectId, verseBook, segmentationJson, segmentationVersionRef, scrRefRef, onTextChangedRef]);

  const isFailed = !!verseBook && failure?.verseBook === verseBook;
  return {
    pages: published?.pages,
    isLoading: !!verseBook && published?.verseBook !== verseBook && !isFailed,
    error: isFailed ? failure.message : undefined,
  };
}
