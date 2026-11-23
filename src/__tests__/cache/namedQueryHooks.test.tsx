/// <reference types="jest" />

import { logger } from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import {
  type ChangeAffects,
  type NamedFetchOptions,
  useNamedChanges,
  useNamedFetch,
} from '../../cache/namedQueryHooks';
import { usePageSession } from '../../cache/pageHooks';
import { relayChange } from './fake-host';
import { changeNaming, wrapperOver } from './hook-sessions';

/** Renders {@link useNamedChanges} for `query`, beside the session it reads. */
async function renderChanges(
  query: Parameters<typeof useNamedChanges>[0],
  counts?: Parameters<typeof useNamedChanges>[1],
) {
  const wrapper = await wrapperOver();
  const { result } = renderHook(
    () => ({ changes: useNamedChanges(query, counts), session: usePageSession() }),
    { wrapper },
  );
  return result;
}

describe('useNamedChanges', () => {
  it('counts each change to the session that names the query', async () => {
    const result = await renderChanges('getConcordance');

    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));
    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));

    expect(result.current.changes).toBe(2);
  });

  it('ignores a change that names other queries', async () => {
    const result = await renderChanges('getConcordance');

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
    const result = await renderChanges('getConcordance');

    relayChange(changeNaming('another-session', ['getConcordance']));

    expect(result.current.changes).toBe(0);
  });

  it('ignores a change that the given rule rejects', async () => {
    const result = await renderChanges('getConcordance', (change) => change.forms.length === 0);

    relayChange(changeNaming(result.current.session.sessionId, ['getConcordance']));
    relayChange({
      ...changeNaming(result.current.session.sessionId, ['getConcordance']),
      forms: ['a'],
    });

    expect(result.current.changes).toBe(1);
  });

  it('ignores a Scripture edit addressed to the source project', async () => {
    const result = await renderChanges('getConcordance');

    relayChange({ sourceProjectId: 'src', changeId: 'c', scriptureEdit: { bookId: 'GEN' } });

    expect(result.current.changes).toBe(0);
  });
});

describe('useNamedFetch', () => {
  /**
   * Renders {@link useNamedFetch} for `getConcordance` under the key that `key.current` holds, with
   * `options`.
   */
  async function renderFetch(
    key: { current: string | undefined },
    fetch: () => Promise<string>,
    options: NamedFetchOptions<string> = {},
  ) {
    const wrapper = await wrapperOver();
    // Inside `act`, so that an answer resolving at once lands within it.
    return act(async () =>
      renderHook(
        () => ({
          answer: useNamedFetch('getConcordance', 'the answer', key.current, fetch, options)?.value,
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

  it('waits for the fetch under way, then fetches once for every change that arrived meanwhile', async () => {
    const releases: ((answer: string) => void)[] = [];
    const fetch = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          releases.push(resolve);
        }),
    );
    const { result } = await renderFetch({ current: 'a' }, fetch);
    const { sessionId } = result.current.session;

    await relayNamed(sessionId);
    await relayNamed(sessionId);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => releases[0]('first'));
    expect(result.current.answer).toBe('first');
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => releases[1]('second'));
    expect(result.current.answer).toBe('second');
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
      { keepPrevious: true },
    );
    key.current = undefined;
    await act(async () => rerender());

    key.current = 'b';
    await act(async () => rerender());

    expect(result.current.answer).toBeUndefined();
  });

  it('drops the last answer and logs when a fetch fails', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const fetch = jest.fn(async () => 'answer');
    const { result } = await renderFetch({ current: 'a' }, fetch);
    fetch.mockRejectedValueOnce(new Error('offline'));

    await relayNamed(result.current.session.sessionId);

    expect(result.current.answer).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Interlinearizer: could not fetch the answer',
      expect.any(Error),
    );
  });

  describe('given a rule for which changes affect the answer', () => {
    /** A rule that lets through only the changes naming no forms. */
    const formless: ChangeAffects<string> = (change) => change.forms.length === 0;

    /** Relays a change naming `getConcordance` and the form `a`, letting any fetch it starts land. */
    async function relayForm(sessionId: string): Promise<void> {
      await act(async () =>
        relayChange({ ...changeNaming(sessionId, ['getConcordance']), forms: ['a'] }),
      );
    }

    it('skips a change that the rule rules out for the answer held', async () => {
      const fetch = jest.fn(async () => 'answer');
      const affects = jest.fn(formless);
      const { result } = await renderFetch({ current: 'a' }, fetch, { affects });

      await relayForm(result.current.session.sessionId);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(affects).toHaveBeenCalledWith(expect.objectContaining({ forms: ['a'] }), 'answer');
    });

    it('fetches again for a change that the rule lets through', async () => {
      const fetch = jest.fn(async () => 'answer');
      const { result } = await renderFetch({ current: 'a' }, fetch, { affects: formless });

      await relayNamed(result.current.session.sessionId);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('fetches again for a change that arrives while a fetch is under way, without asking the rule', async () => {
      const releases: ((answer: string) => void)[] = [];
      const fetch = jest.fn(
        () =>
          new Promise<string>((resolve) => {
            releases.push(resolve);
          }),
      );
      const affects = jest.fn(formless);
      const { result } = await renderFetch({ current: 'a' }, fetch, { affects });

      await relayForm(result.current.session.sessionId);
      await act(async () => releases[0]('first'));

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(affects).not.toHaveBeenCalled();
    });

    it('fetches again for a change that arrives after a failed fetch, without asking the rule', async () => {
      jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const fetch = jest.fn(async () => 'answer');
      const affects = jest.fn(formless);
      const { result } = await renderFetch({ current: 'a' }, fetch, {
        keepPrevious: true,
        affects,
      });
      fetch.mockRejectedValueOnce(new Error('offline'));
      await relayNamed(result.current.session.sessionId);

      await relayForm(result.current.session.sessionId);

      expect(fetch).toHaveBeenCalledTimes(3);
      // Asked only about the change that preceded the failure.
      expect(affects).toHaveBeenCalledTimes(1);
    });

    it('fetches again for a change that arrives before the answer for a new key', async () => {
      const key: { current: string | undefined } = { current: 'a' };
      let release = () => {};
      const fetch = jest.fn(() =>
        key.current === 'a'
          ? Promise.resolve('first')
          : new Promise<string>((resolve) => {
              release = () => resolve('second');
            }),
      );
      const { result, rerender } = await renderFetch(key, fetch, {
        keepPrevious: true,
        affects: formless,
      });
      key.current = 'b';
      await act(async () => rerender());

      await relayForm(result.current.session.sessionId);
      await act(async () => release());

      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });
});
