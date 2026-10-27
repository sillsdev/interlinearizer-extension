import { logger } from '@papi/frontend';
import type { SenseRef } from 'interlinearizer';
import type { ResolvedSense } from 'interlinearizer/lexicon';

/** Holds the place of a sense that has been asked for and not yet answered. */
const PENDING = Symbol('pending');

/**
 * The senses resolved through one set of connected lexicons. A sense is asked for only when
 * requested, never in bulk. It is asked for again only after a look-up for it rejects.
 *
 * The answers hold only for the lexicons the cache was created over, so a change of lexicon calls
 * for a fresh cache.
 */
export type SenseCache = {
  /**
   * Reads what is known of `ref` without asking for it.
   *
   * @returns The sense, or `undefined` while it is being asked for, when nothing has asked for it,
   *   after its look-up rejected, or when the lexicon has no such sense.
   */
  peek: (ref: SenseRef) => ResolvedSense | undefined;

  /**
   * Asks the lexicon for `ref` unless `ref` has been asked for already. A look-up that rejects
   * leaves nothing behind, so the next request for `ref` asks again. A look-up that answers
   * `undefined` is kept as a miss.
   */
  request: (ref: SenseRef) => void;

  /**
   * Calls `listener` each time a sense arrives.
   *
   * @returns Stops the calls.
   */
  subscribe: (listener: () => void) => () => void;
};

/** One key per sense, so refs equal in every field share an answer. */
function senseKey({ authority, projectId, senseId }: SenseRef): string {
  return JSON.stringify([authority, projectId, senseId]);
}

/** Creates an empty cache over `resolveSense`. */
export function createSenseCache(
  resolveSense: (ref: SenseRef) => Promise<ResolvedSense | undefined>,
): SenseCache {
  const senses = new Map<string, ResolvedSense | undefined | typeof PENDING>();
  const listeners = new Set<() => void>();

  return {
    peek: (ref) => {
      const sense = senses.get(senseKey(ref));
      return sense === PENDING ? undefined : sense;
    },

    request: (ref) => {
      const key = senseKey(ref);
      if (senses.has(key)) return;
      senses.set(key, PENDING);
      (async () => {
        try {
          const sense = await resolveSense(ref);
          senses.set(key, sense);
          // A miss leaves every reader where it was, so only a found sense is announced.
          if (sense) listeners.forEach((listener) => listener());
        } catch (e) {
          senses.delete(key);
          logger.debug('Interlinearizer: a lexicon sense could not be resolved', e);
        }
      })();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
