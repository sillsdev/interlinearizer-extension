import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../types/empty-factories';

const EMPTY_ANALYSIS = emptyAnalysis();

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

  /** Calls `listener` whenever the held draft changes, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async fetchNow(): Promise<void> {
    this.held = await this.fetch();
    this.listeners.forEach((listener) => listener());
  }
}
