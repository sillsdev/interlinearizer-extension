/**
 * @file Jest mock for platform-bible-utils. Exposes only UnsubscriberAsyncList so test-helpers can build
 * ExecutionActivationContext without loading the real package (which pulls in ESM deps).
 */

/** Unsubscriber callback: sync or async function run on teardown. */
type UnsubscriberFn = () => void | Promise<unknown>;

/** Either a callable unsubscriber or an object with a dispose method. */
type UnsubscriberInput = UnsubscriberFn | { dispose: UnsubscriberFn };

class UnsubscriberAsyncList {
  name: string;

  /** Set of callables to run on teardown (bound dispose() or raw functions). */
  unsubscribers: Set<UnsubscriberFn>;

  constructor(name = 'Anonymous') {
    this.name = name;
    this.unsubscribers = new Set<UnsubscriberFn>();
  }

  /**
   * Registers one or more unsubscribers. Accepts either a no-arg function (sync or async) or an
   * object with a dispose() method; in the latter case the bound dispose is stored.
   */
  add(...unsubscribers: UnsubscriberInput[]): void {
    unsubscribers.forEach((unsubscriber) => {
      if (
        typeof unsubscriber === 'object' &&
        unsubscriber !== null &&
        'dispose' in unsubscriber &&
        typeof (unsubscriber as { dispose: UnsubscriberFn }).dispose === 'function'
      ) {
        this.unsubscribers.add(
          (unsubscriber as { dispose: UnsubscriberFn }).dispose.bind(unsubscriber)
        );
      } else if (typeof unsubscriber === 'function') {
        this.unsubscribers.add(unsubscriber as UnsubscriberFn);
      }
    });
  }

  /**
   * Runs all registered unsubscribers (awaiting any promises) and clears the set.
   * @returns true if every unsubscriber returned a truthy value.
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
  message: string;
  platformErrorVersion: number;
}

const isPlatformError = (value: unknown): value is PlatformError =>
  typeof value === 'object' && value !== null && 'platformErrorVersion' in (value as object);

export { UnsubscriberAsyncList, isPlatformError };
