import type { MergedContent, MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';
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

/**
 * Carries the glosses outside `lang` off the donors onto the survivor, which keeps its own wherever
 * it has them, and settles the sense the survivor's gloss resolves through.
 *
 * @param survivor Mutated in place.
 * @param donors The records being dropped, most-preferred first.
 * @param lang BCP 47 tag the merge was conducted in, the one gloss this leaves alone.
 * @param glossFrom The analysis the settled gloss came from, whose sense the survivor takes;
 *   `undefined` for a gloss answering to no record, which leaves the survivor without one.
 */
export function carryOverUnsettledContent(
  survivor: TokenAnalysis,
  donors: readonly TokenAnalysis[],
  lang: string,
  glossFrom: TokenAnalysis | undefined,
): void {
  survivor.glossSenseRef = glossFrom?.glossSenseRef;

  donors.forEach((donor) => {
    Object.entries(donor.gloss ?? {}).forEach(([tag, gloss]) => {
      if (tag === lang) return;
      if (!survivor.gloss) survivor.gloss = {};
      if (survivor.gloss[tag] === undefined) survivor.gloss[tag] = gloss;
    });
  });
}

/**
 * Copies a merged morpheme, leaving it unglossed in `lang` where the gloss holds nothing that
 * renders — analysis identity must not see a difference the reader cannot.
 */
function copyMergedMorpheme(morpheme: MorphemeAnalysis, lang: string): MorphemeAnalysis {
  const copy = { ...morpheme };
  const gloss = copy.gloss?.[lang];
  if (gloss !== undefined && gloss.trim() === '') {
    copy.gloss = { ...copy.gloss };
    delete copy.gloss[lang];
    if (Object.keys(copy.gloss).length === 0) delete copy.gloss;
  }
  return copy;
}

/** Writes merged content onto an analysis, clearing each field the merge settled on nothing for. */
export function applyMergedContent(
  analysis: TokenAnalysis,
  content: MergedContent,
  lang: string,
): void {
  if (content.gloss.trim() === '') {
    if (analysis.gloss) {
      delete analysis.gloss[lang];
      if (Object.keys(analysis.gloss).length === 0) delete analysis.gloss;
    }
  } else {
    if (!analysis.gloss) analysis.gloss = {};
    analysis.gloss[lang] = content.gloss;
  }

  if (content.morphemes.length === 0) delete analysis.morphemes;
  else analysis.morphemes = content.morphemes.map((m) => copyMergedMorpheme(m, lang));

  if (content.morphemesStale) analysis.morphemesStale = true;
  else delete analysis.morphemesStale;

  if (content.pos === undefined) delete analysis.pos;
  else analysis.pos = content.pos;

  if (content.features === undefined) delete analysis.features;
  else analysis.features = { ...content.features };

  if (content.confidence === undefined) delete analysis.confidence;
  else analysis.confidence = content.confidence;
}
