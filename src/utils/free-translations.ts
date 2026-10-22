import type { TextAnalysis } from 'interlinearizer';
import { isEmptyMultiString } from './multi-string';

/** Whether any segment analysis in `analysis` carries a free translation. */
export function analysisHasFreeTranslations(analysis: TextAnalysis): boolean {
  return analysis.segmentAnalyses.some((sa) => !isEmptyMultiString(sa.freeTranslation));
}
