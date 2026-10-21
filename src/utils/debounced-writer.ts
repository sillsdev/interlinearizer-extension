/** What a {@link DebouncedWriter} is built from. */
export type DebouncedWriterOptions<T> = {
  /** Sends one value to storage; its rejection is what the writer counts as a failed write. */
  write: (value: T) => Promise<void>;
  /** Milliseconds a scheduled write waits for a later value before it is sent. */
  delayMs: number;
  /** Hears each write that fails. */
  onFailure: (error: unknown) => void;
};

/**
 * Debounces writes of a value to storage and can settle them: once {@link settle} resolves, every
 * value handed to the writer has been superseded or stored, so what storage holds is the last value
 * given. A write that failed is sent again on settle, so one failure never leaves storage behind
 * for good.
 */
export class DebouncedWriter<T> {
  private readonly options: DebouncedWriterOptions<T>;

  private timer: ReturnType<typeof setTimeout> | undefined;

  private scheduled: T | undefined;

  private latest: Promise<void> = Promise.resolve();

  private lastValue: T | undefined;

  private failed = false;

  private failure: unknown;

  constructor(options: DebouncedWriterOptions<T>) {
    this.options = options;
  }

  /** Writes `value` once the delay passes with no later call; a later call takes its place. */
  schedule(value: T): void {
    this.cancel();
    this.scheduled = value;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.scheduled = undefined;
      this.writeNow(value);
    }, this.options.delayMs);
  }

  /** Drops the scheduled write, if any. */
  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.scheduled = undefined;
  }

  /** Writes `value` at once, dropping any scheduled write. */
  writeNow(value: T): void {
    this.cancel();
    const write = this.options.write(value);
    this.latest = write;
    this.lastValue = value;
    this.failed = false;
    write.catch((e: unknown) => {
      if (this.latest === write) {
        this.failed = true;
        this.failure = e;
      }
      this.options.onFailure(e);
    });
  }

  /** Sends the scheduled write at once, if there is one. */
  flush(): void {
    const { scheduled } = this;
    if (this.timer !== undefined && scheduled !== undefined) this.writeNow(scheduled);
  }

  /**
   * Resolves once storage holds the last value given: any scheduled write is sent, every write in
   * flight has landed, and a write that failed has been sent again. A value scheduled while this
   * waits is written too before it resolves.
   *
   * @throws The failure, when the write sent again fails as well.
   */
  async settle(): Promise<void> {
    let resent: T | undefined;
    for (;;) {
      this.flush();
      if (this.failed && this.lastValue !== undefined) {
        if (resent === this.lastValue) throw this.failure;
        resent = this.lastValue;
        this.writeNow(this.lastValue);
      }
      const { latest } = this;
      // eslint-disable-next-line no-await-in-loop -- each round waits for the write it sent
      await latest.catch(() => {});
      if (this.timer === undefined && this.latest === latest && !this.failed) return;
    }
  }
}
