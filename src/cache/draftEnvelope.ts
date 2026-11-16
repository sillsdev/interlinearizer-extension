import type { DraftEnvelope } from 'interlinearizer';
import type { ChangeSet, ScopeRecord } from '../types/analysis-repository';
import { deepEqual } from '../utils/analysis-identity';
import { isEmptyChangeSet } from '../utils/change-set';

/** Whether changes left the draft unsaved, or `'kept'` when they left its unsaved mark as it was. */
type Mark = boolean | 'kept';

/** What changes taken in do to an envelope: the scope record they put, and their mark. */
type Taken = Readonly<{ scope: ScopeRecord | undefined; mark: Mark | undefined }>;

/** Marks `envelope` as `mark` says, or unsaved when `mark` is absent. */
function marked(envelope: DraftEnvelope, mark: Mark | undefined): DraftEnvelope {
  if (mark === 'kept') return envelope;
  const dirty = mark ?? true;
  return envelope.dirty === dirty ? envelope : { ...envelope, dirty };
}

/** `envelope` with the fields of the scope record `scope` puts, when it puts one. */
function scoped(envelope: DraftEnvelope, scope: ScopeRecord | undefined): DraftEnvelope {
  if (!scope) return envelope;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave it out
  const { segmentation, ...fields } = scope;
  // A draft listing no analysis language reads as listing the session's, as the host fills it in.
  const analysisLanguages =
    fields.analysisLanguages.length > 0 ? fields.analysisLanguages : envelope.analysisLanguages;
  const next = { ...fields, analysisLanguages, dirty: envelope.dirty };
  return deepEqual(envelope, next) ? envelope : next;
}

/** `envelope` as changes taken in leave it. */
function applied(envelope: DraftEnvelope, { scope, mark }: Taken): DraftEnvelope {
  return marked(scoped(envelope, scope), mark);
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

  /** The changes taken in since the fetch under way was sent; `undefined` while none is. */
  private takenDuringFetch: Taken[] | undefined;

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
   * Updates the held envelope as the session's `changes` leave it: with the scope record they put,
   * if any, and marked as `mark` says, or unsaved when `mark` is absent. Tells each listener when
   * the envelope changes. Changes that touch no record leave it as it was.
   *
   * A fetch under way lands updated by the changes too, because the host may have answered it
   * before applying them.
   */
  take(changes: ChangeSet, mark?: Mark): void {
    if (isEmptyChangeSet(changes)) return;
    const taken = { scope: changes.scope, mark };
    this.takenDuringFetch?.push(taken);
    if (!this.held) return;
    const next = applied(this.held, taken);
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
    const taken: Taken[] = [];
    this.takenDuringFetch = taken;
    let next: DraftEnvelope;
    try {
      next = taken.reduce(applied, await this.fetch());
    } finally {
      this.takenDuringFetch = undefined;
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
