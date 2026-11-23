import papi, { logger } from '@papi/frontend';
import type { AnalysisQuery, SessionAnalysisChange } from 'interlinearizer';
import { useCallback, useMemo } from 'react';
import type {
  ConcordanceOccurrencePage,
  ConcordancePage,
} from '../services/sessionConcordanceHandlers';
import type { TextReadStatus } from '../types/text-read-status';
import { useNamedFetch } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

/** A change that names any of these queries leaves a concordance answer out of date. */
const CONCORDANCE_QUERIES: readonly AnalysisQuery[] = ['getConcordance', 'getTextReadStatus'];

/**
 * Whether `change` may alter what the concordance answers about any of the normalized `forms`.
 * Answers `true` whenever the change cannot be ruled out.
 *
 * A change to the analysis alters a form's row or occurrences only through the approvals filed
 * under the form, or the analyses those approvals name. A change that touches either lists the form
 * among its `forms`, folded as the concordance folds its rows. That holds because approving an
 * analysis for a token refuses a token that folds unlike the analysis. The order of the rows
 * changes only with the text. A change to the text names the read status or a book whole. A change
 * that lists no forms may alter every answer, as a switch of the analysis language does.
 */
export function mayAlterConcordance(
  change: SessionAnalysisChange,
  forms: ReadonlySet<string>,
): boolean {
  if (change.queries.includes('getTextReadStatus')) return true;
  if (change.forms.length === 0) return true;
  if (change.books.some(({ ranges }) => !ranges)) return true;
  return change.forms.some((form) => forms.has(form));
}

/** A page of the session's concordance, as the panel reads it. */
export type ConcordanceView = ConcordancePage &
  Readonly<{
    /** Fetches the page again; `undefined` unless the latest fetch of it failed. */
    retry: (() => void) | undefined;
  }>;

/**
 * The first `count` rows of the session's concordance, counted against `currentBook`. Fetched again
 * whenever a change names the concordance or the text's read status, unless the change provably
 * leaves every row on the page as it was. Keeps the last page while the next is fetched. A failed
 * fetch leaves the last page too, with {@link ConcordanceView.retry} set.
 *
 * @returns `null` until the whole text has been read; `undefined` until the first answer arrives.
 */
export function useConcordanceView(
  currentBook: string,
  count: number,
): ConcordanceView | null | undefined {
  const { sessionId } = usePageSession();
  const fetched = useNamedFetch(
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
    {
      keepPrevious: true,
      affects: (change, held) =>
        !held || mayAlterConcordance(change, new Set(held.rows.map(({ form }) => form))),
    },
  );
  const page = fetched?.value;
  const retry = fetched?.failed ? fetched.retry : undefined;
  return useMemo(() => page && { ...page, retry }, [page, retry]);
}

/**
 * The first `count` occurrences of `form` in the session's text, with the analyses its occurrences
 * are approved to, glossed in the session's language. Fetched again whenever a change names the
 * concordance or the text's read status, unless the change provably leaves `form` as it was. Kept
 * while the next answer is fetched, until `form` is `undefined`.
 *
 * @returns `undefined` while `form` is `undefined`, and until the first answer arrives.
 */
export function useConcordanceOccurrences(
  form: string | undefined,
  count: number,
): ConcordanceOccurrencePage | undefined {
  const { sessionId } = usePageSession();
  return useNamedFetch(
    CONCORDANCE_QUERIES,
    "a form's occurrences",
    form === undefined ? undefined : JSON.stringify([form, count]),
    async (): Promise<ConcordanceOccurrencePage> =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getConcordance', {
          sessionId,
          /* v8 ignore next -- fetched only under a key, which a form gives */
          request: { form: form ?? '', offset: 0, count },
        }),
      ),
    {
      keepPrevious: true,
      /* v8 ignore next -- consulted only for an answer held under a key, which a form gives */
      affects: (change) => mayAlterConcordance(change, new Set(form === undefined ? [] : [form])),
    },
  )?.value;
}

/**
 * How far the session's whole-text read has got. Asking while the text is `wanted` starts the read.
 *
 * @returns `'error'` when the latest fetch of the status failed; `undefined` while the text is not
 *   `wanted`, and until the first answer arrives.
 */
export function useTextReadStatus(wanted: boolean): TextReadStatus | 'error' | undefined {
  const { sessionId } = usePageSession();
  const status = useNamedFetch(
    'getTextReadStatus',
    "the session's text read",
    wanted ? 'text' : undefined,
    async (): Promise<TextReadStatus> =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getTextReadStatus', { sessionId }),
      ),
    { keepPrevious: true },
  );
  return status?.failed ? 'error' : status?.value;
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
