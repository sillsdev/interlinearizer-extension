/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import useGlossDraft from '../../hooks/useGlossDraft';

/** Renders the hook over a gloss that a test can change, as the store or the lexicon would. */
function renderDraft(stored: string, displayed: string) {
  return renderHook((props) => useGlossDraft(props.stored, props.displayed), {
    initialProps: { stored, displayed },
  });
}

describe('useGlossDraft', () => {
  it('starts from the displayed gloss', () => {
    const { result } = renderDraft('', 'water');

    expect(result.current[0]).toBe('water');
  });

  it('takes a lexicon gloss that arrives before the reader types', () => {
    const { result, rerender } = renderDraft('', '');

    rerender({ stored: '', displayed: 'water' });

    expect(result.current[0]).toBe('water');
  });

  it('keeps what the reader typed when a lexicon gloss arrives mid-edit', () => {
    const { result, rerender } = renderDraft('', '');
    act(() => result.current[1]('river'));

    rerender({ stored: '', displayed: 'water' });

    expect(result.current[0]).toBe('river');
  });

  it('keeps what the reader typed when the lexicon gloss goes away mid-edit', () => {
    const { result, rerender } = renderDraft('', 'water');
    act(() => result.current[1]('waters'));

    rerender({ stored: '', displayed: '' });

    expect(result.current[0]).toBe('waters');
  });

  it('replaces what the reader typed when the stored gloss changes', () => {
    const { result, rerender } = renderDraft('river', 'river');
    act(() => result.current[1]('rive'));

    rerender({ stored: 'stream', displayed: 'stream' });

    expect(result.current[0]).toBe('stream');
  });
});
