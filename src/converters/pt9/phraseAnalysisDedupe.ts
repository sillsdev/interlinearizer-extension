import type { PhraseAnalysis, PhraseAnalysisLink, TextAnalysis } from 'interlinearizer';
import { normalizeSurfaceForm, phraseAnalysesAreIdentical } from '../../utils/analysis-identity';
import type { Pt9ImportReport } from './report';

type PhraseAnalysisLayer = Pick<TextAnalysis, 'phraseAnalyses' | 'phraseAnalysisLinks'>;

/**
 * Folds content-identical phrase analyses onto one shared payload, as glossing them by hand would
 * have stored them, counting each fold and each dropped link on `report`. The first of each
 * identical set survives. Every link to the rest moves onto it, keeping its own token snapshots. A
 * token run left holding two links to the survivor keeps one: the approved link if either is, a
 * rejected one only if both are, otherwise the earlier.
 */
export function dedupePhraseAnalyses(
  layer: PhraseAnalysisLayer,
  report: Pt9ImportReport,
): PhraseAnalysisLayer {
  const survivorsBySurface = new Map<string, PhraseAnalysis[]>();
  const survivorIdById = new Map<string, string>();
  const phraseAnalyses = layer.phraseAnalyses.filter((analysis) => {
    const surface = normalizeSurfaceForm(analysis.surfaceText);
    const bucket = survivorsBySurface.get(surface);
    const survivor = bucket?.find((kept) => phraseAnalysesAreIdentical(kept, analysis));
    if (survivor !== undefined) {
      survivorIdById.set(analysis.id, survivor.id);
      report.merge.identicalPhrasePayloadsMerged += 1;
      return false;
    }
    if (bucket === undefined) survivorsBySurface.set(surface, [analysis]);
    else bucket.push(analysis);
    return true;
  });

  const phraseAnalysisLinks: PhraseAnalysisLink[] = [];
  const indexByRunAndAnalysis = new Map<string, number>();
  layer.phraseAnalysisLinks.forEach((link) => {
    const analysisId = survivorIdById.get(link.analysisId) ?? link.analysisId;
    const repointed = analysisId === link.analysisId ? link : { ...link, analysisId };
    // Token refs contain spaces, so the joiner must be a character no ref can carry.
    const key = [...link.tokens.map((token) => token.tokenRef), analysisId].join('\n');
    const heldAt = indexByRunAndAnalysis.get(key);
    if (heldAt === undefined) {
      indexByRunAndAnalysis.set(key, phraseAnalysisLinks.length);
      phraseAnalysisLinks.push(repointed);
      return;
    }
    report.merge.duplicatePhraseLinksDropped += 1;
    if (
      repointed.status === 'approved' ||
      (phraseAnalysisLinks[heldAt].status === 'rejected' && repointed.status !== 'rejected')
    )
      phraseAnalysisLinks[heldAt] = repointed;
  });

  return { phraseAnalyses, phraseAnalysisLinks };
}
