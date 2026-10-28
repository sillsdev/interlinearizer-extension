import type { ChangeId, TokenAnalysis } from 'interlinearizer';
import type { ChangeSet } from './analysis-repository';
import type { PoolBuckets } from './segment-pages';

/** What a session answers an edit, an undo or a redo with. */
export type CommandReply = {
  changeId: ChangeId;
  /** The changes applied, naming the edit's intent. */
  changes: ChangeSet;
  /**
   * The pool buckets of the forms whose payloads or token links the changes put, replaced or
   * deleted.
   */
  poolBuckets: PoolBuckets;
  /** The payloads `poolBuckets` names. */
  poolAnalyses: TokenAnalysis[];
};
