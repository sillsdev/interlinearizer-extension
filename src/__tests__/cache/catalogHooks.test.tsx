/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import {
  fetchCatalogPositions,
  useCatalogPlaces,
  useCatalogPositions,
  useCatalogRowsByIds,
  useCatalogView,
  useDeletionPreview,
  useHomographRows,
  useSelectionSummary,
} from '../../cache/catalogHooks';
import { settle } from '../components/analysis-provider';
import { relayChange } from './fake-host';
import {
  changeNaming,
  failing,
  sessionIdOf,
  setLanguage,
  timesSent,
  wrapperOver,
} from './hook-sessions';

const REQUEST = {
  currentBook: 'GEN',
  search: '',
  sort: 'surfaceText' as const,
  filters: {},
  sourceLanguageTag: 'en',
};

describe('useCatalogView', () => {
  it("serves a page of the session's catalog, each row's books as a set", async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();

    expect(result.current.view?.rows.map((row) => [row.analysisId, row.books])).toStrictEqual([
      ['ta-beginning', new Set(['GEN'])],
    ]);
  });

  it('fetches again when a change to the session names the catalog', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getCatalogRows');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getCatalogRows'), ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.getCatalogRows')).toBe(before + 1);
  });

  it('fetches nothing for a change naming another query', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getCatalogRows');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getCatalogRows'), ['getConcordance']));
    await settle();

    expect(timesSent('interlinearizer.getCatalogRows')).toBe(before);
  });

  it("fetches nothing for a change to another session's catalog", async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getCatalogRows');

    relayChange(changeNaming('another-session', ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.getCatalogRows')).toBe(before);
  });

  it('keeps the page of the latest request, not one it superseded', async () => {
    const wrapper = await wrapperOver();
    const { result, rerender } = renderHook(
      ({ search }: Readonly<{ search: string }>) =>
        useCatalogView(
          useMemo(() => ({ ...REQUEST, search }), [search]),
          10,
        ),
      { wrapper, initialProps: { search: '' } },
    );

    rerender({ search: 'nothing matches this' });
    await settle();

    expect(result.current.view?.keptCount).toBe(0);
  });

  it('keeps the last page on screen while the next request is fetched', async () => {
    const wrapper = await wrapperOver();
    const { result, rerender } = renderHook(
      ({ search }: Readonly<{ search: string }>) =>
        useCatalogView(
          useMemo(() => ({ ...REQUEST, search }), [search]),
          10,
        ),
      { wrapper, initialProps: { search: '' } },
    );
    await settle();

    rerender({ search: 'nothing matches this' });
    const shown = result.current.view?.rows.map((row) => row.analysisId);
    await settle();

    expect(shown).toStrictEqual(['ta-beginning']);
  });

  it('logs a page that could not be fetched', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getCatalogRows');

    renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the catalog',
      expect.any(Error),
    );
  });

  it('offers a retry when the first page could not be fetched', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getCatalogRows');

    const { result } = renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();

    expect(result.current.view).toBeUndefined();
    expect(result.current.retry).toBeInstanceOf(Function);
  });

  it('keeps the same retry while a retry of the page fails', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getCatalogRows');
    const retries: unknown[] = [];
    const { result } = renderHook(
      () => {
        const fetched = useCatalogView(REQUEST, 10);
        retries.push(fetched.retry);
        return fetched;
      },
      { wrapper },
    );
    await settle();
    const { retry } = result.current;
    const failedAt = retries.length;

    act(() => retry?.());
    await settle();

    expect(timesSent('interlinearizer.getCatalogRows')).toBe(2);
    expect(retries.slice(failedAt).every((each) => each === retry)).toBe(true);
  });

  it('keeps the last page when fetching it again fails', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await waitFor(() => expect(result.current.view?.keptCount).toBe(1));
    failing('interlinearizer.getCatalogRows');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getCatalogRows'), ['getCatalogRows']));
    await settle();

    expect(result.current.view?.rows.map((row) => row.analysisId)).toStrictEqual(['ta-beginning']);
  });
});

describe('useCatalogPositions', () => {
  it('places each named row the listing keeps, by id', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPositions(REQUEST, ['ta-beginning', 'ta-x']), {
      wrapper,
    });
    await settle();

    expect(result.current).toStrictEqual(new Map([['ta-beginning', 0]]));
  });

  it('fetches nothing while no ids are named', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPositions(REQUEST, undefined), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.locateCatalogRows')).toBe(0);
  });

  it('fetches again when a change to the session names the catalog', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogPositions(REQUEST, ['ta-beginning']), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.locateCatalogRows');

    relayChange(changeNaming(sessionIdOf('interlinearizer.locateCatalogRows'), ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.locateCatalogRows')).toBe(before + 1);
  });
});

describe('fetchCatalogPositions', () => {
  it('places every row the listing keeps when no ids are named', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await settle();

    await expect(
      fetchCatalogPositions(sessionIdOf('interlinearizer.getCatalogRows'), REQUEST),
    ).resolves.toStrictEqual([['ta-beginning', 0]]);
  });
});

describe('useSelectionSummary', () => {
  it('asks nothing while none is selected', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useSelectionSummary([]), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.getSelectionSummary')).toBe(0);
  });

  it('summarizes the selected analyses', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useSelectionSummary(['ta-beginning']), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({ usageCount: 1, glossedIds: ['ta-beginning'] }),
    );
  });

  it('drops the last summary when fetching it again fails', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useSelectionSummary(['ta-beginning']), { wrapper });
    await waitFor(() => expect(result.current).toBeDefined());
    failing('interlinearizer.getSelectionSummary');

    relayChange(
      changeNaming(sessionIdOf('interlinearizer.getSelectionSummary'), ['getCatalogRows']),
    );
    await settle();

    expect(result.current).toBeUndefined();
  });

  it('logs a summary that could not be fetched', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getSelectionSummary');

    renderHook(() => useSelectionSummary(['ta-beginning']), { wrapper });
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the selection summary',
      expect.any(Error),
    );
  });
});

describe('useDeletionPreview', () => {
  it('is loading until the host answers', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });

    expect(result.current).toStrictEqual({ status: 'loading' });
    await settle();
  });

  it('states what deleting the analysis would do', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        status: 'ready',
        outcome: { kind: 'blank', usageCount: 1, unappliedCount: 0 },
      }),
    );
  });

  it('reports an analysis no longer stored as missing', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-gone'), { wrapper });

    await waitFor(() => expect(result.current).toStrictEqual({ status: 'missing' }));
  });

  it('reports a preview the host could not give', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.previewDeletion');

    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the deletion preview',
      expect.any(Error),
    );
  });

  it('asks again when retried', async () => {
    const wrapper = await wrapperOver();
    const serve = jest.mocked(papi.commands.sendCommand).getMockImplementation();
    failing('interlinearizer.previewDeletion');
    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => serve?.(...call));

    const { current } = result;
    act(() => {
      if (current.status === 'failed') current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('shows a retried preview as loading until the host answers', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.previewDeletion');
    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));

    const { current } = result;
    act(() => {
      if (current.status === 'failed') current.retry();
    });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('failed'));
  });

  it('fetches again when a change to the session names the catalog', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });
    await settle();

    relayChange(changeNaming(sessionIdOf('interlinearizer.previewDeletion'), ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.previewDeletion')).toBe(2);
  });
});

describe('useCatalogPlaces', () => {
  it('asks nothing without an analysis', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPlaces(undefined, 'GEN'), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.getCatalogPlaces')).toBe(0);
  });

  it('is loading until the host answers', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPlaces('ta-beginning', 'GEN'), { wrapper });

    expect(result.current).toStrictEqual({ status: 'loading' });
    await settle();
  });

  it('lists every place of the analysis', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPlaces('ta-beginning', 'GEN'), { wrapper });

    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const { current } = result;
    expect(current?.status === 'ready' && current.places).toStrictEqual({
      usages: [expect.objectContaining({ book: 'GEN', chapter: 1, verse: 1 })],
      staleLocations: [],
    });
  });

  it('reports an analysis no longer stored as missing', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useCatalogPlaces('ta-gone', 'GEN'), { wrapper });

    await waitFor(() => expect(result.current).toStrictEqual({ status: 'missing' }));
  });

  it('reports places the host could not give', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getCatalogPlaces');

    const { result } = renderHook(() => useCatalogPlaces('ta-beginning', 'GEN'), { wrapper });

    await waitFor(() => expect(result.current?.status).toBe('failed'));
    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch catalog places',
      expect.any(Error),
    );
  });

  it('shows retried places as loading until the host answers', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getCatalogPlaces');
    const { result } = renderHook(() => useCatalogPlaces('ta-beginning', 'GEN'), { wrapper });
    await waitFor(() => expect(result.current?.status).toBe('failed'));

    const { current } = result;
    act(() => {
      if (current?.status === 'failed') current.retry();
    });

    expect(result.current?.status).toBe('loading');
    await waitFor(() => expect(result.current?.status).toBe('failed'));
  });

  it('fetches again when a change to the session names the catalog', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useCatalogPlaces('ta-beginning', 'GEN'), { wrapper });
    await settle();

    relayChange(changeNaming(sessionIdOf('interlinearizer.getCatalogPlaces'), ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.getCatalogPlaces')).toBe(2);
  });
});

describe('a change of analysis language', () => {
  it('fetches the catalog page again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await waitFor(() => expect(result.current.view?.rows[0]?.gloss).toBe('start'));

    await setLanguage('interlinearizer.getCatalogRows', 'fr');

    await waitFor(() => expect(result.current.view?.rows[0]?.gloss).toBe(''));
  });

  it('summarizes the selection again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useSelectionSummary(['ta-beginning']), { wrapper });
    await waitFor(() => expect(result.current?.glossedIds).toStrictEqual(['ta-beginning']));

    await setLanguage('interlinearizer.getSelectionSummary', 'fr');

    await waitFor(() => expect(result.current?.glossedIds).toStrictEqual([]));
  });

  it("drops the old language's summary when fetching it in the new language fails", async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useSelectionSummary(['ta-beginning']), { wrapper });
    await waitFor(() => expect(result.current?.glossedIds).toStrictEqual(['ta-beginning']));
    failing('interlinearizer.getSelectionSummary');

    await act(() => setLanguage('interlinearizer.getSelectionSummary', 'fr'));
    await settle();

    expect(result.current).toBeUndefined();
  });

  it('fetches the rows by id again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useCatalogRowsByIds(['ta-beginning'], 'GEN'), { wrapper });
    await waitFor(() => expect(result.current?.get('ta-beginning')?.gloss).toBe('start'));

    await setLanguage('interlinearizer.getCatalogRowsByIds', 'fr');

    await waitFor(() => expect(result.current?.get('ta-beginning')?.gloss).toBe(''));
  });

  it('fetches the homographs again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useHomographRows('ta-beginning', 'GEN'), { wrapper });
    await waitFor(() => expect(result.current?.[0]?.gloss).toBe('start'));

    await setLanguage('interlinearizer.getHomographRows', 'fr');

    await waitFor(() => expect(result.current?.[0]?.gloss).toBe(''));
  });

  it('previews the deletion again', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useDeletionPreview('ta-beginning'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await setLanguage('interlinearizer.previewDeletion', 'fr');

    await waitFor(() => expect(timesSent('interlinearizer.previewDeletion')).toBe(2));
  });
});
