import papi, { logger } from '@papi/frontend';
import { useCallback, useEffect, useState } from 'react';
import type {
  ConcordanceOccurrencePage,
  ConcordancePage,
} from '../services/sessionConcordanceHandlers';
import { useNamedChanges } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

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
  const changes = useNamedChanges('getConcordance');
  const readChanges = useNamedChanges('getTextReadStatus');
  const [page, setPage] = useState<ConcordancePage | null | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    (async () => {
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getConcordance', {
          sessionId,
          request: { currentBook, offset: 0, count },
        });
        if (isCurrent) setPage(JSON.parse(json));
      } catch (e) {
        logger.warn('Interlinearizer: could not fetch the concordance', e);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [sessionId, currentBook, count, changes, readChanges]);
  return page;
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
  const changes = useNamedChanges('getConcordance');
  const readChanges = useNamedChanges('getTextReadStatus');
  const [page, setPage] = useState<ConcordanceOccurrencePage | undefined>(undefined);
  // Dropped once no form is given, so the next form asked for starts without the last one's answer.
  if (form === undefined && page !== undefined) setPage(undefined);
  useEffect(() => {
    if (form === undefined) return undefined;
    let isCurrent = true;
    (async () => {
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getConcordance', {
          sessionId,
          request: { form, offset: 0, count },
        });
        if (isCurrent) setPage(JSON.parse(json));
      } catch (e) {
        logger.warn("Interlinearizer: could not fetch a form's occurrences", e);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [sessionId, analysisLanguage, form, count, changes, readChanges]);
  return page;
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
