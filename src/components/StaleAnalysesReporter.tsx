import type { Book } from 'interlinearizer';
import { useEffect, useMemo, useRef } from 'react';
import { bookOfRef } from '../utils/analysis-book';
import { usePlacedStaleFreeTranslations, useStaleTokenLinks } from './AnalysisStore';

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
 * Reports the stale analyses `book` holds to a surface outside the analysis store — on mount, on
 * each change, and as `undefined` on unmount. Renders nothing.
 */
export default function StaleAnalysesReporter({
  book,
  onReport,
}: Readonly<{
  book: Book;
  onReport: (report: StaleAnalysesReport | undefined) => void;
}>) {
  const staleTokenLinks = useStaleTokenLinks();
  const placedFreeTranslations = usePlacedStaleFreeTranslations(book);

  const report = useMemo<StaleAnalysesReport>(
    () => ({
      bookRef: book.bookRef,
      glosses: [
        ...new Set(
          staleTokenLinks
            .filter((link) => bookOfRef(link.token.tokenRef) === book.bookRef)
            .map((link) => `gloss ${link.analysisId} ${link.token.tokenRef}`),
        ),
      ],
      freeTranslations: book.segments.flatMap(({ id: segmentId }, index) => {
        const { bySegment, orphanedAfter, orphanedAhead } = placedFreeTranslations;
        return [
          ...(index === 0 ? orphanedAhead : []),
          ...(bySegment.get(segmentId) ?? []),
          ...(orphanedAfter.get(segmentId) ?? []),
        ].map((t) => ({ key: `freeTranslation ${t.analysisId}`, segmentId }));
      }),
    }),
    [book.bookRef, book.segments, staleTokenLinks, placedFreeTranslations],
  );

  // Every analysis edit rebuilds the stale links, and reporting each rebuild would re-render the
  // receiving surface for edits that staled nothing.
  const reportedRef = useRef<StaleAnalysesReport | undefined>(undefined);
  useEffect(() => {
    if (sameReport(reportedRef.current, report)) return;
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
