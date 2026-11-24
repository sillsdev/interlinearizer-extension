import papi from '@papi/frontend';
import { useMemo } from 'react';
import {
  restoreUntagged,
  type CatalogPageRow,
  type CatalogPlaces,
  type SelectionSummary,
} from '../services/catalogPages';
import type { CatalogRowsRequest } from '../services/sessionCatalogHandlers';
import type { CatalogFacets, CatalogRow } from '../utils/analysis-query';
import type { AnalysisDeletionOutcome } from '../utils/analysis-selectors';
import { perfTrack } from '../utils/perf-marks';
import { useNamedFetch } from './namedQueryHooks';
import { usePageSession } from './pageHooks';

/** A row as the host sends it, its books listed. */
type WireRow<T extends Pick<CatalogRow, 'books'>> = Omit<T, 'books'> & { books: string[] };

/** A row as the host sent it, its books gathered back into a set. */
function fromWire<T extends Pick<CatalogRow, 'books'>>(
  row: WireRow<T>,
): Omit<T, 'books'> & { books: ReadonlySet<string> } {
  return { ...row, books: new Set(row.books) };
}

/** A page of the session's catalog, as the panel reads it. */
export type CatalogView = Readonly<{
  rows: readonly CatalogPageRow[];
  /** How many rows the request keeps, on this page and off it. */
  keptCount: number;
  facets: CatalogFacets;
  rowCount: number;
}>;

/**
 * The first `count` rows of the session's catalog that `request` keeps, with how many it keeps. The
 * page is fetched again whenever `request` or `count` changes, or a change names the catalog.
 *
 * The last page stays while the next is fetched, so a changed query leaves the list on screen until
 * its rows arrive. A failed fetch leaves the last page too, or none if no page has arrived.
 *
 * @returns The page as `view`, and as `retry` a call that fetches it again. `retry` is `undefined`
 *   unless the latest fetch failed. While a retry is fetched, `retry` stays defined and the same
 *   call.
 */
export function useCatalogView(
  request: Omit<CatalogRowsRequest, 'offset' | 'count'>,
  count: number,
): Readonly<{ view: CatalogView | undefined; retry: (() => void) | undefined }> {
  const { sessionId } = usePageSession();
  const key = JSON.stringify([request, count]);
  const fetched = useNamedFetch(
    'getCatalogRows',
    'the catalog',
    key,
    async (): Promise<CatalogView> => {
      const page = JSON.parse(
        await perfTrack(
          'catalog-fetch',
          papi.commands.sendCommand('interlinearizer.getCatalogRows', {
            sessionId,
            request: { ...request, offset: 0, count },
          }),
        ),
      );
      return { ...page, rows: page.rows.map(fromWire), facets: restoreUntagged(page.facets) };
    },
    { keepPrevious: true },
  );
  const view = fetched?.value;
  const retry = fetched?.failed ? fetched.retry : undefined;
  return useMemo(() => ({ view, retry }), [view, retry]);
}

/**
 * Where in the listing of the session's catalog that `request` asks for each kept analysis sits, in
 * listing order: those of `analysisIds`, or every kept one when `analysisIds` is absent.
 */
export async function fetchCatalogPositions(
  sessionId: string,
  request: Omit<CatalogRowsRequest, 'offset' | 'count'>,
  analysisIds?: readonly string[],
): Promise<[analysisId: string, index: number][]> {
  return JSON.parse(
    await papi.commands.sendCommand('interlinearizer.locateCatalogRows', {
      sessionId,
      request,
      analysisIds,
    }),
  );
}

/** What {@link useCatalogPositions} answers. */
export type CatalogPositions = Readonly<{
  /**
   * Where each of the ids sits, by id, leaving out those the listing does not keep. `undefined`
   * until the positions arrive, and after a fetch of them fails.
   */
  positions: ReadonlyMap<string, number> | undefined;
  /** Whether a change to the catalog has arrived since the fetch of `positions` began. */
  outdated: boolean;
  /** Fetches the positions again; present only after a fetch of them failed. */
  retry: (() => void) | undefined;
}>;

/**
 * Where in the listing of the session's catalog that `request` asks for each of `analysisIds` sits.
 * Fetched again whenever a change names the catalog. `undefined` while `analysisIds` is
 * `undefined`.
 */
export function useCatalogPositions(
  request: Omit<CatalogRowsRequest, 'offset' | 'count'>,
  analysisIds: readonly string[] | undefined,
): CatalogPositions | undefined {
  const { sessionId } = usePageSession();
  const key = analysisIds === undefined ? undefined : JSON.stringify([request, analysisIds]);
  const fetched = useNamedFetch(
    'getCatalogRows',
    'catalog positions',
    key,
    async () => new Map(await fetchCatalogPositions(sessionId, request, analysisIds)),
  );
  const positions = fetched?.value;
  const outdated = fetched?.outdated;
  const retry = fetched?.failed ? fetched.retry : undefined;
  return useMemo(
    () => (outdated === undefined ? undefined : { positions, outdated, retry }),
    [positions, outdated, retry],
  );
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

/** What the host has said so far about the places of one catalog row. */
export type CatalogPlacesState =
  | Readonly<{ status: 'loading' }>
  /** The host could not say; `retry` asks again. */
  | Readonly<{ status: 'failed'; retry: () => void }>
  /** No analysis carries the id. */
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'ready'; places: CatalogPlaces }>;

/**
 * Every place of the analysis that `analysisId` names, fetched again whenever a change to the
 * session names the catalog. Returns `undefined` while `analysisId` is `undefined`.
 */
export function useCatalogPlaces(
  analysisId: string | undefined,
  currentBook: string,
): CatalogPlacesState | undefined {
  const { sessionId } = usePageSession();
  const key = analysisId === undefined ? undefined : JSON.stringify([currentBook, analysisId]);
  const fetched = useNamedFetch<CatalogPlaces | 'missing'>(
    'getCatalogRows',
    'catalog places',
    key,
    async () => {
      const places: CatalogPlaces | null = JSON.parse(
        await papi.commands.sendCommand('interlinearizer.getCatalogPlaces', {
          sessionId,
          currentBook,
          /* v8 ignore next -- fetched only under a key, which an id gives */
          analysisId: analysisId ?? '',
        }),
      );
      return places ?? 'missing';
    },
  );
  if (!fetched) return undefined;
  if (fetched.value === 'missing') return { status: 'missing' };
  if (fetched.value) return { status: 'ready', places: fetched.value };
  return fetched.failed && !fetched.retrying
    ? { status: 'failed', retry: fetched.retry }
    : { status: 'loading' };
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
  return preview.failed && !preview.retrying
    ? { status: 'failed', retry: preview.retry }
    : { status: 'loading' };
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
