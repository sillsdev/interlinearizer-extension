/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import usePageIndexes from '../../hooks/usePageIndexes';
import type { SegmentPage, SegmentPages } from '../../types/segment-pages';
import { segmentPagesOf } from '../test-helpers';
import { BOOK, ref } from '../cache/session-source';

/** Pages of {@link BOOK} holding the first `count` segments, which `hold` widens. */
function pagesHolding(count: number) {
  let held = count;
  let version = 0;
  const listeners = new Set<() => void>();
  let snapshot: readonly SegmentPage[] = [];
  let snapshotVersion = -1;
  const pages: SegmentPages = {
    ...segmentPagesOf(BOOK),
    heldRuns: () => {
      if (snapshotVersion !== version) {
        snapshot = [
          { textVersion: BOOK.textVersion, start: 0, segments: BOOK.segments.slice(0, held) },
        ];
        snapshotVersion = version;
      }
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadedVersion: () => version,
  };
  const hold = (next: number) => {
    held = next;
    version += 1;
    listeners.forEach((listener) => listener());
  };
  return { pages, hold };
}

describe('usePageIndexes', () => {
  it('indexes the tokens of the pages loaded', () => {
    const { pages } = pagesHolding(1);

    const { result } = renderHook(() => usePageIndexes(pages));

    expect(result.current.tokenSegmentMap.get(ref('In'))).toBe('GEN 1:1');
    expect(result.current.tokenSegmentMap.has(ref('earth'))).toBe(false);
    expect(result.current.outlineSegmentById.has('GEN 1:3')).toBe(true);
  });

  it('indexes again as more pages load', () => {
    const { pages, hold } = pagesHolding(1);
    const { result } = renderHook(() => usePageIndexes(pages));

    act(() => hold(2));

    expect(result.current.tokenSegmentMap.get(ref('earth'))).toBe('GEN 1:2');
  });

  it('keeps the same indexes while nothing loads', () => {
    const { pages } = pagesHolding(1);
    const { result, rerender } = renderHook(() => usePageIndexes(pages));
    const before = result.current;

    rerender();

    expect(result.current).toBe(before);
  });
});
