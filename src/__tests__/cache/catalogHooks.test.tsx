/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import { useMemo } from 'react';
import {
  useCatalogRowsByIds,
  useCatalogView,
  useDeletionPreview,
  useHomographRows,
  useSelectionSummary,
  useStaleSummary,
  useTextReadStatus,
} from '../../cache/catalogHooks';
import { settle } from '../components/analysis-provider';
import { makeTokenLink } from '../test-helpers';
import { relayChange } from './fake-host';
import { ref } from './session-source';
import {
  ANALYSIS,
  changeNaming,
  failing,
  languageWrapperOver,
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

    expect(result.current?.rows.map((row) => [row.analysisId, row.books])).toStrictEqual([
      ['ta-god', new Set(['GEN'])],
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

    expect(result.current?.keptIds).toStrictEqual([]);
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
    const shown = result.current?.keptIds;
    await settle();

    expect(shown).toStrictEqual(['ta-god']);
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
});

describe('useTextReadStatus', () => {
  it('asks nothing until the text is wanted', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useTextReadStatus(false), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.getTextReadStatus')).toBe(0);
  });

  it('reports how far the read has got once the text is wanted', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useTextReadStatus(true), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({ booksRead: 1, bookCount: 1, failedBookIds: [] }),
    );
  });

  it('asks again when a change to the session names the read status', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useTextReadStatus(true), { wrapper });
    await settle();

    relayChange(
      changeNaming(sessionIdOf('interlinearizer.getTextReadStatus'), ['getTextReadStatus']),
    );
    await settle();

    expect(timesSent('interlinearizer.getTextReadStatus')).toBe(2);
  });

  it('reports an error when the read could not start', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getTextReadStatus');

    const { result } = renderHook(() => useTextReadStatus(true), { wrapper });

    await waitFor(() => expect(result.current).toBe('error'));
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

    const { result } = renderHook(() => useSelectionSummary(['ta-god']), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({ usageCount: 1, glossedIds: ['ta-god'] }),
    );
  });

  it('keeps the last summary when fetching it again fails', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useSelectionSummary(['ta-god']), { wrapper });
    await waitFor(() => expect(result.current).toBeDefined());
    failing('interlinearizer.getSelectionSummary');

    relayChange(
      changeNaming(sessionIdOf('interlinearizer.getSelectionSummary'), ['getCatalogRows']),
    );
    await settle();

    expect(result.current).toStrictEqual({ usageCount: 1, glossedIds: ['ta-god'] });
  });

  it('logs a summary that could not be fetched', async () => {
    const wrapper = await wrapperOver();
    failing('interlinearizer.getSelectionSummary');

    renderHook(() => useSelectionSummary(['ta-god']), { wrapper });
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

    const { result } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });

    expect(result.current).toStrictEqual({ status: 'loading' });
    await settle();
  });

  it('states what deleting the analysis would do', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });

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

    const { result } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });

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
    const { result } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => serve?.(...call));

    const { current } = result;
    act(() => {
      if (current.status === 'failed') current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('fetches again when a change to the session names the catalog', async () => {
    const wrapper = await wrapperOver();
    renderHook(() => useDeletionPreview('ta-god'), { wrapper });
    await settle();

    relayChange(changeNaming(sessionIdOf('interlinearizer.previewDeletion'), ['getCatalogRows']));
    await settle();

    expect(timesSent('interlinearizer.previewDeletion')).toBe(2);
  });
});

describe('a change of analysis language', () => {
  it('fetches the catalog page again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useCatalogView(REQUEST, 10), { wrapper });
    await waitFor(() => expect(result.current?.rows[0]?.gloss).toBe('God'));

    await setLanguage('interlinearizer.getCatalogRows', 'fr');

    await waitFor(() => expect(result.current?.rows[0]?.gloss).toBe(''));
  });

  it('summarizes the selection again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useSelectionSummary(['ta-god']), { wrapper });
    await waitFor(() => expect(result.current?.glossedIds).toStrictEqual(['ta-god']));

    await setLanguage('interlinearizer.getSelectionSummary', 'fr');

    await waitFor(() => expect(result.current?.glossedIds).toStrictEqual([]));
  });

  it('fetches the rows by id again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useCatalogRowsByIds(['ta-god'], 'GEN'), { wrapper });
    await waitFor(() => expect(result.current?.get('ta-god')?.gloss).toBe('God'));

    await setLanguage('interlinearizer.getCatalogRowsByIds', 'fr');

    await waitFor(() => expect(result.current?.get('ta-god')?.gloss).toBe(''));
  });

  it('fetches the homographs again in the new language', async () => {
    const wrapper = await wrapperOver();
    const { result } = renderHook(() => useHomographRows('ta-god', 'GEN'), { wrapper });
    await waitFor(() => expect(result.current?.[0]?.gloss).toBe('God'));

    await setLanguage('interlinearizer.getHomographRows', 'fr');

    await waitFor(() => expect(result.current?.[0]?.gloss).toBe(''));
  });

  it('previews the deletion again', async () => {
    const language = { current: 'en' };
    const wrapper = await languageWrapperOver(language);
    const { rerender } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });
    await settle();

    language.current = 'fr';
    rerender();
    await settle();

    expect(timesSent('interlinearizer.previewDeletion')).toBe(2);
  });
});

describe('useStaleSummary', () => {
  const STALE: TextAnalysis = {
    ...ANALYSIS,
    tokenAnalysisLinks: [
      makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god', status: 'stale' }),
    ],
  };

  it("summarizes the book's stale analyses", async () => {
    const wrapper = await wrapperOver(undefined, STALE);

    const { result } = renderHook(() => useStaleSummary('GEN'), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        glosses: [{ analysisId: 'ta-god', tokenRef: ref('God') }],
        freeTranslations: [],
      }),
    );
  });

  it('fetches again when a change to the session names the stale summary', async () => {
    const wrapper = await wrapperOver(undefined, STALE);
    renderHook(() => useStaleSummary('GEN'), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getStaleSummary');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getStaleSummary'), ['getStaleSummary']));
    await settle();

    expect(timesSent('interlinearizer.getStaleSummary')).toBe(before + 1);
  });

  it('logs a summary that could not be fetched', async () => {
    const wrapper = await wrapperOver(undefined, STALE);
    failing('interlinearizer.getStaleSummary');

    renderHook(() => useStaleSummary('GEN'), { wrapper });
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the stale summary',
      expect.any(Error),
    );
  });
});
