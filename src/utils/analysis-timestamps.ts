import type { TextAnalysis } from 'interlinearizer';

/**
 * An analysis record or link as storage may actually hold it. The domain types declare both
 * timestamps as required, which legacy records do not satisfy; this optional view is what lets the
 * gap be found and filled.
 */
type PartiallyStamped = { createdAt?: string; updatedAt?: string };

/**
 * Stamps the timestamps onto one record that predates them. A record already carrying a value keeps
 * it, so re-reading a project never replaces a real time with the stand-in.
 *
 * @returns Whether either timestamp was absent and has been filled in.
 */
function backfillRecord(record: PartiallyStamped, fallback: string): boolean {
  const filled = record.createdAt === undefined || record.updatedAt === undefined;
  record.createdAt ??= fallback;
  record.updatedAt ??= fallback;
  return filled;
}

/**
 * Fills in the analysis timestamps absent from data written before analyses carried them, so every
 * consumer can read `createdAt` / `updatedAt` unconditionally instead of handling a gap that only
 * legacy records have. Mutates `analysis` in place. Stamps anything missing with the supplied ISO
 * 8601 fallback, which bounds a legacy record's age rather than measuring it — no better estimate
 * survives in storage.
 *
 * @returns Whether any record was missing a timestamp and has been stamped.
 */
export function backfillAnalysisTimestamps(analysis: TextAnalysis, fallback: string): boolean {
  let filled = false;
  const stampAll = (records: PartiallyStamped[]) => {
    records.forEach((r) => {
      if (backfillRecord(r, fallback)) filled = true;
    });
  };
  stampAll(analysis.segmentAnalyses);
  stampAll(analysis.segmentAnalysisLinks);
  stampAll(analysis.tokenAnalyses);
  stampAll(analysis.tokenAnalysisLinks);
  stampAll(analysis.phraseAnalyses);
  stampAll(analysis.phraseAnalysisLinks);
  return filled;
}
