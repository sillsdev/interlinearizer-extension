import papi, { logger } from '@papi/frontend';
import type { AnalysisQuery } from 'interlinearizer';
import { useCallback } from 'react';
import type {
  ConcordanceOccurrencePage,
  ConcordancePage,
} from '../services/sessionConcordanceHandlers';
import { useNamedFetch } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

/** A change that names any of these queries leaves a concordance answer out of date. */
const CONCORDANCE_QUERIES: readonly AnalysisQuery[] = ['getConcordance', 'getTextReadStatus'];

/**
 * The first `count` rows of the session's concordance, counted against `currentBook`, fetched again
 * whenever a change names the concordance or the text's read status. Keeps the last page while the
 * next is fetched.
 *
 * @returns `null` until the whole text has been read; `undefined` until the first answer arrives.
 */
export function useConcordanceView(
  currentBook: string,
  count: number,
): ConcordancePage | null | undefined {
  const { sessionId } = usePageSession();
  return useNamedFetch(
    CONCORDANCE_QUERIES,
    'the concordance',
    JSON.stringify([currentBook, count]),
    async (): Promise<ConcordancePage | null> =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getConcordance', {
          sessionId,
          request: { currentBook, offset: 0, count },
        }),
      ),
    true,
  )?.value;
}

/**
 * The first `count` occurrences of `form` in the session's text, with the analyses its occurrences
 * are approved to, glossed in the session's language. Fetched again whenever a change names the
 * concordance or the text's read status. Kept while the next answer is fetched, until `form` is
 * `undefined`.
 *
 * @returns `undefined` while `form` is `undefined`, and until the first answer arrives.
 */
export function useConcordanceOccurrences(
  form: string | undefined,
  count: number,
): ConcordanceOccurrencePage | undefined {
  const { sessionId, analysisLanguage } = usePageSession();
  return useNamedFetch(
    CONCORDANCE_QUERIES,
    "a form's occurrences",
    form === undefined ? undefined : JSON.stringify([form, count, analysisLanguage]),
    async (): Promise<ConcordanceOccurrencePage> =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getConcordance', {
          sessionId,
          /* v8 ignore next -- fetched only under a key, which a form gives */
          request: { form: form ?? '', offset: 0, count },
        }),
      ),
    true,
  )?.value;
}

/** A callback that reads again each book of the session's text whose latest read failed. */
export function useRetryTextRead(): () => void {
  const { sessionId } = usePageSession();
  return useCallback(() => {
    papi.commands.sendCommand('interlinearizer.retryTextRead', { sessionId }).catch((e) => {
      logger.warn("Interlinearizer: could not read the session's text again", e);
    });
  }, [sessionId]);
}
