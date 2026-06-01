import { useCallback } from 'react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import { usePhraseDispatch } from '../components/AnalysisStore';
import { splitPhraseAtBoundary } from '../utils/phrase-arc';

/**
 * Builds the arc-split callback shared by SegmentView and ContinuousView so the two strip layouts
 * can never drift apart in how a discontiguous phrase is split. Pulls the phrase create/update/
 * delete dispatchers internally, resolves the target phrase from the supplied link map, and
 * delegates the actual split to {@link splitPhraseAtBoundary}.
 *
 * @param phraseLinkByRef - The committed phrase link map to resolve the phrase from, keyed by token
 *   ref.
 * @param tokenDocOrder - Map from token ref to flat document index, used to order the phrase's
 *   tokens before slicing so the split honours visual (document) order.
 * @returns A callback `(phraseId, splitAfterTokenRef)` that splits the named phrase at the boundary
 *   immediately after `splitAfterTokenRef`; a no-op when the phrase is absent from the link map.
 */
export function useArcSplitHandler(
  phraseLinkByRef: Map<string, PhraseAnalysisLink>,
  tokenDocOrder: ReadonlyMap<string, number>,
): (phraseId: string, splitAfterTokenRef: string) => void {
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();

  return useCallback(
    (phraseId: string, splitAfterTokenRef: string) => {
      const phraseLink = [...phraseLinkByRef.values()].find((l) => l.analysisId === phraseId);
      if (!phraseLink) return;
      splitPhraseAtBoundary(
        phraseLink,
        splitAfterTokenRef,
        { createPhrase, updatePhrase, deletePhrase },
        tokenDocOrder,
      );
    },
    [phraseLinkByRef, tokenDocOrder, createPhrase, updatePhrase, deletePhrase],
  );
}
