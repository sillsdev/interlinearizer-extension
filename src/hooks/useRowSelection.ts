import { logger } from '@papi/frontend';
import { useCallback, useMemo, useState } from 'react';
import { fetchCatalogPositions, useCatalogPositions } from '../cache/catalogHooks';
import { usePageSession } from '../cache/pageHooks';
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

  const positions = useCatalogPositions(request, chosenIds.length > 0 ? chosenIds : undefined);

  const keptIds = positions && chosenIds.filter((id) => positions.has(id));
  if (keptIds && keptIds.length < chosenIds.length) setChosenIds(keptIds);

  const checkedIds = useMemo(() => new Set(chosenIds), [chosenIds]);

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
      fetchCatalogPositions(sessionId, request)
        .then((all) => setChosenIds(all.map(([analysisId]) => analysisId)))
        .catch((e) => logger.warn('Interlinearizer: could not list the catalog rows to check', e));
    },
    [sessionId, request],
  );

  return useMemo(
    () => ({ checkedIds, orderedCheckedIds, setChecked, setAllChecked }),
    [checkedIds, orderedCheckedIds, setChecked, setAllChecked],
  );
}
