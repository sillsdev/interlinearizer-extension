/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import useRowSelection from '../../hooks/useRowSelection';

/** Rows for each of `analysisIds`, in order. */
function rowsOf(...analysisIds: string[]) {
  return analysisIds.map((analysisId) => ({ analysisId }));
}

/** Renders the hook over `initial`, rerendering it over whichever rows a step lists. */
function renderSelection(initial: readonly { analysisId: string }[]) {
  const { result, rerender } = renderHook(
    (rows: readonly { analysisId: string }[]) => useRowSelection(rows),
    { initialProps: initial },
  );
  return {
    result,
    listRows: (rows: readonly { analysisId: string }[]) => act(() => rerender(rows)),
  };
}

describe('useRowSelection', () => {
  it('starts with nothing checked', () => {
    const { result } = renderSelection(rowsOf('a', 'b'));

    expect([...result.current.checkedIds]).toEqual([]);
  });

  it('checks a row', () => {
    const { result } = renderSelection(rowsOf('a', 'b'));

    act(() => result.current.setChecked('b', true));

    expect([...result.current.checkedIds]).toEqual(['b']);
  });

  it('takes an unchecked row back out of the checked rows', () => {
    const { result } = renderSelection(rowsOf('a', 'b'));
    act(() => result.current.setChecked('a', true));
    act(() => result.current.setChecked('b', true));

    act(() => result.current.setChecked('a', false));

    expect([...result.current.checkedIds]).toEqual(['b']);
  });

  it('checks every listed row at once', () => {
    const { result } = renderSelection(rowsOf('a', 'b', 'c'));

    act(() => result.current.setAllChecked(true));

    expect([...result.current.checkedIds]).toEqual(['a', 'b', 'c']);
  });

  it('unchecks every row at once', () => {
    const { result } = renderSelection(rowsOf('a', 'b'));
    act(() => result.current.setAllChecked(true));

    act(() => result.current.setAllChecked(false));

    expect([...result.current.checkedIds]).toEqual([]);
  });

  it('lets go of a checked row the listing stops holding', () => {
    const { result, listRows } = renderSelection(rowsOf('a', 'b'));
    act(() => result.current.setAllChecked(true));

    listRows(rowsOf('b'));

    expect([...result.current.checkedIds]).toEqual(['b']);
  });

  it('leaves a let-go row unchecked once the listing holds it again', () => {
    const { result, listRows } = renderSelection(rowsOf('a', 'b'));
    act(() => result.current.setAllChecked(true));
    listRows(rowsOf('b'));

    listRows(rowsOf('a', 'b'));

    expect([...result.current.checkedIds]).toEqual(['b']);
  });

  it('keeps the same checked set while the listing still holds every checked row', () => {
    const { result, listRows } = renderSelection(rowsOf('a', 'b'));
    act(() => result.current.setChecked('a', true));
    const before = result.current.checkedIds;

    listRows(rowsOf('a', 'b', 'c'));

    expect(result.current.checkedIds).toBe(before);
  });
});
