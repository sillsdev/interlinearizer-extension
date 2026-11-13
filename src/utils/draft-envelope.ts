import type { DraftEnvelope, DraftProject } from 'interlinearizer';

/** The envelope of `draft`: every field but its analysis and boundaries. */
export function envelopeOf(draft: DraftProject): DraftEnvelope {
  const {
    sourceProjectId,
    modelVersion,
    analysisLanguages,
    targetProjectId,
    suggestedDescription,
    dirty,
  } = draft;
  return {
    sourceProjectId,
    modelVersion,
    analysisLanguages,
    ...(targetProjectId !== undefined && { targetProjectId }),
    ...(suggestedDescription !== undefined && { suggestedDescription }),
    dirty,
  };
}
