import type { Book } from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
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

/** What reverts or redoes one edit. */
type Step = {
  changes: ChangeSet;
  /** How many passes had been recorded when the step was captured, all of which it reflects. */
  passesSeen: number;
};

/**
 * A linear undo history of the edits applied through it to one repository, keeping the latest
 * {@link MAX_UNDO_STEPS}. Each edit is one step, and a new edit drops every step undone before it.
 *
 * A re-anchor pass is no step. A step holds records as they read when it was captured. So what an
 * undo or redo restores is re-anchored to the current text of each book that a pass has re-anchored
 * since then.
 */
export class EditHistory {
  private readonly repository: AnalysisRepository;

  private readonly reanchorBooks: ReanchorBooks | undefined;

  /** What reverts each edit not yet undone, latest last. */
  private readonly undoable: Step[] = [];

  /** What redoes each undone edit, latest last. */
  private readonly redoable: Step[] = [];

  /**
   * Each book's latest text a pass has re-anchored to, while some step predates it, in the order
   * the passes ran.
   */
  private readonly passes = new Map<string, { book: Book; ordinal: number }>();

  /** How many passes have ever been recorded. */
  private passCount = 0;

  /**
   * @param repository - The repository whose edits the history applies and reverts.
   * @param reanchorBooks - Gives the changes that re-anchor what an undo or redo would restore;
   *   absent, nothing restored is re-anchored.
   */
  constructor(repository: AnalysisRepository, reanchorBooks?: ReanchorBooks) {
    this.repository = repository;
    this.reanchorBooks = reanchorBooks;
  }

  /**
   * Applies `changes` as one undo step.
   *
   * @throws Whatever applying the changes throws; the history is left as it was.
   */
  async apply(changes: ChangeSet): Promise<void> {
    const { inverse } = await this.repository.apply(changes);
    this.undoable.push({ changes: inverse, passesSeen: this.passCount });
    if (this.undoable.length > MAX_UNDO_STEPS) this.undoable.shift();
    this.redoable.length = 0;
    this.forgetUnneededPasses();
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
   * @returns The changes that reverted it, with those that re-anchored it, or `undefined` when
   *   there is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to undo.
   */
  undo(): Promise<ChangeSet | undefined> {
    return this.step(this.undoable, this.redoable);
  }

  /**
   * Redoes the latest undone edit, re-anchoring what it restores.
   *
   * @returns The changes that redid it, with those that re-anchored it, or `undefined` when there
   *   is none.
   * @throws Whatever re-anchoring or applying those changes throws; nothing is applied, and the
   *   edit stays the next to redo.
   */
  redo(): Promise<ChangeSet | undefined> {
    return this.step(this.redoable, this.undoable);
  }

  /**
   * Applies the latest changes on `from`, re-anchored to each book passed over since they were
   * captured, as one apply, moving what reverts it onto `to`.
   */
  private async step(from: Step[], to: Step[]): Promise<ChangeSet | undefined> {
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
    const { inverse } = await this.repository.apply(changes);
    from.pop();
    to.push({ changes: inverse, passesSeen: this.passCount });
    this.forgetUnneededPasses();
    return changes;
  }

  /** Forgets each pass that every undo and redo step still held already reflects. */
  private forgetUnneededPasses(): void {
    const oldestSeen = Math.min(
      ...[...this.undoable, ...this.redoable].map(({ passesSeen }) => passesSeen),
    );
    this.passes.forEach(({ ordinal }, bookCode) => {
      if (ordinal <= oldestSeen) this.passes.delete(bookCode);
    });
  }
}
