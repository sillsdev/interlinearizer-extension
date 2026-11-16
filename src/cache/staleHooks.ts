import papi from '@papi/frontend';
import type { StaleSummary } from '../types/segment-pages';
import { useNamedFetch } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

/**
 * The stale analyses that the session's draft holds in `bookId`; `undefined` until they arrive,
 * when the source has no text for the book, and after a fetch of them fails.
 */
export function useStaleSummary(bookId: string): StaleSummary | undefined {
  const { sessionId } = usePageSession();
  return useNamedFetch<StaleSummary | undefined>(
    'getStaleSummary',
    'the stale summary',
    `${sessionId} ${bookId}`,
    async () => {
      const json = await papi.commands.sendCommand('interlinearizer.getStaleSummary', {
        sessionId,
        bookId,
      });
      /* v8 ignore next -- defensive: the notice asks only of a book whose text has loaded */
      return json === undefined ? undefined : JSON.parse(json);
    },
  )?.value;
}
