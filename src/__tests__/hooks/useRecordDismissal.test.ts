/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import useRecordDismissal from '../../hooks/useRecordDismissal';
import { makeWebViewState } from '../test-helpers';

/** The hook options a test varies between renders; the rest stay fixed. */
type HookInput = {
  records: readonly string[];
  observedBookRef?: string | undefined;
  draftVersion?: number;
};

/**
 * Renders the hook observing GEN unless told otherwise, with one WebView-state store held across
 * rerenders, so a dismissal persists exactly as it does for a tab. Rerendering takes the whole
 * input afresh rather than a patch, keeping each step's records stated where it is asserted on.
 */
function renderDismissal(initial: HookInput, webViewSeed: Record<string, unknown> = {}) {
  const useWebViewState = makeWebViewState(webViewSeed);
  const { result, rerender } = renderHook(
    (input: HookInput) =>
      useRecordDismissal({
        records: input.records,
        observedBookRef: 'observedBookRef' in input ? input.observedBookRef : 'GEN',
        draftVersion: input.draftVersion ?? 0,
        stateKey: 'dismissedTestRecords',
        useWebViewState,
      }),
    { initialProps: initial },
  );
  return { result, rerenderWith: (input: HookInput) => act(() => rerender(input)) };
}

describe('useRecordDismissal', () => {
  describe('dismissal', () => {
    it('reports every record before any dismissal', () => {
      const { result } = renderDismissal({ records: ['a', 'b'] });

      expect(result.current.undismissed).toEqual(['a', 'b']);
    });

    it('clears the banner for exactly the records it was raised for', () => {
      const { result } = renderDismissal({ records: ['a'] });

      act(() => result.current.onDismiss());

      expect(result.current.undismissed).toEqual([]);
    });

    it('stays down while the same records stay raised', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: ['a'] });

      expect(result.current.undismissed).toEqual([]);
    });

    it('stays down for a tab whose stored dismissal covers every record', () => {
      const { result } = renderDismissal(
        { records: ['a', 'b'] },
        { dismissedTestRecords: ['a', 'b'] },
      );

      expect(result.current.undismissed).toEqual([]);
    });

    it('comes back for a record raised after the dismissal, reporting only that one', () => {
      const { result } = renderDismissal({ records: ['a', 'b'] }, { dismissedTestRecords: ['a'] });

      expect(result.current.undismissed).toEqual(['b']);
    });

    it('keeps another book’s dismissal when dismissing in this one', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['gen'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: ['exo'], observedBookRef: 'EXO' });
      expect(result.current.undismissed).toEqual(['exo']);
      act(() => result.current.onDismiss());

      rerenderWith({ records: ['gen'] });

      expect(result.current.undismissed).toEqual([]);
    });
  });

  describe('dropping a spent dismissal', () => {
    it('comes back when a cleared record is raised again', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: [] });
      expect(result.current.undismissed).toEqual([]);

      // The clearing ended what the dismissal acknowledged, so raising it again is fresh.
      rerenderWith({ records: ['a'] });

      expect(result.current.undismissed).toEqual(['a']);
    });

    it('keeps a dismissal across a visit to another book', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      // The other book reports none of GEN's records, which is not the same as their clearing.
      rerenderWith({ records: [], observedBookRef: 'EXO' });
      rerenderWith({ records: ['a'] });

      expect(result.current.undismissed).toEqual([]);
    });

    it('comes back when the record clears in its own book after a visit elsewhere', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: [], observedBookRef: 'EXO' });
      rerenderWith({ records: [] });
      rerenderWith({ records: ['a'] });

      expect(result.current.undismissed).toEqual(['a']);
    });

    it('reads no clearing while no book is observed', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: [], observedBookRef: undefined });
      rerenderWith({ records: ['a'] });

      expect(result.current.undismissed).toEqual([]);
    });

    it('drops the dismissal when the draft is replaced wholesale', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: ['a'], draftVersion: 1 });

      expect(result.current.undismissed).toEqual(['a']);
    });

    it('drops the dismissal when a replacement keeps one record and clears another', () => {
      const { result, rerenderWith } = renderDismissal({ records: ['a', 'b'] });
      act(() => result.current.onDismiss());

      rerenderWith({ records: ['a'], draftVersion: 1 });

      expect(result.current.undismissed).toEqual(['a']);
    });

    it('keeps a stored dismissal through the mount pass, so a restored tab stays down', () => {
      const { result } = renderDismissal(
        // A restored tab mounts at whatever draft version it left off at, not at zero.
        { records: ['a'], draftVersion: 4 },
        { dismissedTestRecords: ['a'] },
      );

      expect(result.current.undismissed).toEqual([]);
    });
  });
});
