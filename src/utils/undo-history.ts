/** How many of the most recent steps stay undoable; older ones are forgotten. */
export const MAX_UNDO_STEPS = 100;

/** Re-anchors content to one book's current text. */
export type BookPass<T> = (content: T) => T;

/** Content the history can restore. */
type Snapshot<T, S> = Readonly<{
  content: T;
  /** Which of the history's states the content is. */
  state: number;
  /** How many passes had been recorded when the content was current, all of which it reflects. */
  passesSeen: number;
  /** What the caller said of the step leading from this content to the next. */
  step: S | undefined;
}>;

/**
 * A draft's undo history: the content each undo or redo can return to, and what the caller said of
 * each step. Immutable.
 */
export type UndoHistory<T, S = undefined> = Readonly<{
  /** Content before each undoable step, oldest first. */
  past: readonly Snapshot<T, S>[];
  /** Content each undone step left, most recently undone last. */
  future: readonly Snapshot<T, S>[];
  /**
   * Which state the present content is: each step reaches a new one, and an undo or redo returns to
   * the one it restores, however the content has been re-anchored since.
   */
  state: number;
  /** How many states steps have reached. */
  stateCount: number;
  /** Each re-anchored book's latest pass, in the order they ran, with its position among all. */
  passes: readonly Readonly<{ bookCode: string; pass: BookPass<T>; ordinal: number }>[];
  /** How many passes have ever been recorded, superseded ones included. */
  passCount: number;
}>;

/** The outcome of an undo or redo. */
export type HistoryMove<T, S = undefined> = Readonly<{
  /** The history as it stands after the move. */
  history: UndoHistory<T, S>;
  /** The content the move restores, re-anchored to the current text of every re-anchored book. */
  content: T;
  /** What the caller said of the step undone or redone when recording it. */
  step: S | undefined;
}>;

/** Returns a history with nothing to undo or redo. */
export function emptyHistory<T, S = undefined>(): UndoHistory<T, S> {
  return { past: [], future: [], state: 0, stateCount: 0, passes: [], passCount: 0 };
}

/** Whether the history holds a step to undo. */
export function canUndo<T, S>(history: UndoHistory<T, S>): boolean {
  return history.past.length > 0;
}

/** Whether the history holds an undone step to redo. */
export function canRedo<T, S>(history: UndoHistory<T, S>): boolean {
  return history.future.length > 0;
}

/**
 * Records an undo step, given the content as it stood before the step and anything to hand back
 * when the step is undone or redone. Any undone steps become unreachable.
 */
export function recordStep<T, S>(
  history: UndoHistory<T, S>,
  before: T,
  step?: S,
): UndoHistory<T, S> {
  const state = history.stateCount + 1;
  return {
    ...history,
    past: [...history.past, snapshot(history, before, step)].slice(-MAX_UNDO_STEPS),
    future: [],
    state,
    stateCount: state,
  };
}

/**
 * Records a re-anchor pass that has just run over the content for `bookCode`, superseding the
 * book's earlier pass, so that content an undo or redo restores is re-anchored to that book's text
 * too. Rerunning the book's latest pass records nothing.
 */
export function recordBookPass<T, S>(
  history: UndoHistory<T, S>,
  bookCode: string,
  pass: BookPass<T>,
): UndoHistory<T, S> {
  const superseded = history.passes.find((recorded) => recorded.bookCode === bookCode);
  if (superseded?.pass === pass) return history;
  const ordinal = history.passCount + 1;
  return {
    ...history,
    passes: [
      ...history.passes.filter((recorded) => recorded !== superseded),
      { bookCode, pass, ordinal },
    ],
    passCount: ordinal,
  };
}

/** Captures content that reflects every pass recorded so far. */
function snapshot<T, S>(
  history: UndoHistory<T, S>,
  content: T,
  step: S | undefined,
): Snapshot<T, S> {
  return { content, state: history.state, passesSeen: history.passCount, step };
}

/** Re-anchors a restored snapshot through each book's pass run since it was current, in run order. */
function restore<T, S>(history: UndoHistory<T, S>, { content, passesSeen }: Snapshot<T, S>): T {
  return history.passes
    .filter(({ ordinal }) => ordinal > passesSeen)
    .reduce((restored, { pass }) => pass(restored), content);
}

/**
 * Undoes the latest step, given the content as it stands now.
 *
 * @returns The move, or `undefined` when there is no step to undo.
 */
export function undo<T, S>(history: UndoHistory<T, S>, present: T): HistoryMove<T, S> | undefined {
  if (!canUndo(history)) return undefined;
  const undone = history.past[history.past.length - 1];
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [...history.future, snapshot(history, present, undone.step)],
      state: undone.state,
    },
    content: restore(history, undone),
    step: undone.step,
  };
}

/**
 * Redoes the most recently undone step, given the content as it stands now.
 *
 * @returns The move, or `undefined` when there is no undone step to redo.
 */
export function redo<T, S>(history: UndoHistory<T, S>, present: T): HistoryMove<T, S> | undefined {
  if (!canRedo(history)) return undefined;
  const redone = history.future[history.future.length - 1];
  return {
    history: {
      ...history,
      past: [...history.past, snapshot(history, present, redone.step)],
      future: history.future.slice(0, -1),
      state: redone.state,
    },
    content: restore(history, redone),
    step: redone.step,
  };
}
