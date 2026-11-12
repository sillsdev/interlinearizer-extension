import { logger } from '@papi/frontend';
import type { AnalysisQuery } from 'interlinearizer';
import { useCallback, useEffect, useState } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import useSessionChange from '../hooks/useSessionChange';
import { usePageSession } from './pageHooks';

/**
 * How many of the session's reported changes have named `query` since the caller mounted. Each one
 * re-renders the caller.
 */
export function useNamedChanges(query: AnalysisQuery): number {
  const { sessionId } = usePageSession();
  const [count, setCount] = useState(0);
  useSessionChange(sessionId, (change) => {
    if (change.queries.includes(query)) setCount((was) => was + 1);
  });
  return count;
}

/** What {@link useNamedFetch} answers for its key. */
export type NamedFetch<T> = Readonly<{
  /** The answer to show; `undefined` until one arrives. */
  value: T | undefined;
  /** Whether the latest fetch failed. */
  failed: boolean;
  /** Fetches again for the key. */
  retry: () => void;
}>;

/**
 * Fetches with `fetch` for each `key` of the session, and again whenever a change to the session
 * names `query` or the caller retries. Logs a failed fetch as one of `what`. Nothing is fetched
 * while `key` is `undefined`.
 *
 * @returns `undefined` while `key` is `undefined`. Otherwise the latest answer for `key`, with
 *   whether the latest fetch failed; a failed fetch leaves the answer in place. Until an answer for
 *   `key` arrives, the answer is `undefined`, or the last key's answer with `keepPrevious`.
 */
export function useNamedFetch<T>(
  query: AnalysisQuery,
  what: string,
  key: string | undefined,
  fetch: () => Promise<T>,
  keepPrevious = false,
): NamedFetch<T> | undefined {
  const { sessionId } = usePageSession();
  const changes = useNamedChanges(query);
  const fetchRef = useLatestRef(fetch);
  const sessionKey = key === undefined ? undefined : JSON.stringify([sessionId, key]);
  const [answer, setAnswer] = useState<
    Readonly<{ key: string; value: T | undefined; failed: boolean }> | undefined
  >(undefined);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    if (sessionKey === undefined) return undefined;
    let isCurrent = true;
    (async () => {
      try {
        const value = await fetchRef.current();
        if (isCurrent) setAnswer({ key: sessionKey, value, failed: false });
      } catch (e) {
        logger.warn(`Interlinearizer: could not fetch ${what}`, e);
        if (isCurrent)
          setAnswer((was) => ({
            key: sessionKey,
            value: was?.key === sessionKey || keepPrevious ? was?.value : undefined,
            failed: true,
          }));
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [sessionKey, changes, retries, what, fetchRef, keepPrevious]);
  const retry = useCallback(() => {
    /* v8 ignore next -- callers offer a retry only after a failure, so an answer is held */
    setAnswer((was) => was && { ...was, failed: false });
    setRetries((was) => was + 1);
  }, []);
  if (sessionKey === undefined) return undefined;
  if (answer?.key === sessionKey) return { value: answer.value, failed: answer.failed, retry };
  return { value: keepPrevious ? answer?.value : undefined, failed: false, retry };
}
