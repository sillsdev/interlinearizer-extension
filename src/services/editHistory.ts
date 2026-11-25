import type { ReadonlyBook } from 'interlinearizer';
import type { AnalysisRepository, ApplyOptions, ChangeSet } from '../types/analysis-repository';
import type { EditStep } from '../types/edit-step';
import type { AppliedChange } from './analysisChanges';
import { invertChangeSet, mergeChangeSets } from '../utils/change-set';
import { REANCHOR_INTENT } from '../utils/reanchor-changes';

/** How many of the most recent steps stay undoable; older ones are forgotten. */
export const MAX_UNDO_STEPS = 100;

/**
 * The changes that re-anchor the stored draft, as `changes` would leave it, to the current text of
 * each of `books` in turn. Applies nothing.
 *
 * @returns The changes, or `undefined` when there are none.
 */
export type ReanchorBooks = (
  changes: ChangeSet,
  books: readonly ReadonlyBook[],
) => Promise<ChangeSet | undefined>;

/** How an edit applies. */
export type EditOptions = {
  /**
   * `'keep'` leaves the draft as saved or unsaved as it was. `'clear'` marks it saved, even when
   * the edit changes nothing, without superseding any earlier save. Absent, an edit that changes
   * something marks the draft unsaved.
   */
  unsavedMark?: 'keep' | 'clear';
  /** The step to record the edit as, which an undo or redo of the edit hands back. */
  step?: EditStep;
  /** As {@link ApplyOptions.unanchored}. */
  unanchored?: ApplyOptions['unanchored'];
};

/**
 * An undo or redo as applied, with the step that the edit was recorded as and whether the move left
 * the draft unsaved.
 */
export type HistoryMove = AppliedChange & { step?: EditStep; dirty: boolean };

/** What reverts or redoes one edit. */
type Step = {
  changes: ChangeSet;
  /** The step that the edit was recorded as. */
  step?: EditStep;
  /** How many passes the step reflects: every pass up to this count, and possibly later ones. */
  passesSeen: number;
  /** The state that applying the step leads to. */
  state: number;
};

/**
 * A linear undo history of the edits applied through it to one repository, keeping the latest
 * {@link MAX_UNDO_STEPS}. Each edit is one step, and a new edit drops every step undone before it.
 *
 * A step holds the changes that undo what the apply reports applied. An undo writes only the fields
 * that its edit changed. It also brings back the links that a deleted analysis took with it.
 *
 * A re-anchor pass is no step. A step holds records as they read when it was captured. So what an
 * undo or redo restores is re-anchored to the current text of each book that a pass has re-anchored
 * since then.
 *
 * An undo or redo marks the draft saved when it leads back to content the draft was saved with, and
 * unsaved otherwise. The history learns of a save made elsewhere only when it next applies
 * changes.
 */
export class EditHistory {
  private readonly repository: AnalysisRepository;

  private readonly reanchorBooks: ReanchorBooks | undefined;

  /** What reverts each edit not yet undone, latest last. */
  private readonly undoable: Step[] = [];

  /** What redoes each undone edit, latest last. */
  private readonly redoable: Step[] = [];

  /**
   * Each book's latest text a pass has re-anchored to, while some step predates that pass, in the
   * order the passes ran.
   */
  private readonly passes = new Map<string, { book: ReadonlyBook; ordinal: number }>();

  /** How many passes have ever been recorded. */
  private passCount = 0;

  /** Identifies the draft's current content within the history. */
  private state = 0;

  /** The latest number given to a state. */
  private lastState = 0;

  /** The states whose content the draft was saved with, as far as the history has seen. */
  private cleanStates = new Set<number>();

  /** The states whose content is empty, as far as the history has been told. */
  private readonly emptyStates = new Set<number>();

  /** The empty states the history has seen saved, later saves notwithstanding. */
  private readonly savedEmptyStates = new Set<number>();

  private appliedCount = 0;

  /**
   * @param repository - The repository whose edits the history applies and reverts.
   * @param reanchorBooks - Gives the changes that re-anchor what an undo or redo would restore;
   *   absent, nothing restored is re-anchored.
   */
  constructor(repository: AnalysisRepository, reanchorBooks?: ReanchorBooks) {
    this.repository = repository;
    this.reanchorBooks = reanchorBooks;
  }

  /** Whether there is an edit to undo. */
  get canUndo(): boolean {
    return this.undoable.length > 0;
  }

  /** Whether there is an undone edit to redo. */
  get canRedo(): boolean {
    return this.redoable.length > 0;
  }

  /** How many edits, undos and redos the history has applied to the repository. */
  get applied(): number {
    return this.appliedCount;
  }

  /**
   * Forgets every step to undo or redo, so that none writes over changes made elsewhere since. The
   * states the draft was saved with stay saved.
   */
  clear(): void {
    this.undoable.length = 0;
    this.redoable.length = 0;
    this.passes.clear();
  }

  /**
   * Records that the draft's current content is empty, whether that content is saved before this
   * call or after it.
   */
  noteEmpty(): void {
    this.emptyStates.add(this.state);
    if (this.cleanStates.has(this.state)) this.savedEmptyStates.add(this.state);
  }

  /**
   * Forgets every save of content that isn't empty. A state still counts as saved only when
   * {@link noteEmpty} recorded it as empty. A later save of other content doesn't change that. With
   * `keepCurrent` set, the current state counts as saved too.
   */
  forgetSaves(keepCurrent: boolean): void {
    this.cleanStates = new Set(this.savedEmptyStates);
    if (keepCurrent) this.addCleanState();
  }

  /**
   * Applies `changes` as one undo step. Marks the draft unsaved unless `options` says otherwise.
   *
   * @returns What the repository reports that the apply changed, with the changes that restore what
   *   it replaced.
   * @throws Whatever applying the changes throws; the history is left as it was.
   * @throws Whatever marking the draft saved throws; the changes stay applied as an undo step.
   */
  async apply(changes: ChangeSet, options?: EditOptions): Promise<AppliedChange> {
    const keep = options?.unsavedMark === 'keep';
    const { applied, wasDirty, dirty } = await this.repository.apply(changes, {
      ...(keep && { keepDirty: true }),
      ...(options?.unanchored && { unanchored: options.unanchored }),
    });
    const inverse = invertChangeSet(changes, applied);
    this.appliedCount += 1;
    this.noteMark(wasDirty);
    this.undoable.push({
      changes: inverse,
      ...(options?.step && { step: options.step }),
      passesSeen: this.passCount,
      state: this.state,
    });
    if (this.undoable.length > MAX_UNDO_STEPS) this.undoable.shift();
    this.redoable.length = 0;
    this.forgetUnneededPasses();
    this.lastState += 1;
    this.state = this.lastState;
    if (!dirty) this.addCleanState();
    if (options?.unsavedMark === 'clear') await this.markRestoredClean();
    return { changes: applied, inverse };
  }

  /**
   * Marks the draft saved, superseding any earlier save unless the draft was already saved. Any
   * later undo or redo that returns the draft to this content marks the draft saved too.
   *
   * @throws Whatever the repository's `markClean` throws.
   */
  async markClean(): Promise<void> {
    await this.repository.markClean();
    this.noteMark(false);
  }

  /**
   * Marks the draft saved without superseding any earlier save, as a discard back to the saved
   * content does. Any later undo or redo that returns the draft to this content marks the draft
   * saved too.
   *
   * @throws Whatever the repository's `markClean` throws.
   */
  async markRestoredClean(): Promise<void> {
    await this.repository.markClean();
    this.addCleanState();
  }

  /**
   * Applies `changes`, a pass that re-anchors the stored draft to `book`'s current text, and
   * records in the repository that the book is anchored to that text. Records the pass, so that
   * what an undo or redo restores is re-anchored to that text too. A pass that changes nothing is
   * still applied and recorded, because an undo or redo may restore analysis anchored to older
   * text.
   *
   * The pass goes unrecorded when the history holds no steps to undo or redo. It also goes
   * unrecorded when the book's text is unchanged since its last recorded pass.
   *
   * The pass is no undo step and leaves the draft as saved or unsaved as it was. A missing book is
   * passed as a book with no segments.
   *
   * @returns What the repository reports that the pass changed, with the changes that restore what
   *   the pass replaced. `undefined` when there are no changes to apply.
   * @throws Whatever applying the changes throws; nothing is applied or recorded.
   */
  async applyPass(
    book: ReadonlyBook,
    changes: ChangeSet | undefined,
  ): Promise<AppliedChange | undefined> {
    const { applied } = await this.repository.apply(changes ?? { intent: REANCHOR_INTENT }, {
      keepDirty: true,
      anchoredTo: { bookCode: book.bookRef, textVersion: book.textVersion },
    });
    this.recordPass(book);
    return changes && { changes: applied, inverse: invertChangeSet(changes, applied) };
  }

  /**
   * Records a pass to `book`'s current text, as {@link applyPass} does, without applying one. Meant
   * for a book whose stored analysis the repository already records as anchored to that text.
   */
  notePass(book: ReadonlyBook): void {
    this.recordPass(book);
  }

  /**
   * Reverts the latest edit not yet undone, re-anchoring what it restores.
   *
   * @returns What the repository reports that the undo changed, re-anchoring included, with what
   *   restores what it replaced. The move also carries the step that the edit was recorded as, and
   *   whether it left the draft unsaved. `undefined` when there is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to undo.
   * @throws Whatever marking the draft saved throws; the undo stays applied.
   */
  undo(): Promise<HistoryMove | undefined> {
    return this.step(this.undoable, this.redoable);
  }

  /**
   * Redoes the latest undone edit, re-anchoring what it restores.
   *
   * @returns What the repository reports that the redo changed, re-anchoring included, with what
   *   restores what it replaced. The move also carries the step that the edit was recorded as, and
   *   whether it left the draft unsaved. `undefined` when there is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to redo.
   * @throws Whatever marking the draft saved throws; the redo stays applied.
   */
  redo(): Promise<HistoryMove | undefined> {
    return this.step(this.redoable, this.undoable);
  }

  /**
   * Applies the latest changes on `from`, re-anchored to each book re-anchored since they were
   * captured, as one apply, moving what reverts it onto `to`. Marks the draft saved when the step
   * lands on a clean state.
   */
  private async step(from: Step[], to: Step[]): Promise<HistoryMove | undefined> {
    const step = from.at(-1);
    if (!step) return undefined;
    const books = [...this.passes.values()]
      .filter(({ ordinal }) => ordinal > step.passesSeen)
      .map(({ book }) => book);
    const reanchored =
      books.length > 0 && this.reanchorBooks
        ? await this.reanchorBooks(step.changes, books)
        : undefined;
    const changes = reanchored ? mergeChangeSets(step.changes, reanchored) : step.changes;
    const { applied, wasDirty } = await this.repository.apply(changes);
    const inverse = invertChangeSet(changes, applied);
    this.appliedCount += 1;
    this.noteMark(wasDirty);
    from.pop();
    to.push({
      changes: inverse,
      ...(step.step && { step: step.step }),
      // The inverse recreates each deleted record as the step read it, before any later pass.
      passesSeen: step.passesSeen,
      state: this.state,
    });
    this.state = step.state;
    this.forgetUnneededPasses();
    const clean = this.cleanStates.has(this.state);
    if (clean) await this.repository.markClean();
    return { changes: applied, inverse, ...(step.step && { step: step.step }), dirty: !clean };
  }

  /**
   * Records that a pass has just re-anchored the stored draft to `book`'s current text, superseding
   * any earlier pass over the book, so that what an undo or redo restores is re-anchored to it too.
   * Nothing is recorded when the book's text is the same text its last pass re-anchored to.
   */
  private recordPass(book: ReadonlyBook): void {
    if (this.undoable.length === 0 && this.redoable.length === 0) return;
    if (this.passes.get(book.bookRef)?.book.textVersion === book.textVersion) return;
    this.passCount += 1;
    this.passes.delete(book.bookRef);
    this.passes.set(book.bookRef, { book, ordinal: this.passCount });
  }

  /** Unless `wasDirty`, makes the current state the only clean one, if it isn't clean already. */
  private noteMark(wasDirty: boolean): void {
    if (wasDirty || this.cleanStates.has(this.state)) return;
    this.cleanStates = new Set();
    this.addCleanState();
  }

  /** Counts the current state as saved. */
  private addCleanState(): void {
    this.cleanStates.add(this.state);
    if (this.emptyStates.has(this.state)) this.savedEmptyStates.add(this.state);
  }

  /** Forgets each pass that every step left in the history already reflects. */
  private forgetUnneededPasses(): void {
    const oldestSeen = Math.min(
      ...[...this.undoable, ...this.redoable].map(({ passesSeen }) => passesSeen),
    );
    this.passes.forEach(({ ordinal }, bookCode) => {
      if (ordinal <= oldestSeen) this.passes.delete(bookCode);
    });
  }
}
