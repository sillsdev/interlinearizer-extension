import { logger } from '@papi/frontend';
import type { AnalysisQuery } from 'interlinearizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import useSessionChange from '../hooks/useSessionChange';
import { usePageSession } from './pageHooks';

/**
 * How many of the session's reported changes have named `query` since the caller mounted. Each one
 * re-renders the caller.
 *
 * With a list of queries, a change counts once however many of them it names.
 */
export function useNamedChanges(query: AnalysisQuery | readonly AnalysisQuery[]): number {
  const { sessionId } = usePageSession();
  const [count, setCount] = useState(0);
  useSessionChange(sessionId, (change) => {
    const queries = typeof query === 'string' ? [query] : query;
    if (change.queries.some((named) => queries.includes(named))) setCount((was) => was + 1);
  });
  return count;
}

/** What {@link useNamedFetch} answers for its key. */
export type NamedFetch<T> = Readonly<{
  /** The answer to show; `undefined` until one arrives. */
  value: T | undefined;
  /** Whether the latest fetch failed. Stays set while a retry is fetched. */
  failed: boolean;
  /** Whether a retry after a failed fetch has yet to answer. */
  retrying: boolean;
  /** Fetches again for the key. */
  retry: () => void;
}>;

/**
 * Fetches with `fetch` for each `key` of the session, and again whenever the caller retries or a
 * change to the session names `query`. A list of queries matches a change that names any of them.
 * Logs a failed fetch as one of `what`. Nothing is fetched while `key` is `undefined`.
 *
 * Runs one fetch at a time for a key. Changes and retries that arrive during a fetch are answered
 * by one fetch after it.
 *
 * @returns `undefined` while `key` is `undefined`. Otherwise the latest answer for `key`, with
 *   whether the latest fetch failed. Until an answer for `key` arrives, and after a failed fetch,
 *   the answer is `undefined`, or, with `keepPrevious`, the last answer. An undefined `key` drops
 *   the last answer, so the next key starts without it.
 */
export function useNamedFetch<T>(
  query: AnalysisQuery | readonly AnalysisQuery[],
  what: string,
  key: string | undefined,
  fetch: () => Promise<T>,
  keepPrevious = false,
): NamedFetch<T> | undefined {
  const { sessionId } = usePageSession();
  const changes = useNamedChanges(query);
  const fetchRef = useLatestRef(fetch);
  const sessionKey = key === undefined ? undefined : JSON.stringify([sessionId, key]);
  const [retries, setRetries] = useState(0);
  const [followUps, setFollowUps] = useState(0);
  const running = useRef<{ abandoned: boolean; outdated: boolean } | undefined>(undefined);
  const [answer, setAnswer] = useState<
    Readonly<{ key: string; value: T | undefined; failed: boolean; retries: number }> | undefined
  >(undefined);
  if (sessionKey === undefined && answer !== undefined) setAnswer(undefined);
  useEffect(
    () => () => {
      if (running.current) running.current.abandoned = true;
      running.current = undefined;
    },
    [sessionKey],
  );
  useEffect(() => {
    if (sessionKey === undefined) return;
    if (running.current) {
      running.current.outdated = true;
      return;
    }
    const run = { abandoned: false, outdated: false };
    running.current = run;
    (async () => {
      try {
        const value = await fetchRef.current();
        if (!run.abandoned) setAnswer({ key: sessionKey, value, failed: false, retries });
      } catch (e) {
        logger.warn(`Interlinearizer: could not fetch ${what}`, e);
        if (!run.abandoned)
          setAnswer((was) => ({
            key: sessionKey,
            value: keepPrevious ? was?.value : undefined,
            failed: true,
            retries,
          }));
      }
      if (run.abandoned) return;
      running.current = undefined;
      if (run.outdated) setFollowUps((was) => was + 1);
    })();
  }, [sessionKey, changes, retries, followUps, what, fetchRef, keepPrevious]);
  const retry = useCallback(() => setRetries((was) => was + 1), []);
  if (sessionKey === undefined) return undefined;
  if (answer?.key === sessionKey)
    return {
      value: answer.value,
      failed: answer.failed,
      retrying: answer.failed && answer.retries !== retries,
      retry,
    };
  return {
    value: keepPrevious ? answer?.value : undefined,
    failed: false,
    retrying: false,
    retry,
  };
}
