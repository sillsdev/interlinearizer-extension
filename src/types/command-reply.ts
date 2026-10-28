import type { ChangeId } from 'interlinearizer';
import type { ChangeSet } from './analysis-repository';
import type { EditStep } from './edit-step';
import type { PoolRead } from './segment-pages';

/**
 * What a session answers an edit, an undo or a redo with.
 *
 * `poolBuckets` holds the bucket of each form whose payloads or token links the changes put,
 * replaced or deleted.
 */
export type CommandReply = {
  changeId: ChangeId;
  /** The changes applied, naming the edit's intent. */
  changes: ChangeSet;
  /** The books whose boundaries the changes moved. */
  resegmentedBooks: string[];
  /**
   * For an undo or redo, the step that the edit was recorded as; absent when it was recorded with
   * none.
   */
  step?: EditStep;
} & PoolRead;
