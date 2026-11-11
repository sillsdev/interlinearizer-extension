import { useEffect, useMemo, useRef } from 'react';
import { useStaleSummary } from '../cache/catalogHooks';

/** The stale analyses a loaded book holds, each named by a key that holds while it stays stale. */
export type StaleAnalysesReport = Readonly<{
  bookRef: string;
  /** A key per place in the book an analysis went stale at. */
  glosses: readonly string[];
  /**
   * A key per stale free translation the book shows, with the segment showing it or, for one whose
   * verse is gone, the segment it is shown beside, in document order.
   */
  freeTranslations: readonly Readonly<{ key: string; segmentId: string }>[];
}>;

function sameReport(a: StaleAnalysesReport | undefined, b: StaleAnalysesReport): boolean {
  return (
    a !== undefined &&
    a.bookRef === b.bookRef &&
    a.glosses.length === b.glosses.length &&
    a.glosses.every((key, i) => key === b.glosses[i]) &&
    a.freeTranslations.length === b.freeTranslations.length &&
    a.freeTranslations.every(
      ({ key, segmentId }, i) =>
        key === b.freeTranslations[i].key && segmentId === b.freeTranslations[i].segmentId,
    )
  );
}

/**
 * Reports the stale analyses that the session's draft holds in book `bookRef` to a surface outside
 * the analysis store: once the host's summary arrives, on each change, and as `undefined` on
 * unmount. Renders nothing.
 */
export default function StaleAnalysesReporter({
  bookRef,
  onReport,
}: Readonly<{
  bookRef: string;
  onReport: (report: StaleAnalysesReport | undefined) => void;
}>) {
  const summary = useStaleSummary(bookRef);

  const report = useMemo<StaleAnalysesReport | undefined>(
    () =>
      summary && {
        bookRef,
        glosses: summary.glosses.map(
          ({ analysisId, tokenRef }) => `gloss ${analysisId} ${tokenRef}`,
        ),
        freeTranslations: summary.freeTranslations.map(({ analysisId, segmentId }) => ({
          key: `freeTranslation ${analysisId}`,
          segmentId,
        })),
      },
    [bookRef, summary],
  );

  // Every change that names the summary fetches it again. Reporting an unchanged answer would
  // re-render the receiving surface for nothing.
  const reportedRef = useRef<StaleAnalysesReport | undefined>(undefined);
  useEffect(() => {
    if (!report || sameReport(reportedRef.current, report)) return;
    reportedRef.current = report;
    onReport(report);
  }, [report, onReport]);
  useEffect(
    () => () => {
      reportedRef.current = undefined;
      onReport(undefined);
    },
    [onReport],
  );

  return undefined;
}
