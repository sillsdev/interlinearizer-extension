import type { PhraseAnalysisLink } from 'interlinearizer';
import { useMemo } from 'react';

/**
 * Derives the set of phrase ids whose token membership overlaps `candidateTokenRefs`. Used by both
 * SegmentView and ContinuousView to highlight arcs for discontiguous phrases when a link icon is
 * hovered — `hoveredPhraseId` alone only fires when a phrase box is directly hovered, so a separate
 * lookup is needed for the arc-highlight path.
 *
 * Returns an empty set when `candidateTokenRefs` is empty so the caller can avoid extra branching.
 *
 * @param candidateTokenRefs - Token refs currently flagged as a link/unlink hover candidate.
 * @param phraseLinkByRef - Map from token ref to the phrase link containing it.
 * @returns The phrase ids whose token list intersects `candidateTokenRefs`.
 */
export function useCandidatePhraseIds(
  candidateTokenRefs: ReadonlySet<string>,
  phraseLinkByRef: ReadonlyMap<string, PhraseAnalysisLink>,
): ReadonlySet<string> {
  return useMemo<ReadonlySet<string>>(() => {
    if (candidateTokenRefs.size === 0) return new Set();
    const ids = new Set<string>();
    phraseLinkByRef.forEach((link) => {
      if (link.tokens.some((t) => candidateTokenRefs.has(t.tokenRef))) ids.add(link.analysisId);
    });
    return ids;
  }, [candidateTokenRefs, phraseLinkByRef]);
}
