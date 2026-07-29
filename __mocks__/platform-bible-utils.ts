/**
 * @file Jest mock for platform-bible-utils. Reimplements the minimal subset the extension uses so
 * tests never load the real package (which pulls in ESM deps).
 */

/** Sync unsubscriber: returns true on success. */
type Unsubscriber = () => boolean;

/** Async unsubscriber: resolves to true on success. */
type UnsubscriberAsync = () => Promise<boolean>;

/** Object that can be disposed synchronously or asynchronously. */
type Dispose = { dispose: Unsubscriber | UnsubscriberAsync };

/**
 * Minimal stand-in for the platform's unsubscriber list: collects unsubscribers and runs them all
 * on teardown.
 */
class UnsubscriberAsyncList {
  /** Set of callables to run on teardown. */
  readonly unsubscribers: Set<Unsubscriber | UnsubscriberAsync>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_name = 'Anonymous') {
    this.unsubscribers = new Set<Unsubscriber | UnsubscriberAsync>();
  }

  /**
   * Registers one or more unsubscribers. Accepts either a sync/async function returning boolean or
   * an object with a dispose() method; in the latter case the bound dispose is stored.
   */
  add(...unsubscribers: (Unsubscriber | UnsubscriberAsync | Dispose)[]): void {
    unsubscribers.forEach((unsubscriber) => {
      if (typeof unsubscriber === 'function') {
        this.unsubscribers.add(unsubscriber);
      } else if (
        typeof unsubscriber === 'object' &&
        unsubscriber !== null &&
        'dispose' in unsubscriber &&
        typeof unsubscriber.dispose === 'function'
      ) {
        this.unsubscribers.add(unsubscriber.dispose.bind(unsubscriber));
      }
    });
  }

  /**
   * Runs all registered unsubscribers (awaiting any promises) and clears the set.
   */
  async runAllUnsubscribers(): Promise<boolean> {
    const unsubs = [...this.unsubscribers].map((fn) => fn());
    const results = await Promise.all(unsubs);
    this.unsubscribers.clear();
    return results.every(Boolean);
  }
}

/**
 * Minimal PlatformError shape matching the real platform-bible-utils type. Uses `platformErrorVersion`
 * as the discriminant — the same field the real `isPlatformError` checks.
 */
interface PlatformError {
  cause?: unknown;
  code?: string;
  message: string;
  platformErrorVersion: number;
  stack?: string;
}

/**
 * Returns `true` when `error` is a {@link PlatformError}, identified by the presence of the
 * `platformErrorVersion` discriminant field.
 */
const isPlatformError = (error: unknown): error is PlatformError =>
  typeof error === 'object' &&
  error !== null &&
  'platformErrorVersion' in error &&
  typeof (error as Record<string, unknown>).platformErrorVersion === 'number' &&
  !Number.isNaN((error as Record<string, unknown>).platformErrorVersion);

export { UnsubscriberAsyncList, isPlatformError };
