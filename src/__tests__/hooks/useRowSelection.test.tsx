/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import type { TextAnalysis } from 'interlinearizer';
import { act, renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import useRowSelection from '../../hooks/useRowSelection';
import { emptyAnalysis } from '../../types/empty-factories';
import { settle } from '../components/analysis-provider';
import { readText, relayChange } from '../cache/fake-host';
import {
  changeNaming,
  failing,
  holding,
  sessionIdOf,
  timesSent,
  wrapperOver,
} from '../cache/hook-sessions';
import { FIXTURE_STAMPS } from '../test-helpers';

/** Three unused analyses, of the words "a", "b" and "c", which a surface sort lists in that order. */
const ABC: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: ['c', 'a', 'b'].map((surfaceText) => ({
    ...FIXTURE_STAMPS,
    id: `ta-${surfaceText}`,
    surfaceText,
  })),
};

/** Renders the hook over a listing searched for `initial`, rerendering it as a step searches. */
async function renderSelection(initial = '') {
  const wrapper = await wrapperOver(readText([]), ABC);
  const { result, rerender } = renderHook(
    ({ search }: Readonly<{ search: string }>) =>
      useRowSelection(
        useMemo(
          () => ({
            currentBook: 'GEN',
            search,
            sort: 'surfaceText' as const,
            filters: {},
            sourceLanguageTag: 'en',
          }),
          [search],
        ),
      ),
    { wrapper, initialProps: { search: initial } },
  );
  return {
    result,
    search: async (search: string) => {
      rerender({ search });
      await settle();
    },
  };
}

describe('useRowSelection', () => {
  it('starts with nothing checked', async () => {
    const { result } = await renderSelection();

    expect([...result.current.checkedIds]).toEqual([]);
  });

  it('checks a row', async () => {
    const { result } = await renderSelection();

    act(() => result.current.setChecked('ta-b', true));

    expect([...result.current.checkedIds]).toEqual(['ta-b']);
    await settle();
  });

  it('takes an unchecked row back out of the checked rows', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setChecked('ta-a', true));
    act(() => result.current.setChecked('ta-b', true));

    act(() => result.current.setChecked('ta-a', false));

    expect([...result.current.checkedIds]).toEqual(['ta-b']);
    await settle();
  });

  it('orders the checked rows as the listing does once the host places them', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setChecked('ta-c', true));
    act(() => result.current.setChecked('ta-a', true));

    await settle();

    expect(result.current.orderedCheckedIds).toEqual(['ta-a', 'ta-c']);
  });

  it('orders the rows the host has yet to place last, in the order they were checked', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setChecked('ta-c', true));
    await settle();

    act(() => result.current.setChecked('ta-b', true));
    act(() => result.current.setChecked('ta-a', true));

    expect(result.current.orderedCheckedIds).toEqual(['ta-c', 'ta-b', 'ta-a']);
    await settle();
  });

  it('checks every row the listing keeps at once', async () => {
    const { result } = await renderSelection();

    act(() => result.current.setAllChecked(true));
    await settle();

    expect([...result.current.checkedIds]).toEqual(['ta-a', 'ta-b', 'ta-c']);
  });

  it('checks none of the rows the listing does not keep', async () => {
    const { result } = await renderSelection('b');

    act(() => result.current.setAllChecked(true));
    await settle();

    expect([...result.current.checkedIds]).toEqual(['ta-b']);
  });

  it('logs, checking nothing, when the host cannot list the rows to check', async () => {
    const { result } = await renderSelection();
    failing('interlinearizer.locateCatalogRows');

    act(() => result.current.setAllChecked(true));
    await settle();

    expect([...result.current.checkedIds]).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not list the catalog rows to check',
      expect.any(Error),
    );
  });

  it('places the rows it checks at once without asking the host again', async () => {
    const { result } = await renderSelection();

    act(() => result.current.setAllChecked(true));
    await settle();

    expect(timesSent('interlinearizer.locateCatalogRows')).toBe(1);
    expect(result.current.orderedCheckedIds).toEqual(['ta-a', 'ta-b', 'ta-c']);
  });

  it('asks the host to place the rows it checked at once again after a change names the catalog', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setAllChecked(true));
    await settle();

    act(() =>
      relayChange(
        changeNaming(sessionIdOf('interlinearizer.locateCatalogRows'), ['getCatalogRows']),
      ),
    );
    await settle();

    expect(timesSent('interlinearizer.locateCatalogRows')).toBe(2);
  });

  it('is settled while nothing is checked', async () => {
    const { result } = await renderSelection();

    expect(result.current.isSettled).toBe(true);
  });

  it('is unsettled until the host confirms the listing keeps the checked rows', async () => {
    const { result } = await renderSelection();
    const release = holding('interlinearizer.locateCatalogRows');

    act(() => result.current.setChecked('ta-b', true));

    expect(result.current.isSettled).toBe(false);
    release();
    await settle();
    expect(result.current.isSettled).toBe(true);
  });

  it('is unsettled while the host confirms the checked rows again after a change names the catalog', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setChecked('ta-b', true));
    await settle();
    const release = holding('interlinearizer.locateCatalogRows');

    act(() =>
      relayChange(
        changeNaming(sessionIdOf('interlinearizer.locateCatalogRows'), ['getCatalogRows']),
      ),
    );

    expect(result.current.isSettled).toBe(false);
    release();
    await settle();
    expect(result.current.isSettled).toBe(true);
  });

  it('offers no retry while the host confirms the checked rows', async () => {
    const { result } = await renderSelection();
    const release = holding('interlinearizer.locateCatalogRows');

    act(() => result.current.setChecked('ta-b', true));
    await settle();

    expect(result.current.retry).toBeUndefined();
    release();
    await settle();
  });

  it('offers a retry, staying unsettled, when the host cannot confirm the checked rows', async () => {
    const { result } = await renderSelection();
    failing('interlinearizer.locateCatalogRows');

    act(() => result.current.setChecked('ta-b', true));
    await settle();

    expect(result.current.isSettled).toBe(false);
    expect(result.current.retry).toEqual(expect.any(Function));
  });

  it('settles once a retry confirms the checked rows', async () => {
    const { result } = await renderSelection();
    const serve = jest.mocked(papi.commands.sendCommand).getMockImplementation();
    failing('interlinearizer.locateCatalogRows');
    act(() => result.current.setChecked('ta-b', true));
    await settle();
    jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => serve?.(...call));

    act(() => result.current.retry?.());
    await settle();

    expect(result.current.isSettled).toBe(true);
    expect(result.current.retry).toBeUndefined();
  });

  it('unchecks every row at once', async () => {
    const { result } = await renderSelection();
    act(() => result.current.setAllChecked(true));
    await settle();

    act(() => result.current.setAllChecked(false));

    expect([...result.current.checkedIds]).toEqual([]);
  });

  it('lets go of a checked row the listing stops keeping', async () => {
    const { result, search } = await renderSelection();
    act(() => result.current.setAllChecked(true));
    await settle();

    await search('b');

    expect([...result.current.checkedIds]).toEqual(['ta-b']);
  });

  it('leaves a let-go row unchecked once the listing keeps it again', async () => {
    const { result, search } = await renderSelection();
    act(() => result.current.setAllChecked(true));
    await settle();
    await search('b');

    await search('');

    expect([...result.current.checkedIds]).toEqual(['ta-b']);
  });

  it('keeps the same checked set while the listing still keeps every checked row', async () => {
    const { result, search } = await renderSelection('a');
    act(() => result.current.setChecked('ta-a', true));
    await settle();
    const before = result.current.checkedIds;

    await search('');

    expect(result.current.checkedIds).toBe(before);
  });
});
