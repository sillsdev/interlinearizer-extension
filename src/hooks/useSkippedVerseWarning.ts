import papi, { logger } from '@papi/frontend';
import type { LocalizeKey } from 'platform-bible-utils';
import { useEffect, useRef } from 'react';

/** A reason that the extractor skips verse markers, with what the warning says about it. */
export type SkippedVerseKind = Readonly<{
  /** The notification shown to the user, naming no specific verse. */
  messageKey: LocalizeKey;
  /** Describes `count` skipped markers in the log line, e.g. `repeats 2 verse marker(s)`. */
  describe: (count: number) => string;
}>;

/** Verse markers skipped because an earlier marker already claimed their SID. */
export const DUPLICATE_VERSES: SkippedVerseKind = {
  messageKey: '%interlinearizer_warning_duplicateVerses%',
  describe: (count) => `repeats ${count} verse marker(s)`,
};

/** Verse markers skipped because their SID names no verse. */
export const INVALID_VERSES: SkippedVerseKind = {
  messageKey: '%interlinearizer_warning_invalidVerses%',
  describe: (count) => `has ${count} verse marker(s) that name no verse`,
};

/**
 * Warns, once per project, book and set of markers, when the loaded book has skipped verse markers
 * of `kind`. The view does not show those markers' text.
 */
export default function useSkippedVerseWarning(
  projectId: string,
  bookRef: string | undefined,
  skippedVerseIds: readonly string[] | undefined,
  kind: SkippedVerseKind,
): void {
  const warnedKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!skippedVerseIds || skippedVerseIds.length === 0) return;

    const bookKey = `${projectId}:${bookRef}:${skippedVerseIds.join(',')}`;
    if (warnedKeys.current.has(bookKey)) return;
    warnedKeys.current.add(bookKey);

    logger.warn(
      `Interlinearizer: book ${bookRef} in project ${projectId} ${kind.describe(skippedVerseIds.length)}; their text is not shown: ${skippedVerseIds.join(', ')}`,
    );
    papi.notifications
      .send({ message: kind.messageKey, severity: 'warning' })
      /* v8 ignore next -- a failed warning must not break the load that succeeded */
      .catch(() => {});
  }, [skippedVerseIds, projectId, bookRef, kind]);
}
