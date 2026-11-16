/// <reference types="jest" />

import papi from '@papi/frontend';
import { act, renderHook } from '@testing-library/react';
import { useEvent } from 'platform-bible-react';
import useSessionChange from '../../hooks/useSessionChange';

const ANALYSIS_CHANGED_EVENT = () => () => true;

/** A change to the session `sessionId`, touching nothing. */
function sessionChange(sessionId: string) {
  return { sessionId, changeId: 'c', books: [], analysisIds: [], forms: [], queries: [] };
}

/** Relays `change` to the hook's latest listener, as the platform does. */
function relay(change: unknown): void {
  const handler = [...jest.mocked(useEvent).mock.calls]
    .reverse()
    .find(([event]) => event === ANALYSIS_CHANGED_EVENT)?.[1];
  if (typeof handler !== 'function') throw new Error('nothing listens for the change event');
  act(() => handler(change));
}

beforeEach(() => {
  jest.mocked(papi.network.getNetworkEvent).mockReturnValue(ANALYSIS_CHANGED_EVENT);
});

describe('useSessionChange', () => {
  it('passes on a change to the session', () => {
    const onChange = jest.fn();
    renderHook(() => useSessionChange('s1', onChange));

    relay(sessionChange('s1'));

    expect(onChange).toHaveBeenCalledWith(sessionChange('s1'));
  });

  it('ignores a change to another session', () => {
    const onChange = jest.fn();
    renderHook(() => useSessionChange('s1', onChange));

    relay(sessionChange('s2'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a change addressed to a source project', () => {
    const onChange = jest.fn();
    renderHook(() => useSessionChange('s1', onChange));

    relay({ sourceProjectId: 'p', changeId: 'c', scriptureEdit: { bookId: 'GEN' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores every change while no session is named', () => {
    const onChange = jest.fn();
    renderHook(() => useSessionChange(undefined, onChange));

    relay(sessionChange('s1'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes a change to the latest handler', () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = renderHook(({ onChange }) => useSessionChange('s1', onChange), {
      initialProps: { onChange: first },
    });
    rerender({ onChange: latest });

    relay(sessionChange('s1'));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
