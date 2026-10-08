import { useCallback, useEffect, useMemo, useState } from 'react';

/** The rows a bulk action applies to, with the controls that choose them. */
export type RowSelection = Readonly<{
  /** The checked rows the listing still holds, by analysis id. */
  checkedIds: ReadonlySet<string>;
  setChecked: (analysisId: string, checked: boolean) => void;
  /** Checks every listed row, or unchecks them all. */
  setAllChecked: (checked: boolean) => void;
}>;

/**
 * Tracks which of the listed `rows` the reader has checked for a bulk action. A row the listing
 * stops holding is unchecked for good, so an action never reaches a row the reader cannot see and
 * widening the listing again does not bring it back checked.
 */
export default function useRowSelection(
  rows: readonly Readonly<{ analysisId: string }>[],
): RowSelection {
  /** The rows the reader checked, some of which the listing may have since dropped. */
  const [chosenCheckedIds, setChosenCheckedIds] = useState<ReadonlySet<string>>(new Set());

  const checkedIds = useMemo(() => {
    const listed = rows.filter((r) => chosenCheckedIds.has(r.analysisId));
    return listed.length === chosenCheckedIds.size
      ? chosenCheckedIds
      : new Set(listed.map((r) => r.analysisId));
  }, [rows, chosenCheckedIds]);

  useEffect(() => {
    if (checkedIds !== chosenCheckedIds) setChosenCheckedIds(checkedIds);
  }, [checkedIds, chosenCheckedIds]);

  const setChecked = useCallback((analysisId: string, checked: boolean) => {
    setChosenCheckedIds((ids) => {
      const next = new Set(ids);
      if (checked) next.add(analysisId);
      else next.delete(analysisId);
      return next;
    });
  }, []);

  const setAllChecked = useCallback(
    (checked: boolean) =>
      setChosenCheckedIds(new Set(checked ? rows.map((r) => r.analysisId) : [])),
    [rows],
  );

  return useMemo(
    () => ({ checkedIds, setChecked, setAllChecked }),
    [checkedIds, setChecked, setAllChecked],
  );
}
