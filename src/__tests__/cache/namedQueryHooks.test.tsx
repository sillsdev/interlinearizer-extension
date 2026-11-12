/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import { useNamedChanges, useNamedFetch } from '../../cache/namedQueryHooks';
import { usePageSession } from '../../cache/pageHooks';
import { relayChange } from './fake-host';
import { changeNaming, wrapperOver } from './hook-sessions';

/** Renders {@link useNamedChanges} for `query`, beside the session it reads. */
async function renderChanges(query: Parameters<typeof useNamedChanges>[0] = 'getConcordance') {
  const wrapper = await wrapperOver();
  const { result } = renderHook(
    () => ({ changes: useNamedChanges(query), session: usePageSession() }),
    { wrapper },
  );
  return result;
}

describe('useNamedChanges', () => {
  it('counts each change to the session that names the query', async () => {
    const result = await renderChanges();

    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));
    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));

    expect(result.current.changes).toBe(2);
  });

  it('ignores a change that names other queries', async () => {
    const result = await renderChanges();

    relayChange(changeNaming(result.current.session.sessionId, ['getCatalogRows']));

    expect(result.current.changes).toBe(0);
  });

  it('counts each change to the session that names any of the queries', async () => {
    const result = await renderChanges(['getConcordance', 'getTextReadStatus']);

    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));
    relayChange(changeNaming(result.current.session.sessionId, ['getTextReadStatus']));
    relayChange(changeNaming(result.current.session.sessionId, ['getCatalogRows']));

    expect(result.current.changes).toBe(2);
  });

  it('counts a change that names several of the queries once', async () => {
    const result = await renderChanges(['getConcordance', 'getTextReadStatus']);

    relayChange(
      changeNaming(result.current.session.sessionId, ['getConcordance', 'getTextReadStatus']),
    );

    expect(result.current.changes).toBe(1);
  });

  it('ignores a change to another session', async () => {
    const result = await renderChanges();

    relayChange(changeNaming('another-session', ['getConcordance']));

    expect(result.current.changes).toBe(0);
  });

  it('ignores a Scripture edit addressed to the source project', async () => {
    const result = await renderChanges();

    relayChange({ sourceProjectId: 'src', changeId: 'c', scriptureEdit: { bookId: 'GEN' } });

    expect(result.current.changes).toBe(0);
  });
});

describe('useNamedFetch', () => {
  /**
   * Renders {@link useNamedFetch} for `getConcordance` under the key that `key.current` holds,
   * keeping the last key's answer when `keepPrevious`.
   */
  async function renderFetch(
    key: { current: string | undefined },
    fetch: () => Promise<string>,
    keepPrevious = false,
  ) {
    const wrapper = await wrapperOver();
    // Inside `act`, so that an answer resolving at once lands within it.
    return act(async () =>
      renderHook(
        () => ({
          answer: useNamedFetch('getConcordance', 'the answer', key.current, fetch, keepPrevious)
            ?.value,
          session: usePageSession(),
        }),
        { wrapper },
      ),
    );
  }

  /** Relays a change naming `getConcordance` to `sessionId`, letting the fetch it starts land. */
  async function relayNamed(sessionId: string): Promise<void> {
    await act(async () => relayChange(changeNaming(sessionId, ['getConcordance'])));
  }

  it('serves the answer fetched for the key', async () => {
    const { result } = await renderFetch({ current: 'a' }, async () => 'answer');

    expect(result.current.answer).toBe('answer');
  });

  it('fetches nothing while the key is undefined', async () => {
    const fetch = jest.fn(async () => 'answer');
    const { result } = await renderFetch({ current: undefined }, fetch);

    expect(result.current.answer).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches again when a change to the session names the query', async () => {
    const fetch = jest.fn(async () => 'answer');
    const { result } = await renderFetch({ current: 'a' }, fetch);

    await relayNamed(result.current.session.sessionId);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("serves undefined for a new key until that key's answer arrives", async () => {
    const key: { current: string | undefined } = { current: 'a' };
    let release = () => {};
    const { result, rerender } = await renderFetch(key, () =>
      key.current === 'a'
        ? Promise.resolve('first')
        : new Promise((resolve) => {
            release = () => resolve('second');
          }),
    );
    expect(result.current.answer).toBe('first');

    key.current = 'b';
    await act(async () => rerender());

    expect(result.current.answer).toBeUndefined();
    await act(async () => release());
    expect(result.current.answer).toBe('second');
  });

  it('drops the last answer once the key is undefined, so the next key starts without it', async () => {
    const key: { current: string | undefined } = { current: 'a' };
    const { result, rerender } = await renderFetch(
      key,
      () => (key.current === 'a' ? Promise.resolve('first') : new Promise(() => {})),
      true,
    );
    key.current = undefined;
    await act(async () => rerender());

    key.current = 'b';
    await act(async () => rerender());

    expect(result.current.answer).toBeUndefined();
  });

  it('keeps the last answer and logs when a fetch fails', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const fetch = jest.fn(async () => 'answer');
    const { result } = await renderFetch({ current: 'a' }, fetch);
    fetch.mockRejectedValueOnce(new Error('offline'));

    await relayNamed(result.current.session.sessionId);

    expect(result.current.answer).toBe('answer');
    expect(warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the answer',
      expect.any(Error),
    );
  });
});
