import papi from '@papi/frontend';
import { useMemo } from 'react';
import {
  restoreUntagged,
  type CatalogPageRow,
  type SelectionSummary,
} from '../services/catalogPages';
import type { CatalogRowsRequest } from '../services/sessionCatalogHandlers';
import type { StaleSummary } from '../types/segment-pages';
import type { TextReadStatus } from '../types/text-read-status';
import type { CatalogFacets, CatalogRow } from '../utils/analysis-query';
import type { AnalysisDeletionOutcome } from '../utils/analysis-selectors';
import { useNamedFetch } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

/** A row as the host sends it, its books listed. */
type WireRow<T extends CatalogRow> = Omit<T, 'books'> & { books: string[] };

/** A row as the host sent it, its books gathered back into a set. */
function fromWire<T extends CatalogRow>(
  row: WireRow<T>,
): Omit<T, 'books'> & { books: ReadonlySet<string> } {
  return { ...row, books: new Set(row.books) };
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
  const key = JSON.stringify([request, count]);
  return useNamedFetch(
    'getCatalogRows',
    'the catalog',
    key,
    async (): Promise<CatalogView> => {
      const page = JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getCatalogRows', {
          sessionId,
          request: { ...request, offset: 0, count },
        }),
      );
      return { ...page, rows: page.rows.map(fromWire), facets: restoreUntagged(page.facets) };
    },
    true,
  )?.value;
}

/**
 * How far the session's whole-text read has got, or `'error'` when the read could not start. Asking
 * starts the read.
 *
 * @returns `undefined` while the text is not `wanted`, and until the first answer arrives.
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
    true,
  );
  return status?.failed ? 'error' : status?.value;
}

/** The rows of the analyses `analysisIds` names, in that order, leaving out unstored ids. */
async function fetchRowsByIds(
  sessionId: string,
  currentBook: string,
  analysisIds: readonly string[],
): Promise<CatalogRow[]> {
  const rows: WireRow<CatalogRow>[] = JSON.parse(
    await papi.commands.sendCommand('interlinearizer.getCatalogRowsByIds', {
      sessionId,
      currentBook,
      analysisIds,
    }),
  );
  return rows.map(fromWire);
}

/**
 * The rows of the analyses `analysisIds` names, by id, leaving out analyses no longer stored;
 * `undefined` until the rows for these ids arrive, and after a fetch of them fails.
 */
export function useCatalogRowsByIds(
  analysisIds: readonly string[],
  currentBook: string,
): ReadonlyMap<string, CatalogRow> | undefined {
  const { sessionId } = usePageSession();
  const key = JSON.stringify([currentBook, analysisIds]);
  return useNamedFetch('getCatalogRows', 'catalog rows', key, async () => {
    const rows = await fetchRowsByIds(sessionId, currentBook, analysisIds);
    return new Map(rows.map((row) => [row.analysisId, row]));
  })?.value;
}

/**
 * The rows sharing the surface form of the analysis `analysisId` names, most used first;
 * `undefined` while `analysisId` is `undefined`, until the rows arrive, and after a fetch of them
 * fails.
 */
export function useHomographRows(
  analysisId: string | undefined,
  currentBook: string,
): readonly CatalogRow[] | undefined {
  const { sessionId } = usePageSession();
  const key = analysisId === undefined ? undefined : JSON.stringify([currentBook, analysisId]);
  return useNamedFetch('getCatalogRows', 'homographs', key, async () => {
    const json = await papi.commands.sendCommand('interlinearizer.getHomographRows', {
      sessionId,
      currentBook,
      /* v8 ignore next -- fetched only under a key, which an id gives */
      analysisId: analysisId ?? '',
    });
    const rows: WireRow<CatalogRow>[] = JSON.parse(json);
    return rows.map(fromWire);
  })?.value;
}

/**
 * What a bulk action over the selected analyses would reach; `undefined` while none is selected,
 * until it arrives, and after a fetch of it fails.
 */
export function useSelectionSummary(analysisIds: readonly string[]): SelectionSummary | undefined {
  const { sessionId } = usePageSession();
  const key = analysisIds.length === 0 ? undefined : JSON.stringify(analysisIds);
  return useNamedFetch('getCatalogRows', 'the selection summary', key, async () =>
    JSON.parse(
      await papi.commands.sendCommand('interlinearizer.getSelectionSummary', {
        sessionId,
        analysisIds,
      }),
    ),
  )?.value;
}

/**
 * What deleting the analysis `analysisId` names would do; `undefined` when no analysis carries the
 * id.
 */
async function fetchDeletionPreview(
  sessionId: string,
  analysisId: string,
): Promise<AnalysisDeletionOutcome | undefined> {
  const outcome: AnalysisDeletionOutcome | null = JSON.parse(
    await papi.commands.sendCommand('interlinearizer.previewDeletion', { sessionId, analysisId }),
  );
  return outcome ?? undefined;
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
  const { sessionId } = usePageSession();
  const preview = useNamedFetch<AnalysisDeletionOutcome | 'missing'>(
    'getCatalogRows',
    'the deletion preview',
    analysisId,
    async () => (await fetchDeletionPreview(sessionId, analysisId)) ?? 'missing',
  );
  /* v8 ignore next -- the key is always defined, so a fetch state always comes back */
  if (!preview) return { status: 'loading' };
  if (preview.value === 'missing') return { status: 'missing' };
  if (preview.value) return { status: 'ready', outcome: preview.value };
  return preview.failed ? { status: 'failed', retry: preview.retry } : { status: 'loading' };
}

/** The stale analyses that the session's draft holds in `bookId`; `undefined` until they arrive. */
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

/** One-off catalog reads, for a count or a row an edit needs before it is sent. */
export function useCatalogReads(currentBook: string) {
  const { sessionId } = usePageSession();
  return useMemo(
    () => ({
      countUsages: (analysisIds: readonly string[]) =>
        papi.commands.sendCommand('interlinearizer.countUsages', { sessionId, analysisIds }),
      previewDeletion: (analysisId: string) => fetchDeletionPreview(sessionId, analysisId),
      rowsByIds: (analysisIds: readonly string[]) =>
        fetchRowsByIds(sessionId, currentBook, analysisIds),
    }),
    [sessionId, currentBook],
  );
}
