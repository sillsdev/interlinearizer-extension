import type { TokenAnalysis } from 'interlinearizer';
import { isEmptyMultiString } from './multi-string';

/**
 * Whether `analysis` holds no analysis content, so that an edit can drop the record rather than
 * store an empty one. A gloss with only blank entries counts as empty. Provenance isn't content.
 */
export function isEmptyTokenAnalysis(analysis: TokenAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.gloss) &&
    /* v8 ignore next -- the length===0 sub-branch needs an empty-but-defined morphemes array, which no caller produces */
    (!analysis.morphemes || analysis.morphemes.length === 0) &&
    analysis.pos === undefined &&
    analysis.features === undefined &&
    analysis.glossSenseRef === undefined
  );
}

/**
 * Empties `lang`'s gloss, dropping `gloss` once no language holds non-blank text. The lexicon link
 * in `glossSenseRef` stays: clearing a gloss edits the free-form text, not the link.
 */
export function clearAnalysisGloss(analysis: TokenAnalysis, lang: string): void {
  if (!analysis.gloss) return;
  delete analysis.gloss[lang];
  if (isEmptyMultiString(analysis.gloss)) delete analysis.gloss;
}
