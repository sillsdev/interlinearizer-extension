import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type { ChangeSet } from '../types/analysis-repository';
import { emptyAnalysis } from '../types/empty-factories';
import { applyChangeSet, isEmptyChangeSet } from '../utils/change-set';

const EMPTY_ANALYSIS = emptyAnalysis();

/** Whether changes left the draft unsaved, or `'kept'` when they left its unsaved mark as it was. */
type Mark = boolean | 'kept';

/** Changes taken in, with the unsaved mark they left. */
type Taken = Readonly<{ changes: ChangeSet; mark?: Mark }>;

/** `draft` with `taken` applied over it. */
function applyTaken(draft: DraftProject, { changes, mark }: Taken): DraftProject {
  const applied = applyChangeSet(draft, changes).draft;
  if (mark === undefined) return applied;
  return { ...applied, dirty: mark === 'kept' ? draft.dirty : mark };
}

/**
 * A session's whole draft, for the draft's scope and for each cross-book answer that the host does
 * not yet serve as a query. Holds no draft until its first fetch lands.
 */
export class WholeAnalysis {
  private readonly fetch: () => Promise<DraftProject>;

  private held: DraftProject | undefined;

  private readonly listeners = new Set<() => void>();

  private running: Promise<void> | undefined;

  /** The fetch that runs once the one under way settles, shared by every refresh asked meanwhile. */
  private queued: Promise<void> | undefined;

  /** What was taken in since the fetch under way was sent; `undefined` while none is. */
  private takenDuringFetch: Taken[] | undefined;

  constructor(fetch: () => Promise<DraftProject>) {
    this.fetch = fetch;
  }

  /** The draft that the latest successful fetch got; `undefined` before the first. */
  get draft(): DraftProject | undefined {
    return this.held;
  }

  /** The analysis of the draft that the latest successful fetch got; empty before the first. */
  get current(): TextAnalysis {
    return this.held?.analysis ?? EMPTY_ANALYSIS;
  }

  /**
   * Fetches the whole draft again, after any fetch under way.
   *
   * @throws Whatever the fetch throws; what was held stays.
   */
  refresh(): Promise<void> {
    if (!this.running) {
      this.running = this.fetchNow().finally(() => {
        this.running = undefined;
      });
      return this.running;
    }
    this.queued ??= this.running
      .catch(() => {})
      .then(() => {
        this.queued = undefined;
        return this.refresh();
      });
    return this.queued;
  }

  /**
   * Applies `changes`, which the session applied to its draft, to the held draft, telling each
   * listener. A fetch under way when they are taken in lands with them applied over it, because it
   * may have been answered before the session applied them. Changes that touch no record leave the
   * held draft as it was, its unsaved mark included. Otherwise the held draft is marked as `mark`
   * says, or unsaved when it is absent.
   *
   * @throws {Error} If an id appears more than once in one record kind's changes, or the scope's
   *   record names another source project.
   */
  take(changes: ChangeSet, mark?: Mark): void {
    if (isEmptyChangeSet(changes)) return;
    const taken = { changes, ...(mark !== undefined && { mark }) };
    this.takenDuringFetch?.push(taken);
    if (!this.held) return;
    this.held = applyTaken(this.held, taken);
    this.notify();
  }

  /** Calls `listener` whenever the held draft changes, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async fetchNow(): Promise<void> {
    const taken: Taken[] = [];
    this.takenDuringFetch = taken;
    try {
      const fetched = await this.fetch();
      this.held = taken.reduce(applyTaken, fetched);
    } finally {
      this.takenDuringFetch = undefined;
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
