import papi, { logger } from '@papi/frontend';
import type { AnalysisQuery } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import { usePageSession } from './pageHooks';

/**
 * How many of the session's reported changes have named `query` since the caller mounted. Each one
 * re-renders the caller.
 */
export function useNamedChanges(query: AnalysisQuery): number {
  const { sessionId } = usePageSession();
  const [count, setCount] = useState(0);
  const event = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onAnalysisChanged'),
    [],
  );
  useEvent(
    event,
    useCallback(
      (change: NetworkEvents['interlinearizer.onAnalysisChanged']) => {
        if (
          'sessionId' in change &&
          change.sessionId === sessionId &&
          change.queries.includes(query)
        )
          setCount((was) => was + 1);
      },
      [sessionId, query],
    ),
  );
  return count;
}

/** What {@link useNamedFetchState} holds for its key. */
export type NamedFetchState<T> = Readonly<{
  /** The latest answer for the key; `undefined` until one arrives. */
  answer: T | undefined;
  /** Whether the latest fetch failed while no answer for the key is held. */
  failed: boolean;
  /** Fetches again for the key. */
  retry: () => void;
}>;

/**
 * Fetches with `fetch` for each `key`, and again whenever a change to the session names `query` or
 * the caller retries. Logs a failed fetch as one of `what`.
 *
 * A failed fetch leaves the last answer for `key` in place. Nothing is fetched while `key` is
 * `undefined`.
 */
export function useNamedFetchState<T>(
  query: AnalysisQuery,
  what: string,
  key: string | undefined,
  fetch: () => Promise<T>,
): NamedFetchState<T> {
  const changes = useNamedChanges(query);
  const fetchRef = useLatestRef(fetch);
  const [answer, setAnswer] = useState<Readonly<{ key: string; value: T }> | undefined>(undefined);
  const [failedKey, setFailedKey] = useState<string | undefined>(undefined);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (key === undefined) return undefined;
    let isCurrent = true;
    (async () => {
      try {
        const value = await fetchRef.current();
        if (!isCurrent) return;
        setAnswer({ key, value });
        setFailedKey(undefined);
      } catch (e) {
        logger.warn(`Interlinearizer: could not fetch ${what}`, e);
        if (isCurrent) setFailedKey(key);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [key, changes, retries, what, fetchRef]);
  const retry = useCallback(() => {
    setFailedKey(undefined);
    setRetries((was) => was + 1);
  }, []);
  const current = answer && answer.key === key ? answer.value : undefined;
  return { answer: current, failed: current === undefined && failedKey === key, retry };
}

/**
 * Fetches with `fetch` for each `key`, and again whenever a change to the session names `query`.
 * Logs a failed fetch as one of `what`.
 *
 * @returns The latest answer for `key`; `undefined` while `key` is `undefined`, and until an answer
 *   for `key` arrives. A failed fetch leaves the last answer for `key` in place.
 */
export function useNamedFetch<T>(
  query: AnalysisQuery,
  what: string,
  key: string | undefined,
  fetch: () => Promise<T>,
): T | undefined {
  return useNamedFetchState(query, what, key, fetch).answer;
}
