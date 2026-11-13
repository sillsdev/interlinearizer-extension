import { useMemo, useSyncExternalStore } from 'react';
import type { SegmentPages } from '../types/segment-pages';
import { buildPageIndexes, type PageIndexes } from '../utils/page-indexes';

/**
 * The lookups that the view reads tokens and segments through, built from the pages loaded and
 * built again whenever more load.
 */
export default function usePageIndexes(pages: SegmentPages): PageIndexes {
  const held = useSyncExternalStore(pages.subscribe, pages.heldPages);
  return useMemo(() => buildPageIndexes(pages.outline, held), [pages.outline, held]);
}
