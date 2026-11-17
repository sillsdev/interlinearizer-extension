import papi, { logger } from '@papi/frontend';
import { useEffect, useRef } from 'react';
import type { SegmentPages } from '../types/segment-pages';

/**
 * Warns, once per project, book and set of markers, when the loaded book has verse markers that
 * name no verse, whose text the view does not show.
 */
export default function useInvalidVerseWarning(
  projectId: string,
  pages: Pick<SegmentPages, 'bookRef' | 'invalidVerseIds'> | undefined,
): void {
  const warnedForBookRef = useRef<string | undefined>(undefined);
  const bookRef = pages?.bookRef;
  const invalidVerseIds = pages?.invalidVerseIds;
  useEffect(() => {
    if (!invalidVerseIds || invalidVerseIds.length === 0) return;

    const bookKey = `${projectId}:${bookRef}:${invalidVerseIds.join(',')}`;
    if (warnedForBookRef.current === bookKey) return;
    warnedForBookRef.current = bookKey;

    logger.warn(
      `Interlinearizer: book ${bookRef} in project ${projectId} has ${invalidVerseIds.length} verse marker(s) that name no verse; their text is not shown: ${invalidVerseIds.join(', ')}`,
    );
    papi.notifications
      .send({ message: '%interlinearizer_warning_invalidVerses%', severity: 'warning' })
      /* v8 ignore next -- a failed warning must not break the load that succeeded */
      .catch(() => {});
  }, [invalidVerseIds, projectId, bookRef]);
}
