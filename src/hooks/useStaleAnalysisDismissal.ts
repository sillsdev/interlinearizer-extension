import type { UseWebViewStateHook } from '@papi/core';
import { useMemo } from 'react';
import type { StaleAnalysesReport } from '../components/StaleAnalysesReporter';
import useRecordDismissal from './useRecordDismissal';

type StaleAnalysisDismissalOptions = {
  /** The loaded book's stale analyses, `undefined` while no book's are known. */
  report: StaleAnalysesReport | undefined;
  /** Bumped by every wholesale draft replacement (New / Open / Wipe). */
  draftVersion: number;
  /** Scopes the dismissal to one tab. */
  useWebViewState: UseWebViewStateHook;
};

type StaleAnalysisDismissal = {
  /** How many of the book's stale gloss places the user has not dismissed the notice for. */
  glossCount: number;
  /** How many of the book's stale free translations the user has not dismissed the notice for. */
  freeTranslationCount: number;
  /** The segments showing those free translations, in document order. */
  freeTranslationSegmentIds: readonly string[];
  /** Dismisses the notice for exactly the stale analyses it is currently reporting. */
  onDismiss: () => void;
};

const NO_RECORDS: readonly string[] = [];

/**
 * Tracks which of the loaded book's stale analyses the user has dismissed the notice for, an
 * analysis that stops being stale dropping out of the dismissal.
 */
export default function useStaleAnalysisDismissal({
  report,
  draftVersion,
  useWebViewState,
}: StaleAnalysisDismissalOptions): StaleAnalysisDismissal {
  const records = useMemo(
    () =>
      report
        ? [...report.glosses, ...report.freeTranslations.map((translation) => translation.key)]
        : NO_RECORDS,
    [report],
  );

  const { undismissed, onDismiss } = useRecordDismissal({
    records,
    observedBookRef: report?.bookRef,
    draftVersion,
    stateKey: 'dismissedStaleAnalyses',
    useWebViewState,
  });

  return useMemo(() => {
    const raised = new Set(undismissed);
    const freeTranslations = (report?.freeTranslations ?? []).filter(({ key }) => raised.has(key));
    return {
      glossCount: (report?.glosses ?? []).filter((key) => raised.has(key)).length,
      freeTranslationCount: freeTranslations.length,
      freeTranslationSegmentIds: [...new Set(freeTranslations.map(({ segmentId }) => segmentId))],
      onDismiss,
    };
  }, [report, undismissed, onDismiss]);
}
