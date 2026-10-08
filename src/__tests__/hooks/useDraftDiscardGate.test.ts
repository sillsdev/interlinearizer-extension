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

    act(() => result.current.request('delete', () => ['a', 'b'], run));

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.asking).toBeUndefined();
  });

  it('asks about the first draft the action would drop instead of running', () => {
    const { result } = renderGate(['b', 'c']);
    const run = jest.fn();

    act(() => result.current.request('delete', () => ['a', 'b', 'c'], run));

    expect(run).not.toHaveBeenCalled();
    expect(result.current.asking).toEqual({ action: 'delete', analysisId: 'b' });
  });

  it('discards the draft asked about once the reader agrees', () => {
    const { result, discardDraft } = renderGate(['a']);
    act(() => result.current.request('delete', () => ['a'], jest.fn()));

    act(() => result.current.confirm());

    expect(discardDraft).toHaveBeenCalledWith('a');
  });

  it('asks about the next draft once one is given up', () => {
    const { result } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', () => ['a', 'b'], run));

    act(() => result.current.confirm());

    expect(run).not.toHaveBeenCalled();
    expect(result.current.asking).toEqual({ action: 'delete', analysisId: 'b' });
  });

  it('runs once every draft it would drop has been given up', () => {
    const { result } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', () => ['a', 'b'], run));
    act(() => result.current.confirm());

    act(() => result.current.confirm());

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.asking).toBeUndefined();
  });

  it('skips a draft saved while an earlier one was being asked about', () => {
    const { result, holdDrafts } = renderGate(['a', 'b']);
    const run = jest.fn();
    act(() => result.current.request('delete', () => ['a', 'b'], run));
    holdDrafts(['a']);

    act(() => result.current.confirm());

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('asks about a draft an edit made while asking adds to the rows the action would drop', () => {
    const { result } = renderGate(['a', 'b']);
    const run = jest.fn();
    let dropped = ['a'];
    act(() => result.current.request('delete', () => dropped, run));
    dropped = ['a', 'b'];

    act(() => result.current.confirm());

    expect(run).not.toHaveBeenCalled();
    expect(result.current.asking).toEqual({ action: 'delete', analysisId: 'b' });
  });

  it('runs on the rows the action would drop as last read', () => {
    const { result } = renderGate(['a']);
    const run = jest.fn();
    let dropped = ['a'];
    act(() => result.current.request('delete', () => dropped, run));
    dropped = ['a', 'c'];

    act(() => result.current.confirm());

    expect(run).toHaveBeenCalledWith(['a', 'c']);
  });

  it('keeps a draft given up when an edit while asking takes its row out of the action', () => {
    const { result, discardDraft } = renderGate(['a']);
    let dropped = ['a'];
    act(() => result.current.request('delete', () => dropped, jest.fn()));
    dropped = [];

    act(() => result.current.confirm());

    expect(discardDraft).not.toHaveBeenCalled();
  });

  it('keeps a draft given up for an action the reader declines at a later ask', () => {
    const { result, discardDraft } = renderGate(['a', 'b']);
    act(() => result.current.request('delete', () => ['a', 'b'], jest.fn()));
    act(() => result.current.confirm());

    act(() => result.current.cancel());

    expect(discardDraft).not.toHaveBeenCalled();
  });

  it('abandons the action and keeps the draft when the reader declines', () => {
    const { result, discardDraft } = renderGate(['a']);
    const run = jest.fn();
    act(() => result.current.request('delete', () => ['a'], run));

    act(() => result.current.cancel());

    expect(run).not.toHaveBeenCalled();
    expect(discardDraft).not.toHaveBeenCalled();
    expect(result.current.asking).toBeUndefined();
  });
});
