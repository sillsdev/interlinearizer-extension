import type { Segment } from 'interlinearizer';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadedRun, stripTarget } from '../utils/strip-range';
import type { SegmentPages } from './useSegmentPages';
import useLatestRef from './useLatestRef';

/** Segments asked for past each end of the strip's target, so a page loads before it is reached. */
export const STRIP_PREFETCH_SEGMENTS = 8;

/** The caller the strip's page ranges are recorded under. */
const PAGE_CALLER = 'strip';

/** Arguments for {@link useStripSegments}. */
export interface UseStripSegmentsArgs {
  pages: SegmentPages;
  /**
   * The focus the strip shows; its segment is always held once loaded. One not in the book, as
   * across a book change, gives way to {@link UseStripSegmentsArgs.nextFocusTokenRef}.
   */
  focusTokenRef: string | undefined;
  /** The focus the strip is moving to, whose pages load while the strip fades out. */
  nextFocusTokenRef: string | undefined;
  /** Maps every token ref to the id of the segment that contains it. */
  tokenSegmentMap: ReadonlyMap<string, string>;
}

/** Return value of {@link useStripSegments}. */
export interface UseStripSegmentsResult {
  /** The loaded run of segments the strip holds, in book order. */
  segments: readonly Segment[];
  /** Whether the segment holding `tokenRef` has loaded. */
  hasPage: (tokenRef: string) => boolean;
  /** Names the first and last tokens the strip has mounted, which the held segments follow. */
  setMounted: (firstTokenRef: string, lastTokenRef: string) => void;
}

/** The mounted edge tokens, and the focus they were mounted around. */
type Mounted = Readonly<{ first: string; last: string; focus: string | undefined }>;

/** Segments the strip last held, and the pages they came from. */
type Held = Readonly<{ pages: SegmentPages; segments: readonly Segment[] }>;

/**
 * Holds the continuous strip's own run of segments: the ones under its mounted groups and its
 * focus, with a margin each side, as far as their pages have loaded. Asks for the pages they and
 * the focus being moved to need.
 *
 * A focus that moves clear of what is mounted drops the mounted edges, since the strip remounts
 * around it.
 */
export default function useStripSegments({
  pages,
  focusTokenRef,
  nextFocusTokenRef,
  tokenSegmentMap,
}: Readonly<UseStripSegmentsArgs>): UseStripSegmentsResult {
  useSyncExternalStore(pages.subscribe, pages.loadedVersion);

  const indexById = useMemo(
    () => new Map(pages.outline.map((segment, index) => [segment.id, index])),
    [pages.outline],
  );

  const [mounted, setMountedState] = useState<Mounted>();
  const [held, setHeld] = useState<Held>();

  // A boundary edit reaches tokenSegmentMap before the outline it gives does, so the segments
  // already held place their own tokens.
  const heldIndexByTokenRef = useMemo(() => {
    const byRef = new Map<string, number>();
    if (held?.pages !== pages) return byRef;
    held.segments.forEach((segment) => {
      const index = indexById.get(segment.id);
      /* v8 ignore next -- held segments come from this outline */
      if (index === undefined) return;
      segment.tokens.forEach((token) => byRef.set(token.ref, index));
    });
    return byRef;
  }, [held, pages, indexById]);

  const indexOf = useCallback(
    (tokenRef: string | undefined): number | undefined => {
      if (tokenRef === undefined) return undefined;
      const id = tokenSegmentMap.get(tokenRef);
      return (
        heldIndexByTokenRef.get(tokenRef) ?? (id === undefined ? undefined : indexById.get(id))
      );
    },
    [heldIndexByTokenRef, tokenSegmentMap, indexById],
  );

  const focusIndex = indexOf(focusTokenRef) ?? indexOf(nextFocusTokenRef);
  const anchors = focusIndex === undefined ? [] : [focusIndex];
  const mountedFirst = indexOf(mounted?.first);
  const mountedLast = indexOf(mounted?.last);
  if (mountedFirst !== undefined && mountedLast !== undefined) {
    const isAroundFocus =
      mounted?.focus === focusTokenRef ||
      (focusIndex !== undefined && focusIndex >= mountedFirst && focusIndex <= mountedLast);
    if (isAroundFocus) anchors.push(mountedFirst, mountedLast);
  }
  if (anchors.length === 0) anchors.push(0);
  const target = stripTarget(pages.outline, Math.min(...anchors), Math.max(...anchors));
  const run = loadedRun(
    (index) => pages.segmentAt(index) !== undefined,
    focusIndex ?? anchors[0],
    target,
  );

  const segments = useMemo(
    () =>
      Array.from({ length: run.end - run.start }, (_unused, i) => run.start + i).flatMap(
        (index) => {
          const segment = pages.segmentAt(index);
          /* v8 ignore next -- the run holds only loaded segments */
          return segment ? [segment] : [];
        },
      ),
    [pages, run.start, run.end],
  );
  if (held?.segments !== segments) setHeld({ pages, segments });

  useEffect(
    () =>
      pages.load(
        target.start - STRIP_PREFETCH_SEGMENTS,
        target.end + STRIP_PREFETCH_SEGMENTS,
        PAGE_CALLER,
      ),
    [pages, target.start, target.end],
  );

  const nextIndex = indexOf(nextFocusTokenRef);
  const isNextHeld = nextIndex !== undefined && nextIndex >= run.start && nextIndex < run.end;
  useEffect(() => {
    if (nextIndex === undefined || isNextHeld) return;
    const next = stripTarget(pages.outline, nextIndex, nextIndex);
    pages.load(
      next.start - STRIP_PREFETCH_SEGMENTS,
      next.end + STRIP_PREFETCH_SEGMENTS,
      PAGE_CALLER,
    );
  }, [pages, nextIndex, isNextHeld]);

  const hasPage = useCallback(
    (tokenRef: string) => {
      const index = indexOf(tokenRef);
      return index !== undefined && pages.segmentAt(index) !== undefined;
    },
    [indexOf, pages],
  );

  const focusRef = useLatestRef(focusTokenRef);
  const setMounted = useCallback(
    (first: string, last: string) =>
      setMountedState((prev) =>
        prev?.first === first && prev.last === last && prev.focus === focusRef.current
          ? prev
          : { first, last, focus: focusRef.current },
      ),
    [focusRef],
  );

  return { segments, hasPage, setMounted };
}
