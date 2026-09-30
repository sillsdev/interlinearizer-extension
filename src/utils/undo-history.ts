/** How many of the most recent steps stay undoable; older ones are forgotten. */
export const MAX_UNDO_STEPS = 100;

/** Re-anchors content to one book's current text. */
export type BookPass<T> = (content: T) => T;

/** Content the history can restore. */
type Snapshot<T> = Readonly<{
  content: T;
  /** How many passes had been recorded when the content was current, all of which it reflects. */
  passesSeen: number;
}>;

/** A draft's undo history: the content each undo or redo can return to. Immutable. */
export type UndoHistory<T> = Readonly<{
  /** Content before each undoable step, oldest first. */
  past: readonly Snapshot<T>[];
  /** Content each undone step left, most recently undone last. */
  future: readonly Snapshot<T>[];
  /** The latest re-anchor pass per book code, with its position among all recorded passes. */
  passes: ReadonlyMap<string, Readonly<{ pass: BookPass<T>; ordinal: number }>>;
  /** How many passes have ever been recorded, superseded ones included. */
  passCount: number;
}>;

/** The outcome of an undo or redo. */
export type HistoryMove<T> = Readonly<{
  /** The history as it stands after the move. */
  history: UndoHistory<T>;
  /** The content the move restores, re-anchored to the current text of every re-anchored book. */
  content: T;
}>;

/** Returns a history with nothing to undo or redo. */
export function emptyHistory<T>(): UndoHistory<T> {
  return { past: [], future: [], passes: new Map(), passCount: 0 };
}

/** Whether the history holds a step to undo. */
export function canUndo<T>(history: UndoHistory<T>): boolean {
  return history.past.length > 0;
}

/** Whether the history holds an undone step to redo. */
export function canRedo<T>(history: UndoHistory<T>): boolean {
  return history.future.length > 0;
}

/**
 * Records an undo step, given the content as it stood before the step. Any undone steps become
 * unreachable.
 */
export function recordStep<T>(history: UndoHistory<T>, before: T): UndoHistory<T> {
  return {
    ...history,
    past: [...history.past, snapshot(history, before)].slice(-MAX_UNDO_STEPS),
    future: [],
  };
}

/**
 * Records a re-anchor pass that has just run over the content for `bookCode`, so that content an
 * undo or redo restores is re-anchored to that book's text too.
 */
export function recordBookPass<T>(
  history: UndoHistory<T>,
  bookCode: string,
  pass: BookPass<T>,
): UndoHistory<T> {
  const ordinal = history.passCount + 1;
  return {
    ...history,
    passes: new Map(history.passes).set(bookCode, { pass, ordinal }),
    passCount: ordinal,
  };
}

/** Captures content that reflects every pass recorded so far. */
function snapshot<T>(history: UndoHistory<T>, content: T): Snapshot<T> {
  return { content, passesSeen: history.passCount };
}

/** Re-anchors a restored snapshot to the text of every book re-anchored since it was current. */
function restore<T>(history: UndoHistory<T>, { content, passesSeen }: Snapshot<T>): T {
  return [...history.passes.values()]
    .filter(({ ordinal }) => ordinal > passesSeen)
    .reduce((restored, { pass }) => pass(restored), content);
}

/**
 * Undoes the latest step, given the content as it stands now.
 *
 * @returns The move, or `undefined` when there is no step to undo.
 */
export function undo<T>(history: UndoHistory<T>, present: T): HistoryMove<T> | undefined {
  if (!canUndo(history)) return undefined;
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [...history.future, snapshot(history, present)],
    },
    content: restore(history, history.past[history.past.length - 1]),
  };
}

/**
 * Redoes the most recently undone step, given the content as it stands now.
 *
 * @returns The move, or `undefined` when there is no undone step to redo.
 */
export function redo<T>(history: UndoHistory<T>, present: T): HistoryMove<T> | undefined {
  if (!canRedo(history)) return undefined;
  return {
    history: {
      ...history,
      past: [...history.past, snapshot(history, present)],
      future: history.future.slice(0, -1),
    },
    content: restore(history, history.future[history.future.length - 1]),
  };
}
