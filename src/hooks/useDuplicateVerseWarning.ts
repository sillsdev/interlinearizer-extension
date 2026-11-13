import papi, { logger } from '@papi/frontend';
import { useEffect, useRef } from 'react';
import type { SegmentPages } from '../types/segment-pages';

/**
 * Warns, once per project, book and set of repeats, when the loaded book repeats verse markers,
 * whose repeated text the view does not show.
 */
export default function useDuplicateVerseWarning(
  projectId: string,
  pages: Pick<SegmentPages, 'bookRef' | 'duplicateVerseIds'> | undefined,
): void {
  const warnedForBookRef = useRef<string | undefined>(undefined);
  const bookRef = pages?.bookRef;
  const duplicateVerseIds = pages?.duplicateVerseIds;
  useEffect(() => {
    if (!duplicateVerseIds || duplicateVerseIds.length === 0) return;

    const bookKey = `${projectId}:${bookRef}:${duplicateVerseIds.join(',')}`;
    if (warnedForBookRef.current === bookKey) return;
    warnedForBookRef.current = bookKey;

    logger.warn(
      `Interlinearizer: book ${bookRef} in project ${projectId} repeats ${duplicateVerseIds.length} verse marker(s); their text is not shown: ${duplicateVerseIds.join(', ')}`,
    );
    papi.notifications
      .send({ message: '%interlinearizer_warning_duplicateVerses%', severity: 'warning' })
      /* v8 ignore next -- a failed warning must not break the load that succeeded */
      .catch(() => {});
  }, [duplicateVerseIds, projectId, bookRef]);
}
