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
 */
function backfillRecord(record: PartiallyStamped, fallback: string): void {
  record.createdAt ??= fallback;
  record.updatedAt ??= fallback;
}

/**
 * Fills in the analysis timestamps absent from data written before analyses carried them, so every
 * consumer can read `createdAt` / `updatedAt` unconditionally instead of handling a gap that only
 * legacy records have. Mutates `analysis` in place; the filled-in values persist on the next save.
 * Stamps anything missing with the supplied ISO 8601 fallback, which bounds a legacy record's age
 * rather than measuring it — no better estimate survives in storage.
 */
export function backfillAnalysisTimestamps(analysis: TextAnalysis, fallback: string): void {
  analysis.segmentAnalyses.forEach((r) => backfillRecord(r, fallback));
  analysis.segmentAnalysisLinks.forEach((r) => backfillRecord(r, fallback));
  analysis.tokenAnalyses.forEach((r) => backfillRecord(r, fallback));
  analysis.tokenAnalysisLinks.forEach((r) => backfillRecord(r, fallback));
  analysis.phraseAnalyses.forEach((r) => backfillRecord(r, fallback));
  analysis.phraseAnalysisLinks.forEach((r) => backfillRecord(r, fallback));
}
