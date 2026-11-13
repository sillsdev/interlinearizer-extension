import type { DraftEnvelope, DraftProject } from 'interlinearizer';

/** The envelope of `draft`: every field but its analysis and boundaries. */
export function envelopeOf(draft: DraftProject): DraftEnvelope {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave them out
  const { analysis, segmentation, ...envelope } = draft;
  return envelope;
}
