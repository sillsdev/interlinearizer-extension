import papi, { logger } from '@papi/frontend';
import type { AnalysisQuery } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  restoreUntagged,
  type CatalogPageRow,
  type SelectionSummary,
} from '../services/catalogPages';
import type { CatalogRowsRequest } from '../services/sessionCatalogHandlers';
import type {
  ConcordanceOccurrencePage,
  ConcordancePage,
} from '../services/sessionConcordanceHandlers';
import type { StaleSummary } from '../types/segment-pages';
import type { TextReadStatus } from '../types/text-read-status';
import type { CatalogFacets, CatalogRow } from '../utils/analysis-query';
import type { AnalysisDeletionOutcome } from '../utils/analysis-selectors';
import useLatestRef from '../hooks/useLatestRef';
import { usePageSession } from './pageHooks';

/** A row as the host sends it, its books listed. */
type WireRow<T extends CatalogRow> = Omit<T, 'books'> & { books: string[] };

/** A row as the host sent it, its books gathered back into a set. */
function fromWire<T extends CatalogRow>(
  row: WireRow<T>,
): Omit<T, 'books'> & { books: ReadonlySet<string> } {
  return { ...row, books: new Set(row.books) };
}

/**
 * How many of the session's reported changes have named `query` since the caller mounted. Each one
 * re-renders the caller.
 */
function useNamedChanges(query: AnalysisQuery): number {
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
type NamedFetchState<T> = Readonly<{
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
function useNamedFetchState<T>(
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
function useNamedFetch<T>(
  query: AnalysisQuery,
  what: string,
  key: string | undefined,
  fetch: () => Promise<T>,
): T | undefined {
  return useNamedFetchState(query, what, key, fetch).answer;
}

/** A page of the session's catalog, as the panel reads it. */
export type CatalogView = Readonly<{
  rows: readonly CatalogPageRow[];
  keptIds: readonly string[];
  facets: CatalogFacets;
  rowCount: number;
}>;

/**
 * The first `count` rows of the session's catalog that `request` keeps, with the ids of every kept
 * row. The page is fetched again whenever `request` or `count` changes, or a change names the
 * catalog.
 *
 * The last page stays while the next is fetched, so a changed query leaves the list on screen until
 * its rows arrive.
 */
export function useCatalogView(
  request: Omit<CatalogRowsRequest, 'offset' | 'count'>,
  count: number,
): CatalogView | undefined {
  const { sessionId } = usePageSession();
  const changes = useNamedChanges('getCatalogRows');
  const [view, setView] = useState<CatalogView | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    (async () => {
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getCatalogRows', {
          sessionId,
          request: { ...request, offset: 0, count },
        });
        if (!isCurrent) return;
        const page = JSON.parse(json);
        setView({ ...page, rows: page.rows.map(fromWire), facets: restoreUntagged(page.facets) });
      } catch (e) {
        logger.warn('Interlinearizer: could not fetch the catalog', e);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [sessionId, request, count, changes]);
  return view;
}

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

/**
 * How far the session's whole-text read has got, or `'error'` when the read could not start. Asking
 * starts the read.
 *
 * @returns `undefined` while the text is not `wanted`, and until the first answer arrives.
 */
export function useTextReadStatus(wanted: boolean): TextReadStatus | 'error' | undefined {
  const { sessionId } = usePageSession();
  const changes = useNamedChanges('getTextReadStatus');
  const [status, setStatus] = useState<TextReadStatus | 'error' | undefined>(undefined);
  useEffect(() => {
    if (!wanted) return undefined;
    let isCurrent = true;
    (async () => {
      try {
        const json = await papi.commands.sendCommand('interlinearizer.getTextReadStatus', {
          sessionId,
        });
        if (isCurrent) setStatus(JSON.parse(json));
      } catch (e) {
        logger.warn("Interlinearizer: could not read the session's text", e);
        if (isCurrent) setStatus('error');
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [sessionId, wanted, changes]);
  return wanted ? status : undefined;
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

/**
 * The rows of the analyses `analysisIds` names, by id, leaving out analyses no longer stored;
 * `undefined` until the rows for these ids arrive.
 */
export function useCatalogRowsByIds(
  analysisIds: readonly string[],
  currentBook: string,
): ReadonlyMap<string, CatalogRow> | undefined {
  const { sessionId, analysisLanguage } = usePageSession();
  const key = JSON.stringify([analysisLanguage, currentBook, analysisIds]);
  return useNamedFetch('getCatalogRows', 'catalog rows', key, async () => {
    const json = await papi.commands.sendCommand('interlinearizer.getCatalogRowsByIds', {
      sessionId,
      currentBook,
      analysisIds,
    });
    const rows: WireRow<CatalogRow>[] = JSON.parse(json);
    return new Map(rows.map((row) => [row.analysisId, fromWire(row)]));
  });
}

/**
 * The rows sharing the surface form of the analysis `analysisId` names, most used first;
 * `undefined` while `analysisId` is `undefined`, and until the rows arrive.
 */
export function useHomographRows(
  analysisId: string | undefined,
  currentBook: string,
): readonly CatalogRow[] | undefined {
  const { sessionId, analysisLanguage } = usePageSession();
  const key =
    analysisId === undefined
      ? undefined
      : JSON.stringify([analysisLanguage, currentBook, analysisId]);
  return useNamedFetch('getCatalogRows', 'homographs', key, async () => {
    const json = await papi.commands.sendCommand('interlinearizer.getHomographRows', {
      sessionId,
      currentBook,
      /* v8 ignore next -- fetched only under a key, which an id gives */
      analysisId: analysisId ?? '',
    });
    const rows: WireRow<CatalogRow>[] = JSON.parse(json);
    return rows.map(fromWire);
  });
}

/**
 * What a bulk action over the selected analyses would reach; `undefined` while none is selected and
 * until it arrives.
 */
export function useSelectionSummary(analysisIds: readonly string[]): SelectionSummary | undefined {
  const { sessionId, analysisLanguage } = usePageSession();
  const key =
    analysisIds.length === 0 ? undefined : JSON.stringify([analysisLanguage, analysisIds]);
  return useNamedFetch('getCatalogRows', 'the selection summary', key, async () =>
    JSON.parse(
      await papi.commands.sendCommand('interlinearizer.getSelectionSummary', {
        sessionId,
        analysisIds,
      }),
    ),
  );
}

/** What the host has said so far about deleting an analysis. */
export type DeletionPreviewState =
  | Readonly<{ status: 'loading' }>
  /** The host could not say; `retry` asks again. */
  | Readonly<{ status: 'failed'; retry: () => void }>
  /** No analysis carries the id. */
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'ready'; outcome: AnalysisDeletionOutcome }>;

/**
 * What deleting the analysis `analysisId` names would do, fetched again whenever a change to the
 * session names the catalog.
 */
export function useDeletionPreview(analysisId: string): DeletionPreviewState {
  const { sessionId, analysisLanguage } = usePageSession();
  const { answer, failed, retry } = useNamedFetchState<AnalysisDeletionOutcome | 'missing'>(
    'getCatalogRows',
    'the deletion preview',
    JSON.stringify([analysisLanguage, analysisId]),
    async () =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.previewDeletion', {
          sessionId,
          analysisId,
        }),
      ) ?? 'missing',
  );
  if (answer === 'missing') return { status: 'missing' };
  if (answer) return { status: 'ready', outcome: answer };
  return failed ? { status: 'failed', retry } : { status: 'loading' };
}

/** The stale analyses that the session's draft holds in `bookId`; `undefined` until they arrive. */
export function useStaleSummary(bookId: string): StaleSummary | undefined {
  const { sessionId } = usePageSession();
  return useNamedFetch(
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
  );
}

/** One-off catalog reads, for a count or a row an edit needs before it is sent. */
export function useCatalogReads(currentBook: string) {
  const { sessionId } = usePageSession();
  return useMemo(
    () => ({
      countUsages: (analysisIds: readonly string[]) =>
        papi.commands.sendCommand('interlinearizer.countUsages', { sessionId, analysisIds }),
      previewDeletion: async (analysisId: string): Promise<AnalysisDeletionOutcome | undefined> => {
        const outcome = JSON.parse(
          await papi.commands.sendCommand('interlinearizer.previewDeletion', {
            sessionId,
            analysisId,
          }),
        );
        /* v8 ignore next -- the panel previews only ids its rows hold, which always resolve */
        return outcome ?? undefined;
      },
      rowsByIds: async (analysisIds: readonly string[]): Promise<CatalogRow[]> => {
        const json = await papi.commands.sendCommand('interlinearizer.getCatalogRowsByIds', {
          sessionId,
          currentBook,
          analysisIds,
        });
        const rows: WireRow<CatalogRow>[] = JSON.parse(json);
        return rows.map(fromWire);
      },
    }),
    [sessionId, currentBook],
  );
}
