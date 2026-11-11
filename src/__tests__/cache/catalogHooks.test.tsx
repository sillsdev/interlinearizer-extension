/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { renderHook, waitFor } from '@testing-library/react';
import type { TextAnalysis } from 'interlinearizer';
import { useMemo, type ReactNode } from 'react';
import {
  useCatalogRowsByIds,
  useCatalogView,
  useDeletionPreview,
  useHomographRows,
  useSelectionSummary,
  useTextReadStatus,
} from '../../cache/catalogHooks';
import { emptyAnalysis } from '../../types/empty-factories';
import { prepareAnalysis, settle } from '../components/analysis-provider';
import { FIXTURE_STAMPS, makeTokenLink } from '../test-helpers';
import { BOOK, ref } from './session-source';
import { readText, relayChange } from './fake-host';

const ANALYSIS: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [{ id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } }],
  tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' })],
};

const REQUEST = {
  currentBook: 'GEN',
  search: '',
  sort: 'surfaceText' as const,
  filters: {},
  sourceLanguageTag: 'en',
};

/** A wrapper giving the hooks a session over {@link ANALYSIS} that a fake host serves. */
async function wrapperOver(text = readText([])) {
  const Provider = await prepareAnalysis(ANALYSIS, BOOK, text);
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <Provider>{children}</Provider>;
  };
}

/** Sets the language of the session that the view last sent `command` under, as the view does. */
async function setLanguage(command: string, analysisLanguage: string): Promise<void> {
  await papi.commands.sendCommand('interlinearizer.setAnalysisLanguage', {
    sessionId: sessionIdOf(command),
    analysisLanguage,
  });
}

/** How many times the view has sent `command`. */
function timesSent(command: string): number {
  return jest.mocked(papi.commands.sendCommand).mock.calls.filter(([sent]) => sent === command)
    .length;
}

/** The session id the view last sent `command` under. */
function sessionIdOf(command: string): string {
  const args = jest
    .mocked(papi.commands.sendCommand)
    .mock.calls.findLast(([sent]) => sent === command)?.[1];
  const sessionId = typeof args === 'object' && args ? Reflect.get(args, 'sessionId') : undefined;
  if (typeof sessionId !== 'string') throw new Error(`${command} named no session`);
  return sessionId;
}

/** A change to the session that names `queries`, and touched nothing else. */
function changeNaming(sessionId: string, queries: string[]) {
  return { sessionId, changeId: 'c', books: [], analysisIds: [], forms: [], queries };
}

/** Makes the host fail `command` from now on, answering the rest as before. */
function failing(command: string): void {
  const serve = jest.mocked(papi.commands.sendCommand).getMockImplementation();
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call) => {
    if (call[0] === command) throw new Error('offline');
    return serve?.(...call);
  });
}

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
  it('asks nothing without an analysis', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview(undefined), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.previewDeletion')).toBe(0);
  });

  it('states what deleting the analysis would do', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-god'), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({ kind: 'blank', usageCount: 1, unappliedCount: 0 }),
    );
  });

  it('answers nothing for an analysis no longer stored', async () => {
    const wrapper = await wrapperOver();

    const { result } = renderHook(() => useDeletionPreview('ta-gone'), { wrapper });
    await settle();

    expect(timesSent('interlinearizer.previewDeletion')).toBe(1);
    expect(result.current).toBeUndefined();
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
