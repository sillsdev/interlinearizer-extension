import { Canon } from '@sillsdev/scripture';
import type { TextAnalysis } from 'interlinearizer';
import { booksLinkedIn } from './analysis-book';

/** The analysis-derived facts a project list shows about a project. */
export type ProjectAnalysisSummary = {
  /** Book codes the analysis links reference, in canonical order. */
  books: string[];
  /** Counts stored token, phrase and segment payloads, including any that no link references. */
  analysisCount: number;
};

/** Summarizes an analysis down to what a project row displays about it. */
export function summarizeAnalysis(analysis: TextAnalysis): ProjectAnalysisSummary {
  return {
    books: [...booksLinkedIn(analysis)].sort(
      (a, b) => Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b),
    ),
    analysisCount:
      analysis.tokenAnalyses.length +
      analysis.phraseAnalyses.length +
      analysis.segmentAnalyses.length,
  };
}
