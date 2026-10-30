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
  /** The books in which the changes put or removed a stale free translation that the view places. */
  staleTranslationBooks: string[];
  /** Whether the session has an edit to undo, as of this reply. */
  canUndo: boolean;
  /** Whether the session has an undone edit to redo, as of this reply. */
  canRedo: boolean;
  /** The step that the edit was recorded as; absent when it was recorded with none. */
  step?: EditStep;
} & PoolRead;
