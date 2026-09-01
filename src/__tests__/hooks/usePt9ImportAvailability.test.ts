/// <reference types="jest" />

import { act, renderHook, waitFor } from '@testing-library/react';
import papi, { logger } from '@papi/frontend';
import usePt9ImportAvailability, { usePt9ImportProbe } from '../../hooks/usePt9ImportAvailability';
import { getMockedPdpGet, makeStubProject } from '../test-helpers';

const mockPdpGet = getMockedPdpGet(papi);

/** Serves a fake Pt9Interlinear provider whose manifest call resolves to `manifest`. */
function mockManifest(manifest: Record<string, string>): void {
  mockPdpGet.mockResolvedValue({ getPt9InterlinearManifest: async () => manifest });
}

describe('usePt9ImportAvailability', () => {
  it('reports true when the probe finds files and no import exists', async () => {
    mockManifest({ 'Lexicon.xml': 'aaaa1111' });

    const { result } = renderHook(() => usePt9ImportAvailability('src-project', [], false));

    await waitFor(() => expect(result.current).toBe(true));
    expect(mockPdpGet).toHaveBeenCalledWith('platformScripture.Pt9Interlinear', 'src-project');
  });

  it('reports false when the manifest is empty', async () => {
    mockManifest({});

    const { result } = renderHook(() => usePt9ImportAvailability('src-project', [], false));

    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('never probes when an import already exists', () => {
    const imported = {
      ...makeStubProject('import-id'),
      pt9Import: { fileHashes: {}, importedAt: '2026-08-01T00:00:00.000Z' },
    };

    const { result } = renderHook(() => usePt9ImportAvailability('src-project', [imported], false));

    expect(result.current).toBe(false);
    expect(mockPdpGet).not.toHaveBeenCalled();
  });

  it('never probes while the project list is still loading', () => {
    renderHook(() => usePt9ImportAvailability('src-project', [], true));

    expect(mockPdpGet).not.toHaveBeenCalled();
  });

  it('reports false when the probe fails', async () => {
    mockPdpGet.mockRejectedValue(new Error('no such projectInterface'));

    const { result } = renderHook(() => usePt9ImportAvailability('src-project', [], false));

    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('returns to false when a re-probe fails after an earlier success', async () => {
    mockManifest({ 'Lexicon.xml': 'aaaa1111' });
    const { result, rerender } = renderHook(
      ({ loading }) => usePt9ImportAvailability('src-project', [], loading),
      { initialProps: { loading: false } },
    );
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ loading: true });
    mockPdpGet.mockRejectedValue(new Error('probe failed'));
    rerender({ loading: false });

    await waitFor(() => expect(mockPdpGet).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(false);
  });

  it('ignores a probe that lands after unmount', async () => {
    let resolveManifest: (m: Record<string, string>) => void = () => {};
    mockPdpGet.mockResolvedValue({
      getPt9InterlinearManifest: () =>
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
    });

    const { unmount } = renderHook(() => usePt9ImportAvailability('src-project', [], false));
    await waitFor(() => expect(mockPdpGet).toHaveBeenCalled());
    unmount();
    resolveManifest({ 'Lexicon.xml': 'aaaa1111' });
    // The ignore flag makes the late result a no-op; reaching here without React act warnings (an
    // update after unmount would emit one) is the observable behavior.
  });
});

describe('usePt9ImportProbe', () => {
  it('moves from pending to available when the manifest lists files', async () => {
    mockManifest({ 'Lexicon.xml': 'aaaa1111' });

    const { result } = renderHook(() => usePt9ImportProbe('src-project', true));

    expect(result.current).toBe('pending');
    await waitFor(() => expect(result.current).toBe('available'));
  });

  it('reports unavailable for an empty manifest', async () => {
    mockManifest({});

    const { result } = renderHook(() => usePt9ImportProbe('src-project', true));

    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  it('reports unavailable when the probe fails', async () => {
    mockPdpGet.mockRejectedValue(new Error('no such projectInterface'));

    const { result } = renderHook(() => usePt9ImportProbe('src-project', true));

    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  it('gives up and reports unavailable when the manifest read never answers', async () => {
    jest.useFakeTimers();
    // A provider that accepts the call and never responds - the hang the timeout exists for.
    mockPdpGet.mockResolvedValue({ getPt9InterlinearManifest: () => new Promise(() => {}) });

    const { result } = renderHook(() => usePt9ImportProbe('src-project', true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe('pending');

    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(result.current).toBe('unavailable');
    expect(jest.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('went unanswered'),
    );
    jest.useRealTimers();
  });

  it('keeps the answer the manifest read gave and drops the timeout behind it', async () => {
    jest.useFakeTimers();
    mockManifest({ 'Lexicon.xml': 'aaaa1111' });

    const { result } = renderHook(() => usePt9ImportProbe('src-project', true));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(result.current).toBe('available');
    expect(jest.mocked(logger.warn)).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('stays pending and never probes while disabled', () => {
    const { result } = renderHook(() => usePt9ImportProbe('src-project', false));

    expect(result.current).toBe('pending');
    expect(mockPdpGet).not.toHaveBeenCalled();
  });
});
