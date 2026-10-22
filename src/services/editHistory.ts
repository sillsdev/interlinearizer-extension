import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';

/**
 * A linear undo history of the edits applied through it to one repository. Each edit is one step,
 * and a new edit drops every step undone before it.
 */
export class EditHistory {
  private readonly repository: AnalysisRepository;

  /** What reverts each edit not yet undone, latest last. */
  private readonly undoable: ChangeSet[] = [];

  /** What redoes each undone edit, latest last. */
  private readonly redoable: ChangeSet[] = [];

  constructor(repository: AnalysisRepository) {
    this.repository = repository;
  }

  /**
   * Applies `changes` as one undo step.
   *
   * @throws Whatever applying the changes throws; the history is left as it was.
   */
  async apply(changes: ChangeSet): Promise<void> {
    const { inverse } = await this.repository.apply(changes);
    this.undoable.push(inverse);
    this.redoable.length = 0;
  }

  /**
   * Reverts the latest edit not yet undone.
   *
   * @returns The changes that reverted it, or `undefined` when there is none.
   * @throws Whatever applying those changes throws; the edit stays the next to undo.
   */
  undo(): Promise<ChangeSet | undefined> {
    return this.step(this.undoable, this.redoable);
  }

  /**
   * Redoes the latest undone edit.
   *
   * @returns The changes that redid it, or `undefined` when there is none.
   * @throws Whatever applying those changes throws; the edit stays the next to redo.
   */
  redo(): Promise<ChangeSet | undefined> {
    return this.step(this.redoable, this.undoable);
  }

  /** Applies the latest changes on `from`, moving what reverts them onto `to`. */
  private async step(from: ChangeSet[], to: ChangeSet[]): Promise<ChangeSet | undefined> {
    const changes = from.at(-1);
    if (!changes) return undefined;
    const { inverse } = await this.repository.apply(changes);
    from.pop();
    to.push(inverse);
    return changes;
  }
}
