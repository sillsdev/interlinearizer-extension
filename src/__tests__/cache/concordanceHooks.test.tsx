/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import type { SessionAnalysisChange } from 'interlinearizer';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  mayAlterConcordance,
  useConcordanceOccurrences,
  useConcordanceView,
  useRetryTextRead,
  useTextReadStatus,
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

/** A change naming the concordance and `forms`, with any field of `fields` in place of its own. */
function changeTo(
  forms: string[],
  fields: Partial<SessionAnalysisChange> = {},
): SessionAnalysisChange {
  return {
    sessionId: 's',
    changeId: 'c',
    books: [],
    analysisIds: [],
    forms,
    queries: ['getConcordance'],
    ...fields,
  };
}

/** Relays {@link changeTo}'s change to the session that `command` was sent to. */
function relayTo(command: string, ...change: Parameters<typeof changeTo>): void {
  relayChange({ ...changeTo(...change), sessionId: sessionIdOf(command) });
}

describe('mayAlterConcordance', () => {
  const shown = new Set(['and']);

  it('holds for a change naming a shown form', () => {
    expect(mayAlterConcordance(changeTo(['and', 'light']), shown)).toBe(true);
  });

  it('fails for a change naming only forms not shown', () => {
    expect(mayAlterConcordance(changeTo(['light']), shown)).toBe(false);
  });

  it('holds for a change naming no forms', () => {
    expect(mayAlterConcordance(changeTo([]), shown)).toBe(true);
  });

  it('holds for a change naming a book whole', () => {
    expect(mayAlterConcordance(changeTo(['light'], { books: [{ bookId: 'GEN' }] }), shown)).toBe(
      true,
    );
  });

  it('fails for a change naming only ranges of a book', () => {
    const change = changeTo(['light'], {
      books: [{ bookId: 'GEN', ranges: [{ start: 0, end: 1 }] }],
    });

    expect(mayAlterConcordance(change, shown)).toBe(false);
  });

  it("holds for a change naming the text's read status", () => {
    const change = changeTo(['light'], { queries: ['getConcordance', 'getTextReadStatus'] });

    expect(mayAlterConcordance(change, shown)).toBe(true);
  });
});

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

  it('fetches again when a change names a form on the page', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    relayTo('interlinearizer.getConcordance', ['and']);
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before + 1);
  });

  it('skips a change that names only forms off the page', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    renderHook(() => useConcordanceView('GEN', 1), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    relayTo('interlinearizer.getConcordance', ['beginning']);
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before);
  });

  it('fetches again when a change to the session names the concordance but no forms', async () => {
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

  it('fetches again when a change names the form', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    renderHook(() => useConcordanceOccurrences('beginning', 1), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    relayTo('interlinearizer.getConcordance', ['beginning']);
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before + 1);
  });

  it('skips a change that names only other forms', async () => {
    const wrapper = await wrapperOver(readText([], [BOOK]));
    renderHook(() => useConcordanceOccurrences('beginning', 1), { wrapper });
    await settle();
    const before = timesSent('interlinearizer.getConcordance');

    relayTo('interlinearizer.getConcordance', ['and']);
    await settle();

    expect(timesSent('interlinearizer.getConcordance')).toBe(before);
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
