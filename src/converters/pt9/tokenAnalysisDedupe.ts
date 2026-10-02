import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { analysesAreIdentical, normalizeSurfaceForm } from '../../utils/analysis-identity';
import type { Pt9ImportReport } from './report';

type TokenAnalysisLayer = Pick<TextAnalysis, 'tokenAnalyses' | 'tokenAnalysisLinks'>;

/**
 * Folds content-identical token analyses onto one shared payload, as glossing them by hand would
 * have stored them, counting each fold on `report`. The first of each identical set survives and
 * every link to the rest moves onto it, keeping its own token snapshot. A token left holding two
 * links to the survivor keeps one: the approved link if either is, otherwise the earlier.
 */
export function dedupeTokenAnalyses(
  layer: TokenAnalysisLayer,
  report: Pt9ImportReport,
): TokenAnalysisLayer {
  const survivorsBySurface = new Map<string, TokenAnalysis[]>();
  const survivorIdById = new Map<string, string>();
  const tokenAnalyses = layer.tokenAnalyses.filter((analysis) => {
    const surface = normalizeSurfaceForm(analysis.surfaceText);
    const bucket = survivorsBySurface.get(surface);
    const survivor = bucket?.find((kept) => analysesAreIdentical(kept, analysis));
    if (survivor !== undefined) {
      survivorIdById.set(analysis.id, survivor.id);
      report.merge.identicalPayloadsMerged += 1;
      return false;
    }
    if (bucket === undefined) survivorsBySurface.set(surface, [analysis]);
    else bucket.push(analysis);
    return true;
  });

  const tokenAnalysisLinks: TokenAnalysisLink[] = [];
  const indexByTokenAndAnalysis = new Map<string, number>();
  layer.tokenAnalysisLinks.forEach((link) => {
    const analysisId = survivorIdById.get(link.analysisId) ?? link.analysisId;
    const repointed = analysisId === link.analysisId ? link : { ...link, analysisId };
    // Token refs contain spaces, so the joiner must be a character no ref can carry.
    const key = `${link.token.tokenRef}\n${analysisId}`;
    const heldAt = indexByTokenAndAnalysis.get(key);
    if (heldAt === undefined) {
      indexByTokenAndAnalysis.set(key, tokenAnalysisLinks.length);
      tokenAnalysisLinks.push(repointed);
    } else if (repointed.status === 'approved') tokenAnalysisLinks[heldAt] = repointed;
  });

  return { tokenAnalyses, tokenAnalysisLinks };
}
