import type { Book } from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import type { AppliedChange } from './analysisChanges';
import { mergeChangeSets } from '../utils/change-set';
import { MAX_UNDO_STEPS } from '../utils/undo-history';

/**
 * The changes that re-anchor the stored draft, as `changes` would leave it, to the current text of
 * each of `books` in turn. Applies nothing.
 *
 * @returns The changes, or `undefined` when there are none.
 */
export type ReanchorBooks = (
  changes: ChangeSet,
  books: readonly Book[],
) => Promise<ChangeSet | undefined>;

/** How an edit leaves the draft's unsaved mark. */
export type EditOptions = {
  /**
   * `'keep'` leaves the draft as saved or unsaved as it was. `'clear'` marks it saved, even when
   * the edit changes nothing, without superseding any earlier save. Absent, an edit that changes
   * something marks the draft unsaved.
   */
  unsavedMark?: 'keep' | 'clear';
};

/** What reverts or redoes one edit. */
type Step = {
  changes: ChangeSet;
  /** How many passes had been recorded when the step was captured, all of which it reflects. */
  passesSeen: number;
  /** The state that applying the step leads to. */
  state: number;
};

/**
 * A linear undo history of the edits applied through it to one repository, keeping the latest
 * {@link MAX_UNDO_STEPS}. Each edit is one step, and a new edit drops every step undone before it.
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
  private readonly passes = new Map<string, { book: Book; ordinal: number }>();

  /** How many passes have ever been recorded. */
  private passCount = 0;

  /** Identifies the draft's current content within the history. */
  private state = 0;

  /** The latest number given to a state. */
  private lastState = 0;

  /** The states whose content the draft was saved with, as far as the history has seen. */
  private cleanStates = new Set<number>();

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

  /** How many edits, undos and redos the history has applied to the repository. */
  get applied(): number {
    return this.appliedCount;
  }

  /**
   * Applies `changes` as one undo step. Marks the draft unsaved unless `options` says otherwise.
   *
   * @returns The changes that restore what `changes` replaced.
   * @throws Whatever applying the changes throws; the history is left as it was.
   * @throws Whatever marking the draft saved throws; the changes stay applied as an undo step.
   */
  async apply(changes: ChangeSet, options?: EditOptions): Promise<ChangeSet> {
    const keep = options?.unsavedMark === 'keep';
    const { inverse, wasDirty } = await this.repository.apply(
      changes,
      keep ? { keepDirty: true } : undefined,
    );
    this.appliedCount += 1;
    this.noteMark(wasDirty);
    this.undoable.push({ changes: inverse, passesSeen: this.passCount, state: this.state });
    if (this.undoable.length > MAX_UNDO_STEPS) this.undoable.shift();
    this.redoable.length = 0;
    this.forgetUnneededPasses();
    this.lastState += 1;
    this.state = this.lastState;
    if (keep && !wasDirty) this.cleanStates.add(this.state);
    if (options?.unsavedMark === 'clear') await this.markRestoredClean();
    return inverse;
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
    this.cleanStates.add(this.state);
  }

  /**
   * Records that a pass has just re-anchored the stored draft to `book`'s current text, superseding
   * any earlier pass over the book, so that what an undo or redo restores is re-anchored to it too.
   * A missing book is passed as a book with no segments. Nothing is recorded when the book's text
   * is the same text its last pass re-anchored to.
   */
  recordPass(book: Book): void {
    if (this.undoable.length === 0 && this.redoable.length === 0) return;
    if (this.passes.get(book.bookRef)?.book.textVersion === book.textVersion) return;
    this.passCount += 1;
    this.passes.delete(book.bookRef);
    this.passes.set(book.bookRef, { book, ordinal: this.passCount });
  }

  /**
   * Reverts the latest edit not yet undone, re-anchoring what it restores.
   *
   * @returns The changes that reverted the edit and re-anchored what the undo restored, with what
   *   restores what they replaced, or `undefined` when there is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to undo.
   * @throws Whatever marking the draft saved throws; the undo stays applied.
   */
  undo(): Promise<AppliedChange | undefined> {
    return this.step(this.undoable, this.redoable);
  }

  /**
   * Redoes the latest undone edit, re-anchoring what it restores.
   *
   * @returns The changes that redid the edit and re-anchored what the redo restored, with what
   *   restores what they replaced, or `undefined` when there is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to redo.
   * @throws Whatever marking the draft saved throws; the redo stays applied.
   */
  redo(): Promise<AppliedChange | undefined> {
    return this.step(this.redoable, this.undoable);
  }

  /**
   * Applies the latest changes on `from`, re-anchored to each book re-anchored since they were
   * captured, as one apply, moving what reverts it onto `to`. Marks the draft saved when the step
   * lands on a clean state.
   */
  private async step(from: Step[], to: Step[]): Promise<AppliedChange | undefined> {
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
    const { inverse, wasDirty } = await this.repository.apply(changes);
    this.appliedCount += 1;
    this.noteMark(wasDirty);
    from.pop();
    to.push({ changes: inverse, passesSeen: this.passCount, state: this.state });
    this.state = step.state;
    this.forgetUnneededPasses();
    if (this.cleanStates.has(this.state)) await this.repository.markClean();
    return { changes, inverse };
  }

  /** Unless `wasDirty`, makes the current state the only clean one, if it isn't clean already. */
  private noteMark(wasDirty: boolean): void {
    if (!wasDirty && !this.cleanStates.has(this.state)) this.cleanStates = new Set([this.state]);
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
