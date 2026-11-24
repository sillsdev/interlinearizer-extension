import { logger } from '@papi/frontend';
import { useCallback, useMemo, useState } from 'react';
import { fetchCatalogPositions, useCatalogPositions } from '../cache/catalogHooks';
import { useNamedChanges } from '../cache/namedQueryHooks';
import { usePageSession } from '../cache/pageHooks';
import useLatestRef from './useLatestRef';
import type { CatalogRowsRequest } from '../services/sessionCatalogHandlers';

/** The rows a bulk action applies to, with the controls that choose them. */
export type RowSelection = Readonly<{
  /** The checked rows, by analysis id. */
  checkedIds: ReadonlySet<string>;
  /**
   * The checked rows in listing order, those the host has yet to place coming last in the order
   * they were checked.
   */
  orderedCheckedIds: readonly string[];
  /**
   * Whether the host has confirmed that the listing keeps every checked row. Until it has, the
   * checked rows may include some the listing has since dropped, so a bulk action must wait.
   */
  isSettled: boolean;
  setChecked: (analysisId: string, checked: boolean) => void;
  /** Checks every row the listing keeps, once the host lists them, or unchecks them all. */
  setAllChecked: (checked: boolean) => void;
}>;

/**
 * Tracks which rows of the catalog listing that `request` asks for the reader has checked for a
 * bulk action. A checked row the host reports the listing no longer keeps is unchecked for good, so
 * an action never reaches a row the reader cannot see and widening the listing again does not bring
 * it back checked.
 */
export default function useRowSelection(
  request: Omit<CatalogRowsRequest, 'offset' | 'count'>,
): RowSelection {
  const { sessionId } = usePageSession();

  /** The rows the reader checked, some of which the listing may have since dropped. */
  const [chosenIds, setChosenIds] = useState<readonly string[]>([]);

  /**
   * The positions that Check All fetched, which confirm the checked rows without a second fetch
   * until the rows, the request or the catalog change.
   */
  const [checkedAll, setCheckedAll] = useState<
    | Readonly<{
        ids: readonly string[];
        request: Omit<CatalogRowsRequest, 'offset' | 'count'>;
        changes: number;
        positions: ReadonlyMap<string, number>;
      }>
    | undefined
  >(undefined);

  const changes = useNamedChanges('getCatalogRows');
  const changesRef = useLatestRef(changes);
  const seeded =
    checkedAll &&
    checkedAll.ids === chosenIds &&
    checkedAll.request === request &&
    checkedAll.changes === changes
      ? checkedAll.positions
      : undefined;

  const fetched = useCatalogPositions(
    request,
    !seeded && chosenIds.length > 0 ? chosenIds : undefined,
  );
  const positions = seeded ?? fetched;

  const keptIds = positions && chosenIds.filter((id) => positions.has(id));
  if (keptIds && keptIds.length < chosenIds.length) setChosenIds(keptIds);

  const checkedIds = useMemo(() => new Set(chosenIds), [chosenIds]);

  const isSettled = chosenIds.length === 0 || positions !== undefined;

  const orderedCheckedIds = useMemo(() => {
    const placed = chosenIds.flatMap((id): [string, number][] => {
      const index = positions?.get(id);
      return index === undefined ? [] : [[id, index]];
    });
    placed.sort(([, a], [, b]) => a - b);
    return [
      ...placed.map(([id]) => id),
      ...chosenIds.filter((id) => positions?.get(id) === undefined),
    ];
  }, [chosenIds, positions]);

  const setChecked = useCallback((analysisId: string, checked: boolean) => {
    setChosenIds((ids) => {
      const rest = ids.filter((id) => id !== analysisId);
      return checked ? [...rest, analysisId] : rest;
    });
  }, []);

  const setAllChecked = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setChosenIds([]);
        return;
      }
      // Read before the fetch starts, so a change that lands during the fetch discards the positions.
      const changesAsked = changesRef.current;
      (async () => {
        try {
          const all = await fetchCatalogPositions(sessionId, request);
          const ids = all.map(([analysisId]) => analysisId);
          setChosenIds(ids);
          setCheckedAll({ ids, request, changes: changesAsked, positions: new Map(all) });
        } catch (e) {
          logger.warn('Interlinearizer: could not list the catalog rows to check', e);
        }
      })();
    },
    [sessionId, request, changesRef],
  );

  return useMemo(
    () => ({ checkedIds, orderedCheckedIds, isSettled, setChecked, setAllChecked }),
    [checkedIds, orderedCheckedIds, isSettled, setChecked, setAllChecked],
  );
}
