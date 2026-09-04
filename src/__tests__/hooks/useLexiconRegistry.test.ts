/// <reference types="jest" />

import { renderHook, waitFor } from '@testing-library/react';
import { useProjectSetting } from '@papi/frontend/react';
import useLexiconRegistry from '../../hooks/useLexiconRegistry';
import { fwLiteLexiconProvider } from '../../utils/fw-lite-lexicon';
import { FW_LITE_AUTHORITY } from '../../utils/lexicon-authorities';

jest.mock('../../utils/fw-lite-lexicon', () => ({
  fwLiteLexiconProvider: {
    authority: 'fw-lite',
    isAvailable: jest.fn(),
    connect: jest.fn(),
  },
}));

const provider = jest.mocked(fwLiteLexiconProvider);
const mockUseProjectSetting = jest.mocked(useProjectSetting);

/** Serves the stored link, keyed by setting so the two halves can disagree. */
function storeLink(authority?: string, lexiconCode?: string) {
  mockUseProjectSetting.mockImplementation((_projectId, key) => [
    key === 'interlinearizer.lexiconAuthority' ? authority : lexiconCode,
    jest.fn(),
    jest.fn(),
    false,
  ]);
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
  provider.connect.mockImplementation(stubResolver);
  provider.isAvailable.mockResolvedValue(true);
  storeLink('fw-lite', 'lex-1');
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
  });

  it('reads a ref of unreachable software as foreign', async () => {
    provider.isAvailable.mockResolvedValue(false);

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(provider.isAvailable).toHaveBeenCalled());
    expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(true);
  });

  it('reads a ref of reachable but unlinked software as native, so it renders as a miss', async () => {
    storeLink('', '');

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() =>
      expect(result.current.isForeign({ authority: FW_LITE_AUTHORITY })).toBe(false),
    );
    expect(result.current.resolverWith('search')).toBeUndefined();
  });

  it.each([
    ['an authority without a lexicon code', 'fw-lite', ''],
    ['a lexicon code without an authority', '', 'lex-1'],
  ])('treats %s as no link', async (_case, authority, lexiconCode) => {
    storeLink(authority, lexiconCode);

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(provider.connect).toHaveBeenCalled());
    expect(provider.connect).toHaveBeenLastCalledWith(undefined);
    expect(result.current.resolverWith('search')).toBeUndefined();
  });

  it('treats a setting the platform could not read as unset', async () => {
    storeLink(undefined, undefined);

    const { result } = renderHook(() => useLexiconRegistry('project-1'));

    await waitFor(() => expect(provider.connect).toHaveBeenCalled());
    expect(result.current.resolverWith('search')).toBeUndefined();
  });

  it('hands back one registry across renders, so a consumer can hold on to it', async () => {
    const { result, rerender } = renderHook(() => useLexiconRegistry('project-1'));
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());
    const settled = result.current;

    rerender();

    expect(result.current).toBe(settled);
  });

  it('answers for the project in view, so a second project gets its own link', async () => {
    const { result, rerender } = renderHook(({ projectId }) => useLexiconRegistry(projectId), {
      initialProps: { projectId: 'project-1' },
    });
    await waitFor(() => expect(result.current.resolverWith('search')).toBeDefined());

    storeLink('fw-lite', 'lex-2');
    rerender({ projectId: 'project-2' });

    await waitFor(() => expect(provider.connect).toHaveBeenLastCalledWith('lex-2'));
  });
});
