import type { AnalysisChange, ChangeId } from 'interlinearizer';
import type { CommandReply } from '../types/command-reply';
import type { BookOutline, SegmentPage } from '../types/segment-pages';
import { RecordCache, type Refetch } from './recordCache';

/** How many segments one page holds; pages start at multiples of it. */
export const PAGE_SIZE = 32;

/** The waits before each retry of a failed page load; the page is given up after the last. */
export const PAGE_RETRY_DELAYS_MS: readonly number[] = [1000, 4000, 16000];

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
  /** Resolves after `ms`; defaults to a timer. */
  wait?: (ms: number) => Promise<void>;
}>;

/* v8 ignore next 5 -- tests replace this timer */
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Keeps one book's pages in a {@link RecordCache}, fetched from a {@link PageSource}. It loads the
 * range that each view asks for. It applies the replies to commands that a view sends. It fetches
 * again whatever a reply or a reported change leaves out of date.
 *
 * A page that fails every retry is given up until {@link PageClient.retryFailed} asks for it again.
 */
export class PageClient {
  private readonly source: PageSource;

  private readonly pageSize: number;

  private readonly retryDelaysMs: readonly number[];

  private readonly wait: (ms: number) => Promise<void>;

  private cacheHeld?: RecordCache;

  /** Counts the outlines taken, so that a page cut by an earlier outline is dropped. */
  private outlineCount = 0;

  private readonly ranges = new Map<PageCaller, { start: number; end: number }>();

  private readonly inFlight = new Set<number>();

  private readonly failed = new Set<number>();

  /** Every fetch under way, so {@link PageClient.settled} can wait for them. */
  private readonly pending = new Set<Promise<unknown>>();

  /** The change ids of applied replies, whose changes this client already holds. */
  private readonly applied = new Set<ChangeId>();

  private readonly listeners = new Set<() => void>();

  private version = 0;

  constructor(source: PageSource, options: PageClientOptions = {}) {
    this.source = source;
    this.pageSize = options.pageSize ?? PAGE_SIZE;
    this.retryDelaysMs = options.retryDelaysMs ?? PAGE_RETRY_DELAYS_MS;
    this.wait = options.wait ?? waitMs;
  }

  /** The records held; `undefined` until the outline has loaded. */
  get cache(): RecordCache | undefined {
    return this.cacheHeld;
  }

  /** The pages that failed every retry, by page index. */
  get failedPages(): ReadonlySet<number> {
    return this.failed;
  }

  /** The records held; the outline must have loaded. */
  private get held(): RecordCache {
    /* v8 ignore next -- defensive: no fetch starts before the outline loads */
    if (!this.cacheHeld) throw new Error('Interlinearizer: no outline has loaded');
    return this.cacheHeld;
  }

  /** A number that changes whenever what the client holds changes. */
  loadedVersion(): number {
    return this.version;
  }

  /**
   * Loads the book's outline, then the latest range each view asked for.
   *
   * @throws If the source has no text for the book, or the outline cannot be read.
   */
  async open(): Promise<void> {
    const outline = await this.source.getOutline();
    if (!outline) throw new Error('Interlinearizer: the source has no text for the book');
    this.outlineCount += 1;
    if (this.cacheHeld) this.cacheHeld.replaceOutline(outline);
    else this.cacheHeld = new RecordCache(outline);
    this.failed.clear();
    this.changed();
    this.ranges.forEach(({ start, end }) => this.fetchMissing(start, end));
  }

  /**
   * Asks for the segments at outline indexes `[start, end)`, and remembers them as `caller`'s
   * range.
   */
  load(start: number, end: number, caller: PageCaller): void {
    this.ranges.set(caller, { start, end });
    this.fetchMissing(start, end);
  }

  /** Forgets the range `caller` last asked for, so a new outline does not reload it. */
  release(caller: PageCaller): void {
    this.ranges.delete(caller);
  }

  /** Asks again for every page that failed every retry. */
  retryFailed(): void {
    const pages = [...this.failed];
    this.failed.clear();
    pages.forEach((pageIndex) => this.fetchPage(pageIndex));
  }

  /**
   * Applies the reply to a command that a view sent, and fetches again whatever the reply leaves
   * out of date.
   *
   * @throws If the outline has not loaded yet.
   */
  apply(reply: CommandReply): void {
    const cache = this.cacheHeld;
    if (!cache) throw new Error('Interlinearizer: a reply arrived before the outline loaded');
    this.applied.add(reply.changeId);
    this.refetch(cache.apply(reply));
    this.changed();
  }

  /**
   * Takes in a change that the session reported, and fetches again what the change names in this
   * book. A change whose reply was applied here is skipped, because its records are already held.
   */
  hear(change: AnalysisChange & { changeId: ChangeId }): void {
    const cache = this.cacheHeld;
    if (!cache || this.applied.has(change.changeId)) return;
    const book = change.books.find(({ bookId }) => bookId === cache.outline.bookRef);
    if (book && !book.ranges) {
      this.refetch('outline');
      return;
    }
    book?.ranges?.forEach(({ start, end }) => this.refetchHeld(start, end));
    if (change.analysisIds.length > 0) this.refetchHeld(0, cache.outline.segments.length);
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

  private refetch(refetch: Refetch): void {
    if (refetch === 'outline') this.track(this.open());
    else if (refetch === 'pages') this.refetchHeld(0, this.held.outline.segments.length);
  }

  /** Fetches again each held page with a segment in `[start, end)`. */
  private refetchHeld(start: number, end: number): void {
    const cache = this.held;
    this.pagesCovering(start, end)
      .filter((pageIndex) => cache.holds(pageIndex * this.pageSize))
      .forEach((pageIndex) => this.fetchPage(pageIndex));
  }

  private fetchMissing(start: number, end: number): void {
    const cache = this.cacheHeld;
    if (!cache) return;
    this.pagesCovering(start, end)
      .filter((pageIndex) => !cache.holds(pageIndex * this.pageSize))
      .filter((pageIndex) => !this.inFlight.has(pageIndex) && !this.failed.has(pageIndex))
      .forEach((pageIndex) => this.fetchPage(pageIndex));
  }

  private pagesCovering(start: number, end: number): number[] {
    const count = this.held.outline.segments.length;
    const first = Math.floor(Math.max(0, start) / this.pageSize);
    const last = Math.ceil(Math.min(count, end) / this.pageSize);
    return Array.from({ length: Math.max(0, last - first) }, (_unused, i) => first + i);
  }

  private fetchPage(pageIndex: number, attempt = 0): void {
    this.inFlight.add(pageIndex);
    this.track(this.fetchPageNow(pageIndex, attempt));
  }

  /** Fetches the page at `pageIndex`, retrying after each delay, then giving it up. */
  private async fetchPageNow(pageIndex: number, attempt: number): Promise<void> {
    const cache = this.held;
    const sentAt = cache.revision;
    const outlineAt = this.outlineCount;
    const start = pageIndex * this.pageSize;
    let page: SegmentPage | undefined;
    try {
      page = await this.source.getSegments(start, start + this.pageSize);
    } catch {
      this.inFlight.delete(pageIndex);
      const delay = this.retryDelaysMs[attempt];
      if (delay === undefined) {
        this.failed.add(pageIndex);
        this.changed();
        return;
      }
      await this.wait(delay);
      if (outlineAt === this.outlineCount) this.fetchPage(pageIndex, attempt + 1);
      return;
    }
    this.inFlight.delete(pageIndex);
    if (outlineAt !== this.outlineCount) return;
    if (!page || page.textVersion !== cache.outline.textVersion) {
      this.refetch('outline');
      return;
    }
    cache.absorb(page, sentAt);
    this.changed();
  }

  private track(work: Promise<unknown>): void {
    const tracked = work
      .catch(() => {})
      .finally(() => {
        this.pending.delete(tracked);
      });
    this.pending.add(tracked);
  }

  private changed(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
