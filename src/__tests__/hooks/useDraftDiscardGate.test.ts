/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import useDraftDiscardGate from '../../hooks/useDraftDiscardGate';

/**
 * Renders the gate over a set of rows holding unsaved drafts, which a test can change between steps
 * as a save or cancel beneath the ask would.
 */
function renderGate(initialDrafts: readonly string[]) {
  const discardDraft = jest.fn();
  const { result, rerender } = renderHook(
    (drafts: readonly string[]) =>
      useDraftDiscardGate<'delete'>((analysisId) => drafts.includes(analysisId), discardDraft),
    { initialProps: initialDrafts },
  );
  return {
    result,
    discardDraft,
    holdDrafts: (drafts: readonly string[]) => act(() => rerender(drafts)),
  };
}

describe('useDraftDiscardGate', () => {
  it('runs at once when no row it would drop holds an unsaved draft', () => {
    const { result } = renderGate(['other']);
    const run = jest.fn();

    act(() => result.current.request('delete', ['a', 'b'], run));

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.asking).toBeUndefined();
  });

  it('asks about the first draft the action would drop instead of running', () => {
    const { result } = renderGate(['b', 'c']);
    const run = jest.fn();

    act(() => result.current.request('delete', ['a', 'b', 'c'], run));

    expect(run).not.toHaveBeenCalled();
    expect(result.current.asking).toEqual({ action: 'delete', analysisId: 'b' });
  });

  it('discards the draft asked about once the reader agrees', () => {
    const { result, discardDraft } = renderGate(['a']);
    act(() => result.current.request('delete', ['a'], jest.fn()));

    act(() => result.current.confirm());

    expect(discardDraft).toHaveBeenCalledWith('a');
  });

  it('asks about the next draft once one is given up', () => {
    const { result } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', ['a', 'b'], run));

    act(() => result.current.confirm());

    expect(run).not.toHaveBeenCalled();
    expect(result.current.asking).toEqual({ action: 'delete', analysisId: 'b' });
  });

  it('runs once every draft it would drop has been given up', () => {
    const { result } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', ['a', 'b'], run));
    act(() => result.current.confirm());

    act(() => result.current.confirm());

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.asking).toBeUndefined();
  });

  it('skips a draft saved while an earlier one was being asked about', () => {
    const { result, holdDrafts } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', ['a', 'b'], run));
    holdDrafts(['a']);

    act(() => result.current.confirm());

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('abandons the action and keeps the draft when the reader declines', () => {
    const { result, discardDraft } = renderGate(['a']);
    const run = jest.fn();
    act(() => result.current.request('delete', ['a'], run));

    act(() => result.current.cancel());

    expect(run).not.toHaveBeenCalled();
    expect(discardDraft).not.toHaveBeenCalled();
    expect(result.current.asking).toBeUndefined();
  });
});
