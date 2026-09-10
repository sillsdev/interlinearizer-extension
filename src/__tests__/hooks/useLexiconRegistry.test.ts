/// <reference types="jest" />

import { act, renderHook, waitFor } from '@testing-library/react';
import useLexiconRegistry from '../../hooks/useLexiconRegistry';
import { fwLiteLexiconProvider } from '../../utils/fw-lite-lexicon';
import { FW_LITE_AUTHORITY } from '../../utils/lexicon-authorities';

jest.mock('../../utils/fw-lite-lexicon', () => ({
  fwLiteLexiconProvider: {
    authority: 'fw-lite',
    isAvailable: jest.fn(),
    subscribeToLink: jest.fn(),
    connect: jest.fn(),
  },
}));

const provider = jest.mocked(fwLiteLexiconProvider);

/** The watches the hook has opened, so a test can report a link the way the provider would. */
let watchers: ((lexiconId: string | undefined) => void)[] = [];
const unsubscribe = jest.fn(async () => true);

/**
 * Serves a watch that reports `lexiconId` on subscribing, as `subscribeSetting` does, and stays
 * open so a test can report a relink through it.
 */
function watchReporting(lexiconId: string | undefined) {
  provider.subscribeToLink.mockImplementation(async (_projectId, callback) => {
    watchers.push(callback);
    callback(lexiconId);
    return unsubscribe;
  });
}

/** Reports a link through every open watch, the way a changed project setting would. */
async function relinkTo(lexiconId: string | undefined) {
  await act(async () => {
    watchers.forEach((callback) => callback(lexiconId));
  });
}

/** A resolver that answers for FieldWorks Lite and can be searched only when given a lexicon. */
function stubResolver(lexiconId?: string) {
  return {
    authorities: [FW_LITE_AUTHORITY],
    capabilities: {
      search: !!lexiconId,
      create: !!lexiconId,
      allomorphs: false,
      msas: false,
    },
    resolveSense: jest.fn(async () => undefined),
    searchByForm: jest.fn(async () => []),
    createEntry: jest.fn(async () => {
      throw new Error('unused');
    }),
  };
}

beforeEach(() => {
  watchers = [];
  unsubscribe.mockClear();
  provider.connect.mockImplementation(stubResolver);
  provider.isAvailable.mockResolvedValue(true);
  watchReporting('lex-1');
});

describe('useLexiconRegistry', () => {
  it('holds no lexicon on the first render, so a consumer never waits on one', () => {
    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    expect(result.current.resolverWith('search')).toBeUndefined();
    expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(true);
  });

  it('connects the linked lexicon once the software has answered', async () => {
    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());
    expect(provider.connect).toHaveBeenCalledWith('lex-1');
    expect(provider.subscribeToLink).toHaveBeenCalledWith('project-1', expect.any(Function));
  });

  it('reads a ref of unreachable software as foreign', async () => {
    provider.isAvailable.mockResolvedValue(false);

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(provider.isAvailable).toHaveBeenCalled());
    expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(true);
    expect(provider.subscribeToLink).not.toHaveBeenCalled();
  });

  it('reads a ref of reachable but unlinked software as native, so it renders as a miss', async () => {
    watchReporting(undefined);

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() =>
      expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(false),
    );
    expect(result.current.resolverWith('search')).toBeUndefined();
    expect(provider.connect).toHaveBeenLastCalledWith(undefined);
  });

  it('reconnects when the project is relinked while it is open', async () => {
    const { result } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());

    await relinkTo('lex-2');

    expect(provider.connect).toHaveBeenLastCalledWith('lex-2');
  });

  it('drops the lexicon when the link is cleared while the project is open', async () => {
    const { result } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());

    await relinkTo(undefined);

    expect(result.current.resolverWith('search')).toBeUndefined();
    expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(false);
  });

  it('reports no link for a provider whose watch cannot be opened', async () => {
    provider.subscribeToLink.mockRejectedValue(new Error('no such project'));

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(provider.connect).toHaveBeenCalled());
    expect(provider.connect).toHaveBeenLastCalledWith(undefined);
    expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(false);
  });

  it('ignores a link reported after the watch was torn down', async () => {
    const { result, unmount } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());
    const settled = result.current;

    unmount();
    watchers.forEach((callback) => callback('lex-late'));

    expect(result.current).toBe(settled);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('closes a watch that finishes subscribing after teardown', async () => {
    let finishSubscribing = (): void => {};
    provider.subscribeToLink.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finishSubscribing = () => resolve(unsubscribe);
        }),
    );
    const { unmount } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(provider.subscribeToLink).toHaveBeenCalled());

    unmount();
    await act(async () => {
      finishSubscribing();
    });

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('hands back one registry across renders, so a consumer can hold on to it', async () => {
    const { result, rerender } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());
    const settled = result.current;

    rerender();

    expect(result.current).toBe(settled);
  });

  it('leaves the registry alone when a watch re-reports the link it already had', async () => {
    const { result } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());
    const settled = result.current;

    await relinkTo('lex-1');

    expect(result.current).toBe(settled);
  });

  it('answers for the project in view, so a second project gets its own link', async () => {
    const { result, rerender } = renderHook(({ projectId }) => useLexiconRegistry(projectId), {
      initialProps: { projectId: 'project-1' },
    });
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());

    watchers = [];
    watchReporting('lex-2');
    rerender({ projectId: 'project-2' });

    await waitFor(() => expect(provider.connect).toHaveBeenLastCalledWith('lex-2'));
    expect(provider.subscribeToLink).toHaveBeenLastCalledWith('project-2', expect.any(Function));
    expect(unsubscribe).toHaveBeenCalled();
  });
});
