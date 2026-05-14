/** @file Unit tests for useOptimisticBooleanSetting hook. */
/// <reference types="jest" />

import { useProjectSetting } from '@papi/frontend/react';
import { act, renderHook } from '@testing-library/react';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';

const mockUseProjectSetting = jest.mocked(useProjectSetting);

const SETTING_KEY = 'interlinearizer.continuousScroll' as const;
const TIMEOUT_MS = 15_000;

describe('useOptimisticBooleanSetting', () => {
  let mockSetSetting: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockSetSetting = jest.fn();
    mockUseProjectSetting.mockReturnValue([false, mockSetSetting, jest.fn(), false]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the persisted setting value as the initial display value', () => {
    mockUseProjectSetting.mockReturnValue([true, mockSetSetting, jest.fn(), false]);
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    expect(result.current.value).toBe(true);
  });

  it('falls back to defaultValue when the persisted setting is not yet a boolean', () => {
    mockUseProjectSetting.mockReturnValue([undefined, mockSetSetting, jest.fn(), false]);
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );
    expect(result.current.value).toBe(true);
  });

  it('updates the display value immediately on change (optimistic update)', () => {
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    expect(result.current.value).toBe(true);
  });

  it('calls setSetting with the new value on change', () => {
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    expect(mockSetSetting).toHaveBeenCalledWith(true);
  });

  it('ignores incoming setting updates while the timeout is active', () => {
    // Setting not yet loaded so `setting` starts as non-boolean.
    mockUseProjectSetting.mockReturnValue([undefined, mockSetSetting, jest.fn(), false]);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );

    act(() => {
      result.current.onChange(false);
    });
    expect(result.current.value).toBe(false);

    // Simulate the store returning a conflicting value during the lock period.
    mockUseProjectSetting.mockReturnValue([true, mockSetSetting, jest.fn(), false]);
    rerender();

    // Value should remain at the optimistically set value.
    expect(result.current.value).toBe(false);
  });

  it('accepts incoming setting updates after the timeout elapses', () => {
    // Setting not yet loaded so `setting` starts as non-boolean.
    mockUseProjectSetting.mockReturnValue([undefined, mockSetSetting, jest.fn(), false]);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, true),
    );

    // Make an optimistic change and let the store return a conflicting value.
    act(() => {
      result.current.onChange(false);
    });
    mockUseProjectSetting.mockReturnValue([true, mockSetSetting, jest.fn(), false]);
    rerender();
    expect(result.current.value).toBe(false); // Locked to optimistic value.

    // Fire the timeout — lock is released and incoming setting changes are accepted again.
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS);
    });

    // The store value (true) should now be accepted when setting changes.
    mockUseProjectSetting.mockReturnValue([false, mockSetSetting, jest.fn(), false]);
    rerender();
    expect(result.current.value).toBe(false);
  });

  it('clears the first timeout when onChange is called a second time', () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );

    act(() => {
      result.current.onChange(true);
    });
    act(() => {
      result.current.onChange(false); // second call should clear the first timer
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('does not accept setting updates until the reset timeout elapses after back-to-back onChange calls', () => {
    // Start with a non-boolean setting so the initial useEffect bails early.
    mockUseProjectSetting.mockReturnValue([undefined, mockSetSetting, jest.fn(), false]);
    const { result, rerender } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );

    act(() => {
      result.current.onChange(true); // timer A starts at t=0
    });
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS - 1_000); // t=14000
    });
    act(() => {
      result.current.onChange(true); // timer A cleared, timer B starts at t=14000
    });

    // At t=15000, timer A would have fired but was cleared — lock still active.
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    // Arriving setting is ignored while locked.
    mockUseProjectSetting.mockReturnValue([false, mockSetSetting, jest.fn(), false]);
    rerender();
    expect(result.current.value).toBe(true); // locked; update blocked

    // Timer B fires at t=29000 — lock released.
    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS - 1_000);
    });
    // New setting value (different from the false that arrived during the lock) triggers the effect.
    mockUseProjectSetting.mockReturnValue([true, mockSetSetting, jest.fn(), false]);
    rerender();
    expect(result.current.value).toBe(true); // lock released; setting accepted
  });

  it('clears the pending timeout on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() =>
      useOptimisticBooleanSetting('project-1', SETTING_KEY, false),
    );
    act(() => {
      result.current.onChange(true);
    });
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
