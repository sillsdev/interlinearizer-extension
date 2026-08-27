/// <reference types="jest" />

import { renderHook, waitFor } from '@testing-library/react';
import papi from '@papi/frontend';
import usePt9ImportAvailability from '../../hooks/usePt9ImportAvailability';
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
