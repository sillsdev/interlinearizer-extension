import { Canon } from '@sillsdev/scripture';
import type { TextAnalysis } from 'interlinearizer';
import { bookOfRef } from './analysis-book';

/** The analysis-derived facts a project list shows about a project. */
export type ProjectAnalysisSummary = {
  /** Book codes the token analyses reference, in canonical order. */
  books: string[];
  /** Counts stored payloads, including any that no link references. */
  tokenAnalysisCount: number;
};

/** Summarizes an analysis down to what a project row displays about it. */
export function summarizeAnalysis(analysis: TextAnalysis): ProjectAnalysisSummary {
  const books = new Set(analysis.tokenAnalysisLinks.map((link) => bookOfRef(link.token.tokenRef)));
  return {
    books: [...books].sort((a, b) => Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b)),
    tokenAnalysisCount: analysis.tokenAnalyses.length,
  };
}
