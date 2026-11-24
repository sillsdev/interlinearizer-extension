import { logger } from '@papi/frontend';
import type { AnalysisQuery, SessionAnalysisChange } from 'interlinearizer';
import { useCallback, useEffect, useRef, useState } from 'react';
import useLatestRef from '../hooks/useLatestRef';
import useSessionChange from '../hooks/useSessionChange';
import { usePageSession } from './pageHooks';

/**
 * How many of the session's reported changes have named `query` since the caller mounted, leaving
 * out each change that `counts` rejects. Each counted change re-renders the caller.
 *
 * With a list of queries, a change counts once however many of them it names.
 */
export function useNamedChanges(
  query: AnalysisQuery | readonly AnalysisQuery[],
  counts?: (change: SessionAnalysisChange) => boolean,
): number {
  const { sessionId } = usePageSession();
  const [count, setCount] = useState(0);
  useSessionChange(sessionId, (change) => {
    const queries = typeof query === 'string' ? [query] : query;
    if (!change.queries.some((named) => queries.includes(named))) return;
    if (!counts || counts(change)) setCount((was) => was + 1);
  });
  return count;
}

/**
 * Whether a reported change may alter the answer held for a {@link useNamedFetch} key. Answering
 * `false` skips the fetch that the change would start, so it must answer `true` whenever it cannot
 * rule the change out.
 */
export type ChangeAffects<T> = (change: SessionAnalysisChange, answer: T) => boolean;

/** How {@link useNamedFetch} treats the answers it holds. */
export type NamedFetchOptions<T> = Readonly<{
  /** Whether to serve the last answer until the next arrives, and after a failed fetch. */
  keepPrevious?: boolean;
  /** Rules out the changes that leave the answer held as it is; absent, every change counts. */
  affects?: ChangeAffects<T>;
}>;

/** What {@link useNamedFetch} answers for its key. */
export type NamedFetch<T> = Readonly<{
  /** The answer to show; `undefined` until one arrives. */
  value: T | undefined;
  /** Whether the latest fetch failed. Stays set while a retry is fetched. */
  failed: boolean;
  /** Whether a retry after a failed fetch has yet to answer. */
  retrying: boolean;
  /**
   * Whether a change that names the query has arrived since the fetch of the held answer began. The
   * answer may then no longer hold, until a later fetch answers.
   */
  outdated: boolean;
  /** Fetches again for the key. */
  retry: () => void;
}>;

/**
 * Fetches with `fetch` for each `key` of the session, and again whenever the caller retries or a
 * change to the session names `query`. A list of queries matches a change that names any of them.
 * Logs a failed fetch as one of `what`. Nothing is fetched while `key` is `undefined`.
 *
 * Given `affects`, a change that names `query` is skipped when `affects` rules it out for the
 * answer held. `affects` is asked only while that answer is the latest for `key` and did not fail.
 * It is not asked while a fetch is under way, because that fetch may have read the analysis before
 * the change.
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
  { keepPrevious = false, affects }: NamedFetchOptions<T> = {},
): NamedFetch<T> | undefined {
  const { sessionId } = usePageSession();
  const fetchRef = useLatestRef(fetch);
  const sessionKey = key === undefined ? undefined : JSON.stringify([sessionId, key]);
  const [retries, setRetries] = useState(0);
  const [followUps, setFollowUps] = useState(0);
  const running = useRef<{ abandoned: boolean; outdated: boolean } | undefined>(undefined);
  const [answer, setAnswer] = useState<
    | Readonly<{
        key: string;
        value: T | undefined;
        failed: boolean;
        retries: number;
        changes: number;
      }>
    | undefined
  >(undefined);
  const held = useLatestRef({ sessionKey, answer, affects });
  const changes = useNamedChanges(query, (change) => {
    const { sessionKey: heldKey, answer: heldAnswer, affects: heldAffects } = held.current;
    if (!heldAffects || running.current) return true;
    if (!heldAnswer || heldAnswer.key !== heldKey || heldAnswer.failed) return true;
    /* v8 ignore next -- an answer fetched without failing is never undefined here */
    if (heldAnswer.value === undefined) return true;
    return heldAffects(change, heldAnswer.value);
  });
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
        if (!run.abandoned) setAnswer({ key: sessionKey, value, failed: false, retries, changes });
      } catch (e) {
        logger.warn(`Interlinearizer: could not fetch ${what}`, e);
        if (!run.abandoned)
          setAnswer((was) => ({
            key: sessionKey,
            value: keepPrevious ? was?.value : undefined,
            failed: true,
            retries,
            // A kept answer stays as outdated as it was, because no later fetch has answered.
            changes: keepPrevious && was?.key === sessionKey ? was.changes : changes,
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
      outdated: answer.changes !== changes,
      retry,
    };
  return {
    value: keepPrevious ? answer?.value : undefined,
    failed: false,
    retrying: false,
    outdated: false,
    retry,
  };
}
