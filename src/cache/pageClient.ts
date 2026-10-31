import type { AnalysisChange, ChangeId, Segment, TextAnalysis } from 'interlinearizer';
import type { CommandReply } from '../types/command-reply';
import { emptyAnalysis } from '../types/empty-factories';
import type { PoolEntry, PoolIndex } from '../utils/suggestion-engine';
import type { BookOutline, SegmentPage } from '../types/segment-pages';
import { RecordCache, type PageRequest, type Refetch } from './recordCache';

/** How many segments one page holds; pages start at multiples of it. */
export const PAGE_SIZE = 32;

/** The waits before each retry of a failed load; the load is given up after the last. */
export const PAGE_RETRY_DELAYS_MS: readonly number[] = [1000, 4000, 16000];

/**
 * Indexes of the pages that hold any of the segments at `[start, end)` in a book of `count`
 * segments. Pages start every `pageSize` segments, by default {@link PAGE_SIZE}.
 */
export function pagesCovering(
  start: number,
  end: number,
  count: number,
  pageSize: number = PAGE_SIZE,
): number[] {
  const first = Math.floor(Math.max(0, start) / pageSize);
  const last = Math.ceil(Math.min(count, end) / pageSize);
  return Array.from({ length: Math.max(0, last - first) }, (_unused, i) => first + i);
}

/** A view whose latest page range is reloaded after the outline changes. */
export type PageCaller = 'list' | 'strip';

/** Where a {@link PageClient} reads one book's outline and pages. */
export type PageSource = Readonly<{
  /** Resolves `undefined` when the source has no text for the book. */
  getOutline: () => Promise<BookOutline | undefined>;
  /** Resolves `undefined` when the source has no text for the book. */
  getSegments: (start: number, end: number) => Promise<SegmentPage | undefined>;
}>;

/** How a client fetches. */
export type PageClientOptions = Readonly<{
  /** Segments per page; defaults to {@link PAGE_SIZE}. */
  pageSize?: number;
  /** Defaults to {@link PAGE_RETRY_DELAYS_MS}. */
  retryDelaysMs?: readonly number[];
  /** Resolves after `ms`; defaults to {@link waitMs}. */
  wait?: (ms: number) => Promise<void>;
}>;

/** Resolves after `ms`. */
export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * A page request noted by {@link PageClient.beginFetch}, for {@link PageClient.absorb} to judge the
 * page against.
 */
export type PageFetch = Readonly<{
  request: PageRequest;
  /** Which outline was held when the request was sent. */
  outlineAt: number;
}>;

/** How many of its own applied changes a client remembers, to skip their reported changes. */
export const KEPT_APPLIED = 64;

/**
 * Where one page's fetch stands. A page with no state has no fetch under way and was not given up.
 *
 * - `inFlight`: a fetch is outstanding; `dirty` when a change has since left its answer out of date.
 * - `backoff`: a fetch failed and the next attempt waits for its delay.
 * - `failed`: every attempt failed, until a view asks for the page again or
 *   {@link PageClient.retryFailed}.
 */
type PageState =
  | { kind: 'inFlight'; attempt: number; dirty: boolean }
  | { kind: 'backoff'; attempt: number }
  | { kind: 'failed' };

/**
 * What can happen to a page's fetch.
 *
 * - `want`: a view asks for the page, which is not held.
 * - `stale`: a change has left the page out of date.
 * - `retry`: the page was given up and is asked for again.
 * - `landed`: the fetch came back and the page was taken in.
 * - `dropped`: the fetch came back without a page that could be taken in.
 * - `errored`: the fetch failed.
 * - `waited`: the delay before the next attempt has passed.
 */
type PageEvent = 'want' | 'stale' | 'retry' | 'landed' | 'dropped' | 'errored' | 'waited';

/** What an outline read takes: the whole outline, or only its orphaned-card counts when it can. */
type OutlineRead = 'outline' | 'counts';

/** The read that covers both `a` and `b`. */
function wider(a: OutlineRead | undefined, b: OutlineRead): OutlineRead {
  return a === 'outline' ? a : b;
}

/**
 * Keeps one book's pages in a {@link RecordCache}, fetched from a {@link PageSource}. It loads the
 * range that each view asks for. It sends the commands that a view makes and applies their replies.
 * It fetches again whatever a reply or a reported change leaves out of date.
 *
 * A page that fails every retry waits for a view to ask for it again, for
 * {@link PageClient.retryFailed} or for a later outline read. An outline read that fails waits for
 * either of the last two.
 */
export class PageClient {
  private readonly source: PageSource;

  private readonly pageSize: number;

  private readonly retryDelaysMs: readonly number[];

  private readonly wait: (ms: number) => Promise<void>;

  private cacheHeld?: RecordCache;

  /** Counts the outlines taken, so that a fetch sent under an earlier outline is dropped. */
  private outlineCount = 0;

  private readonly ranges = new Map<PageCaller, { start: number; end: number }>();

  private readonly pages = new Map<number, PageState>();

  /** The outline reads under way, settling once no read is wanted. */
  private outlineReading?: Promise<void>;

  /** The read wanted once the read in flight lands, because a change may have outdated it. */
  private outlineWanted?: OutlineRead;

  /** The outline read that failed, with its error, until another outline read is asked for. */
  private outlineFailure?: { read: OutlineRead; error: unknown };

  /** Every fetch under way, so {@link PageClient.settled} can wait for them. */
  private readonly pending = new Set<Promise<unknown>>();

  /**
   * The change ids of commands sent and not yet answered, each with its reported change once that
   * arrives.
   */
  private readonly sent = new Map<
    ChangeId,
    (AnalysisChange & { changeId: ChangeId }) | undefined
  >();

  /** The change ids of applied replies whose reported change has not arrived yet. */
  private readonly applied = new Set<ChangeId>();

  private readonly listeners = new Set<() => void>();

  private readonly replyListeners = new Set<(reply: CommandReply) => void>();

  private readonly heardListeners = new Set<() => void>();

  private version = 0;

  private heldSnapshot: { version: number; analysis: TextAnalysis } = {
    version: -1,
    analysis: emptyAnalysis(),
  };

  private poolSnapshot: { version: number; pool: PoolIndex } = { version: -1, pool: new Map() };

  private failedSnapshot: { version: number; pages: ReadonlySet<number> } = {
    version: -1,
    pages: new Set(),
  };

  constructor(source: PageSource, options: PageClientOptions = {}) {
    this.source = source;
    this.pageSize = options.pageSize ?? PAGE_SIZE;
    this.retryDelaysMs = options.retryDelaysMs ?? PAGE_RETRY_DELAYS_MS;
    this.wait = options.wait ?? waitMs;
  }

  /** The outline that the held pages were cut by; `undefined` until an outline has loaded. */
  get outline(): BookOutline | undefined {
    return this.cacheHeld?.outline;
  }

  /**
   * The pages that failed every retry, by page index; the same set object until
   * {@link PageClient.loadedVersion} changes.
   */
  get failedPages(): ReadonlySet<number> {
    if (this.failedSnapshot.version !== this.version) {
      const pages = [...this.pages].filter(([, state]) => state.kind === 'failed');
      this.failedSnapshot = {
        version: this.version,
        pages: new Set(pages.map(([index]) => index)),
      };
    }
    return this.failedSnapshot.pages;
  }

  /** Whether the latest outline read failed. */
  get outlineFailed(): boolean {
    return this.outlineFailure !== undefined;
  }

  /** The records held; the outline must have loaded. */
  private get held(): RecordCache {
    /* v8 ignore next -- defensive: the client's own paths read records only after the outline loads */
    if (!this.cacheHeld) throw new Error('Interlinearizer: no outline has loaded');
    return this.cacheHeld;
  }

  /**
   * The suggestion pool of the forms held, with the payloads that its buckets name; empty before
   * the outline loads. The same map until {@link PageClient.loadedVersion} changes.
   */
  poolIndex(): PoolIndex {
    if (this.poolSnapshot.version !== this.version) {
      const byId = new Map(this.heldAnalysis().tokenAnalyses.map((a) => [a.id, a]));
      const pool = new Map<string, PoolEntry[]>();
      this.cacheHeld?.poolBucketsHeld().forEach((bucket, form) => {
        const entries = bucket.flatMap(({ analysisId, frequency }) => {
          const analysis = byId.get(analysisId);
          /* v8 ignore next -- a page or reply brings the payloads its buckets name */
          return analysis ? [{ analysis, frequency }] : [];
        });
        if (entries.length > 0) pool.set(form, entries);
      });
      this.poolSnapshot = { version: this.version, pool };
    }
    return this.poolSnapshot.pool;
  }

  /** A number that changes whenever what the client holds changes. */
  loadedVersion(): number {
    return this.version;
  }

  /** The segment held at outline index `index`; `undefined` until its page has loaded. */
  segmentAt(index: number): Segment | undefined {
    return this.cacheHeld?.segmentAt(index);
  }

  /** Whether the segment at outline index `index` is held. */
  holds(index: number): boolean {
    return this.cacheHeld?.holds(index) ?? false;
  }

  /**
   * Serves the segments at outline indexes `[start, end)` with their analysis, as the host would
   * page them. Returns `undefined` unless every one of those segments is held.
   */
  pageAt(start: number, end: number): SegmentPage | undefined {
    return this.cacheHeld?.pageAt(start, end);
  }

  /**
   * Every record held, as one analysis; empty before the outline loads. The same object until
   * {@link PageClient.loadedVersion} changes.
   */
  heldAnalysis(): TextAnalysis {
    if (this.heldSnapshot.version !== this.version) {
      this.heldSnapshot = {
        version: this.version,
        analysis: this.cacheHeld?.heldAnalysis() ?? emptyAnalysis(),
      };
    }
    return this.heldSnapshot.analysis;
  }

  /**
   * Loads the book's outline, then the latest range each view asked for.
   *
   * @throws If the source has no text for the book, or the outline cannot be read.
   */
  async open(): Promise<void> {
    await this.readOutlineAgain('outline');
    if (this.outlineFailure) throw this.outlineFailure.error;
  }

  /**
   * Asks for the segments at outline indexes `[start, end)`, and remembers them as `caller`'s
   * range. Pages among them that failed every retry are asked for again.
   */
  load(start: number, end: number, caller: PageCaller): void {
    this.ranges.set(caller, { start, end });
    this.fetchMissing(start, end);
  }

  /** Forgets the range `caller` last asked for, so a new outline does not reload it. */
  release(caller: PageCaller): void {
    this.ranges.delete(caller);
  }

  /** Asks again for every page that failed every retry, and for the outline when its read failed. */
  retryFailed(): void {
    [...this.failedPages].forEach((pageIndex) => this.step(pageIndex, 'retry'));
    if (this.outlineFailure) this.readOutlineAgain(this.outlineFailure.read);
    this.changed();
  }

  /**
   * Sends a command under a fresh change id, then applies its reply and fetches again whatever the
   * reply leaves out of date. Unless `command` throws, the change that the session reports for the
   * command is skipped, because the reply carries its records.
   *
   * @returns What `command` resolves to: the reply, or `undefined` when the command applied
   *   nothing.
   * @throws If the outline has not loaded yet, or whatever `command` throws.
   */
  async send(
    command: (changeId: ChangeId) => Promise<CommandReply | undefined>,
  ): Promise<CommandReply | undefined> {
    if (!this.cacheHeld)
      throw new Error('Interlinearizer: a command was sent before the outline loaded');
    const changeId = crypto.randomUUID();
    this.sent.set(changeId, undefined);
    let reply: CommandReply | undefined;
    try {
      reply = await command(changeId);
    } catch (error) {
      const heard = this.sent.get(changeId);
      this.sent.delete(changeId);
      // The command may have applied before its reply failed.
      if (heard) this.hearNow(heard);
      throw error;
    }
    const heard = this.sent.get(changeId);
    this.sent.delete(changeId);
    if (!reply) return reply;
    if (!heard) this.rememberApplied(changeId);
    this.refetch(this.held.apply(reply));
    this.changed();
    this.replyListeners.forEach((listener) => listener(reply));
    return reply;
  }

  /**
   * Takes in a change that the session reported, and fetches again whatever the change leaves out
   * of date in this book. The client skips the change reported for a command sent through
   * {@link PageClient.send}, because the command's reply carries the same records. It takes the
   * change in when that command throws.
   */
  hear(change: AnalysisChange & { changeId: ChangeId }): void {
    const { changeId } = change;
    if (this.sent.has(changeId)) this.sent.set(changeId, change);
    else if (!this.applied.delete(changeId)) this.hearNow(change);
  }

  /**
   * Notes a page request as sent now, for {@link PageClient.absorb} to take its page in once it
   * lands.
   *
   * @throws If the outline has not loaded yet.
   */
  beginFetch(): PageFetch {
    return { request: this.held.beginFetch(), outlineAt: this.outlineCount };
  }

  /**
   * Takes in a page fetched by the request that `fetch` noted. Any record that a reply has written
   * since then stays as that reply left it.
   *
   * @returns `true` when it took the page. `false` when an outline was taken since the request was
   *   sent, or when the page was cut from other text; only the latter starts an outline read.
   * @throws If the outline has not loaded yet.
   */
  absorb(page: SegmentPage, fetch: PageFetch): boolean {
    if (fetch.outlineAt !== this.outlineCount) return false;
    if (page.textVersion !== this.held.outline.textVersion) {
      this.readOutlineAgain('outline');
      return false;
    }
    this.held.absorb(page, fetch.request);
    this.changed();
    return true;
  }

  /**
   * Calls `listener` with each reply that the client applies, until the returned function is
   * called.
   */
  subscribeReplies(listener: (reply: CommandReply) => void): () => void {
    this.replyListeners.add(listener);
    return () => this.replyListeners.delete(listener);
  }

  /**
   * Calls `listener` whenever the client takes in a reported change rather than skipping it, until
   * the returned function is called.
   */
  subscribeHeard(listener: () => void): () => void {
    this.heardListeners.add(listener);
    return () => this.heardListeners.delete(listener);
  }

  /** Calls `listener` whenever what the client holds changes, until the returned function is called. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Settles once every fetch under way has settled, along with every fetch that those start. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) {
      // eslint-disable-next-line no-await-in-loop -- a fetch may start others
      await Promise.allSettled([...this.pending]);
    }
  }

  /** Remembers `changeId` as applied, forgetting the oldest beyond {@link KEPT_APPLIED}. */
  private rememberApplied(changeId: ChangeId): void {
    this.applied.add(changeId);
    if (this.applied.size > KEPT_APPLIED) this.applied.delete([...this.applied][0]);
  }

  private hearNow(change: AnalysisChange): void {
    this.heardListeners.forEach((listener) => listener());
    const cache = this.cacheHeld;
    if (!cache) {
      if (this.outlineReading) this.readOutlineAgain('outline');
      return;
    }
    const book = change.books.find(({ bookId }) => bookId === cache.outline.bookRef);
    if (book && !book.ranges) {
      this.refetch('outline');
      return;
    }
    if (book?.staleTranslations) {
      this.refetch('placement');
      return;
    }
    const indexes = [
      ...(book?.ranges ?? []).flatMap(({ start, end }) =>
        Array.from({ length: end - start }, (_unused, i) => start + i),
      ),
      ...cache.heldIndexesReading(change.analysisIds, change.forms),
    ];
    const named = new Set(indexes.map((index) => Math.floor(index / this.pageSize)));
    // A page not held yet cannot be checked for the analyses the change names.
    if (change.analysisIds.length > 0 || change.forms.length > 0)
      this.pages.forEach((state, pageIndex) => {
        if (state.kind === 'inFlight' && !cache.holds(pageIndex * this.pageSize))
          named.add(pageIndex);
      });
    named.forEach((pageIndex) => this.step(pageIndex, 'stale'));
  }

  /**
   * Reads the outline, after any read in flight. A `'counts'` read takes the orphaned-card counts,
   * or the whole outline when it differs from the held one in more than those counts. An
   * `'outline'` read takes the whole outline, letting go of every held page.
   *
   * @returns Settles once no read is wanted. Never rejects; a failed read is noted for
   *   {@link PageClient.retryFailed}.
   */
  private readOutlineAgain(read: OutlineRead): Promise<void> {
    this.outlineWanted = wider(this.outlineWanted, read);
    this.outlineFailure = undefined;
    if (!this.outlineReading) {
      const reading = this.readOutlines();
      this.outlineReading = reading;
      this.track(reading);
    }
    return this.outlineReading;
  }

  private async readOutlines(): Promise<void> {
    try {
      let read = this.outlineWanted;
      while (read) {
        this.outlineWanted = undefined;
        let outline: BookOutline | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop -- one outline read at a time
          outline = await this.source.getOutline();
          if (!outline) throw new Error('Interlinearizer: the source has no text for the book');
        } catch (error) {
          this.outlineFailure = { read: wider(this.outlineWanted, read), error };
          this.outlineWanted = undefined;
          this.changed();
          return;
        }
        if (this.outlineWanted) read = wider(this.outlineWanted, read);
        else {
          if (read === 'counts' && this.held.takeCounts(outline)) this.changed();
          else this.takeOutline(outline);
          read = this.outlineWanted;
        }
      }
    } finally {
      this.outlineReading = undefined;
    }
  }

  /**
   * Takes `outline`, letting go of every held page, then loads the latest range each view asked
   * for.
   */
  private takeOutline(outline: BookOutline): void {
    this.outlineCount += 1;
    if (this.cacheHeld) this.cacheHeld.replaceOutline(outline);
    else this.cacheHeld = new RecordCache(outline);
    this.pages.clear();
    this.changed();
    this.ranges.forEach(({ start, end }) => this.fetchMissing(start, end));
  }

  private refetch(refetch: Refetch): void {
    if (refetch === 'outline') this.readOutlineAgain('outline');
    else if (refetch !== 'none') {
      if (refetch === 'placement') this.readOutlineAgain('counts');
      this.pagesCovering(0, this.held.outline.segments.length).forEach((pageIndex) =>
        this.step(pageIndex, 'stale'),
      );
    }
  }

  private fetchMissing(start: number, end: number): void {
    const cache = this.cacheHeld;
    if (!cache) return;
    this.pagesCovering(start, end)
      .filter((pageIndex) => !cache.holds(pageIndex * this.pageSize))
      .forEach((pageIndex) => this.step(pageIndex, 'want'));
  }

  private pagesCovering(start: number, end: number): number[] {
    return pagesCovering(start, end, this.held.outline.segments.length, this.pageSize);
  }

  /**
   * Moves the page at `pageIndex` to the state that `event` leads to, starting any fetch that the
   * new state needs.
   */
  private step(pageIndex: number, event: PageEvent): void {
    const state = this.pages.get(pageIndex);
    switch (event) {
      case 'want':
        if (!state || state.kind === 'failed') this.fetchPage(pageIndex, 0);
        break;
      case 'stale':
        if (state?.kind === 'inFlight') this.pages.set(pageIndex, { ...state, dirty: true });
        else if (!state && this.held.holds(pageIndex * this.pageSize)) this.fetchPage(pageIndex, 0);
        break;
      case 'retry':
        if (state?.kind === 'failed') this.fetchPage(pageIndex, 0);
        break;
      case 'landed':
        if (state?.kind === 'inFlight' && state.dirty) this.fetchPage(pageIndex, 0);
        else this.pages.delete(pageIndex);
        break;
      case 'dropped':
        this.pages.delete(pageIndex);
        break;
      case 'errored': {
        /* v8 ignore next -- defensive: only a fetch in flight errors */
        if (state?.kind !== 'inFlight') break;
        const delay = this.retryDelaysMs[state.attempt];
        if (delay === undefined) {
          this.pages.set(pageIndex, { kind: 'failed' });
          this.changed();
          break;
        }
        this.pages.set(pageIndex, { kind: 'backoff', attempt: state.attempt + 1 });
        this.track(this.waitToRetry(pageIndex, delay));
        break;
      }
      case 'waited':
        if (state?.kind === 'backoff') this.fetchPage(pageIndex, state.attempt);
        break;
      /* v8 ignore next 2 -- exhaustive */
      default:
        throw new Error(`Interlinearizer: unknown page event ${String(event)}`);
    }
  }

  private async waitToRetry(pageIndex: number, delay: number): Promise<void> {
    const outlineAt = this.outlineCount;
    await this.wait(delay);
    if (outlineAt === this.outlineCount) this.step(pageIndex, 'waited');
  }

  private fetchPage(pageIndex: number, attempt: number): void {
    this.pages.set(pageIndex, { kind: 'inFlight', attempt, dirty: false });
    this.track(this.fetchPageNow(pageIndex, this.beginFetch()));
  }

  private async fetchPageNow(pageIndex: number, fetch: PageFetch): Promise<void> {
    const start = pageIndex * this.pageSize;
    let page: SegmentPage | undefined;
    try {
      page = await this.source.getSegments(start, start + this.pageSize);
    } catch {
      if (fetch.outlineAt === this.outlineCount) this.step(pageIndex, 'errored');
      return;
    }
    if (fetch.outlineAt !== this.outlineCount) return;
    if (!page) {
      this.readOutlineAgain('outline');
      this.step(pageIndex, 'dropped');
      return;
    }
    this.step(pageIndex, this.absorb(page, fetch) ? 'landed' : 'dropped');
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.finally(() => {
      this.pending.delete(tracked);
    });
    this.pending.add(tracked);
  }

  private changed(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
