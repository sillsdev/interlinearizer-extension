import type { TextAnalysis } from 'interlinearizer';

/**
 * Where a catalog row's edit left the record it was aimed at.
 *
 * A write that makes a row content-identical to a sibling collapses the two. The edited row then
 * leaves the listing, and the sibling's usage count grows by that row's tokens. Unreported, a
 * collapse reads as data loss.
 */
export type AnalysisEditOutcome =
  | {
      /** The ordinary case: the record survived the edit under its own id. */
      kind: 'edited';
    }
  | {
      /** The record collapsed onto a content-identical sibling and no longer exists. */
      kind: 'merged';
      /** The surviving record's id, which the listing should now point the reader at. */
      survivingAnalysisId: string;
      /** The survivor's gloss in the active analysis language, or `''` when it has none. */
      survivingGloss: string;
      /** The survivor's usage count once the collapsed record's tokens joined it. */
      survivingUsageCount: number;
    }
  | {
      /** The edit emptied the record, removing it and every link to it. */
      kind: 'removed';
    };

/**
 * Reports where an edit left the record that `analysisId` names, so a row that vanishes can be
 * explained rather than read as lost work. Only the survivor that the write recorded tells a
 * collapse from a removal; the state they leave is the same.
 */
export function readEditOutcome(
  after: TextAnalysis,
  survivingAnalysisId: string | undefined,
  analysisId: string,
  analysisLanguage: string,
): AnalysisEditOutcome {
  if (after.tokenAnalyses.some((ta) => ta.id === analysisId)) return { kind: 'edited' };
  if (survivingAnalysisId === undefined) return { kind: 'removed' };

  const survivingAnalysis = after.tokenAnalyses.find((ta) => ta.id === survivingAnalysisId);
  return {
    kind: 'merged',
    survivingAnalysisId,
    /* v8 ignore next -- the survivor was just written into the state this reads */
    survivingGloss: survivingAnalysis?.gloss?.[analysisLanguage] ?? '',
    survivingUsageCount: new Set(
      after.tokenAnalysisLinks
        .filter((l) => l.analysisId === survivingAnalysisId && l.status === 'approved')
        .map((l) => l.token.tokenRef),
    ).size,
  };
}
