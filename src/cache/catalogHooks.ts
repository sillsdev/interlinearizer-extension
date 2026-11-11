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
import type { TextReadStatus } from '../types/text-read-status';
import type { CatalogFacets, CatalogRow } from '../utils/analysis-query';
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
  const changes = useNamedChanges(query);
  const fetchRef = useLatestRef(fetch);
  const [answer, setAnswer] = useState<Readonly<{ key: string; value: T }> | undefined>(undefined);
  useEffect(() => {
    if (key === undefined) return undefined;
    let isCurrent = true;
    (async () => {
      try {
        const value = await fetchRef.current();
        if (isCurrent) setAnswer({ key, value });
      } catch (e) {
        logger.warn(`Interlinearizer: could not fetch ${what}`, e);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [key, changes, what, fetchRef]);
  return answer && answer.key === key ? answer.value : undefined;
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

/** One-off catalog reads, for a count or a row an edit needs before it is sent. */
export function useCatalogReads(currentBook: string) {
  const { sessionId } = usePageSession();
  return useMemo(
    () => ({
      countUsages: (analysisIds: readonly string[]) =>
        papi.commands.sendCommand('interlinearizer.countUsages', { sessionId, analysisIds }),
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
