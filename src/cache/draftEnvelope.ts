import type { DraftEnvelope } from 'interlinearizer';
import type { ChangeSet } from '../types/analysis-repository';
import { deepEqual } from '../utils/analysis-identity';
import { isEmptyChangeSet } from '../utils/change-set';

/** Whether changes left the draft unsaved, or `'kept'` when they left its unsaved mark as it was. */
type Mark = boolean | 'kept';

/** Marks `envelope` as `mark` says, or unsaved when `mark` is absent. */
function marked(envelope: DraftEnvelope, mark: Mark | undefined): DraftEnvelope {
  if (mark === 'kept') return envelope;
  const dirty = mark ?? true;
  return envelope.dirty === dirty ? envelope : { ...envelope, dirty };
}

/**
 * A session's draft envelope, which the view reads whole: the draft without its analysis or
 * boundaries. Holds no envelope until its first fetch lands.
 */
export class DraftEnvelopeStore {
  private readonly fetch: () => Promise<DraftEnvelope>;

  private held: DraftEnvelope | undefined;

  private readonly listeners = new Set<() => void>();

  private running: Promise<void> | undefined;

  /** The fetch that runs once the one under way settles, shared by every refresh asked meanwhile. */
  private queued: Promise<void> | undefined;

  /**
   * The marks of the changes taken in since the fetch under way was sent; `undefined` while none
   * is.
   */
  private marksDuringFetch: (Mark | undefined)[] | undefined;

  constructor(fetch: () => Promise<DraftEnvelope>) {
    this.fetch = fetch;
  }

  /** The envelope that the latest successful fetch got, as changes since have marked it. */
  get envelope(): DraftEnvelope | undefined {
    return this.held;
  }

  /**
   * Fetches the envelope again, after any fetch under way.
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
   * Marks the held envelope as the session's `changes` leave it: as `mark` says, or unsaved when
   * `mark` is absent. Tells each listener when the mark moves. Changes that touch no record leave
   * the mark as it was.
   *
   * A fetch under way lands marked by the changes too, because the host may have answered it before
   * applying them.
   */
  take(changes: ChangeSet, mark?: Mark): void {
    if (isEmptyChangeSet(changes)) return;
    this.marksDuringFetch?.push(mark);
    if (!this.held) return;
    const next = marked(this.held, mark);
    if (next === this.held) return;
    this.held = next;
    this.notify();
  }

  /** Calls `listener` whenever the held envelope changes, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async fetchNow(): Promise<void> {
    const marks: (Mark | undefined)[] = [];
    this.marksDuringFetch = marks;
    let next: DraftEnvelope;
    try {
      next = marks.reduce(marked, await this.fetch());
    } finally {
      this.marksDuringFetch = undefined;
    }
    // An envelope fetched again unchanged keeps the held one, so its readers render nothing new.
    if (this.held && deepEqual(this.held, next)) return;
    this.held = next;
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
