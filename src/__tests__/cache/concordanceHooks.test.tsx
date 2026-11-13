/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useConcordanceOccurrences,
  useConcordanceView,
  useRetryTextRead,
} from '../../cache/concordanceHooks';
import { settle } from '../components/analysis-provider';
import { BOOK, ref } from './session-source';
import { readText, relayChange, unreadText } from './fake-host';
import {
  changeNaming,
  failing,
  sessionIdOf,
  setLanguage,
  timesSent,
  wrapperOver,
} from './hook-sessions';

describe('useConcordanceView', () => {
  it('serves the first rows of the concordance, counted against the current book', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));

    const { result } = renderHook(() => useConcordanceView('GEN', 1), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        total: 7,
        bookCount: 1,
        rows: [
          {
            form: 'and',
            displayText: 'And',
            occurrenceCount: 2,
            occurrenceCountInBook: 2,
            analyzedCount: 0,
            status: 'unanalyzed',
          },
        ],
        retry: undefined,
      }),
    );
  });

  it('serves null while the text is still being read', async () => {
    const wrapper = await wrapperOver(unreadText());

    const { result } = renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();

    expect(result.current).toBeNull();
  });

  it('serves the rows once a change reports the text read', async () => {
    let text = unreadText();
    const wrapper = await wrapperOver({
      status: () => text.status(),
      isFormInText: (form) => text.isFormInText(form),
      concordanceBooks: () => text.concordanceBooks?.(),
    });
    const { result } = renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();

    text = readText([], [BOOK]);
    relayChange(changeNaming(sessionIdOf('interlinearizer.getConcordance'), ['getTextReadStatus']));
    await settle();

    expect(result.current?.total).toBe(7);
  });

  it('fetches again when a change to the session names the concordance', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    relayChange(changeNaming(sessionIdOf('interlinearizer.getConcordance'), ['getConcordance']));
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before + 1);
  });

  it('keeps the last rows when a fetch fails', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    const { result } = renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('offline'));

    relayChange(changeNaming(sessionIdOf('interlinearizer.getConcordance'), ['getConcordance']));
    await settle();

    expect(result.current?.total).toBe(7);
    expect(warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the concordance',
      expect.any(Error),
    );
  });

  it('offers a retry after a failed fetch that fetches the page again', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    const { result } = renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('offline'));
    relayChange(changeNaming(sessionIdOf('interlinearizer.getConcordance'), ['getConcordance']));
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    act(() => result.current?.retry?.());
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before + 1);
    expect(result.current?.retry).toBeUndefined();
  });
});

describe('useConcordanceOccurrences', () => {
  it("serves the first occurrences of a form, glossed in the session's language", async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));

    const { result } = renderHook(() => useConcordanceOccurrences('beginning', 1), { wrapper });

    await waitFor(() =>
      expect(result.current).toStrictEqual({
        total: 1,
        tallies: [{ analysisId: 'ta-beginning', gloss: 'start', count: 1 }],
        occurrences: [
          {
            tokenRef: ref('beginning'),
            book: 'GEN',
            chapter: 1,
            verse: 1,
            surfaceText: 'beginning',
            contextText: 'In the beginning God',
            charStart: 7,
            charEnd: 16,
            analysisId: 'ta-beginning',
          },
        ],
      }),
    );
  });

  it('fetches nothing while no form is given', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));

    const { result } = renderHook(() => useConcordanceOccurrences(undefined, 1), { wrapper });
    await settle();

    expect(result.current).toBeUndefined();
    expect(timesSent('interlinearizer.getConcordance')).toBe(0);
  });

  it('glosses the tallies in the language that the session switches to', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    const { result } = renderHook(() => useConcordanceOccurrences('beginning', 1), { wrapper });
    await waitFor(() => expect(result.current?.tallies[0].gloss).toBe('start'));

    await setLanguage('interlinearizer.getConcordance', 'fr');

    await waitFor(() => expect(result.current?.tallies[0].gloss).toBe(''));
  });

  it('keeps the last occurrences when a fetch fails', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    const { result } = renderHook(() => useConcordanceOccurrences('beginning', 1), { wrapper });
    await settle();
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.mocked(papi.commands.sendCommand).mockRejectedValueOnce(new Error('offline'));

    relayChange(changeNaming(sessionIdOf('interlinearizer.getConcordance'), ['getConcordance']));
    await settle();

    expect(result.current?.total).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      "Interlinearizer: could not fetch a form's occurrences",
      expect.any(Error),
    );
  });
});

describe('useRetryTextRead', () => {
  it("asks the session to read its text's failed books again", async () => {
    const retry = jest.fn();
    const wrapper = await wrapperOver({ ...readText([]), retry });
    const { result } = renderHook(() => useRetryTextRead(), { wrapper });

    result.current();
    await settle();

    expect(retry).toHaveBeenCalled();
  });

  it('logs a retry that the session refuses', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const wrapper = await wrapperOver();
    failing('interlinearizer.retryTextRead');
    const { result } = renderHook(() => useRetryTextRead(), { wrapper });

    result.current();
    await settle();

    expect(warn).toHaveBeenCalledWith(
      "Interlinearizer: could not read the session's text again",
      expect.any(Error),
    );
  });
});
