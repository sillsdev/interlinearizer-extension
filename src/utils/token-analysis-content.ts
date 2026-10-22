import type { TokenAnalysis } from 'interlinearizer';
import { isEmptyMultiString } from './multi-string';

/**
 * Determines whether a `TokenAnalysis` carries no analysis content, so an edit that just emptied
 * one field can drop the whole record instead of letting empty records accumulate in storage.
 * Checks every content field of the type — `gloss`, `morphemes`, `pos`, `features`, and
 * `glossSenseRef` — not only the field the caller emptied, so records carrying imported
 * morphosyntactic or lexicon data are never discarded by an unrelated edit. A gloss counts as empty
 * when it has no entries or every entry is blank, so a record left holding only whitespace glosses
 * (junk from clearing a gloss field) is treated the same as one with no gloss at all.
 *
 * Provenance fields (`confidence`, `producer`, `sourceUser`) are intentionally NOT treated as
 * content: they describe who/what produced an analysis, not an analysis worth keeping on their own.
 * A record holding only provenance and no glosses/morphemes/pos/features is therefore considered
 * empty and may be dropped when its last content field is cleared. This is a deliberate choice — if
 * a future workflow needs provenance-only records (e.g. imported parser metadata) to survive a
 * gloss clear, add the relevant fields to the check below.
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
 * Empties one language's gloss, dropping the gloss and the analysis-wide `glossSenseRef` once no
 * language is left holding usable text — a sibling left holding only whitespace counts for neither,
 * so the sense is never stranded on a gloss nothing renders.
 */
export function clearAnalysisGloss(analysis: TokenAnalysis, lang: string): void {
  if (analysis.gloss) {
    delete analysis.gloss[lang];
    if (isEmptyMultiString(analysis.gloss)) delete analysis.gloss;
  }
  if (!analysis.gloss) delete analysis.glossSenseRef;
}
