import type { DraftEnvelope } from 'interlinearizer';
import type { ScopeRecord } from './analysis-repository';

/** The envelope of the draft whose own record is `scope`: every field but its boundaries. */
export function envelopeOf(scope: ScopeRecord, dirty: boolean): DraftEnvelope {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave it out
  const { segmentation, ...envelope } = scope;
  return { ...envelope, dirty };
}
