/// <reference types="jest" />

import papi from '@papi/frontend';
import { PT9_MANIFEST_TIMEOUT_MS, readPt9Manifest } from '../../utils/pt9-manifest';
import { getMockedPdpGet } from '../test-helpers';

const mockPdpGet = getMockedPdpGet(papi);

describe('readPt9Manifest', () => {
  it('resolves the manifest the source project serves', async () => {
    mockPdpGet.mockResolvedValue({
      getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'aaaa1111' }),
    });

    await expect(readPt9Manifest('src-project')).resolves.toEqual({ 'Lexicon.xml': 'aaaa1111' });
    expect(mockPdpGet).toHaveBeenCalledWith('platformScripture.Pt9Interlinear', 'src-project');
  });

  it('rejects when the source serves no Pt9Interlinear projectInterface', async () => {
    mockPdpGet.mockRejectedValue(new Error('no such projectInterface'));

    await expect(readPt9Manifest('src-project')).rejects.toThrow('no such projectInterface');
  });

  it('rejects when the read goes unanswered, so a caller behind blocking UI can finish', async () => {
    jest.useFakeTimers();
    // A provider that accepts the call and never responds - the hang the timeout exists for.
    mockPdpGet.mockResolvedValue({ getPt9InterlinearManifest: () => new Promise(() => {}) });

    const read = readPt9Manifest('src-project');
    const settled = jest.fn();
    read.catch(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PT9_MANIFEST_TIMEOUT_MS);

    await expect(read).rejects.toThrow('went unanswered');
    jest.useRealTimers();
  });

  it('leaves no timer pending once the read answers', async () => {
    jest.useFakeTimers();
    mockPdpGet.mockResolvedValue({ getPt9InterlinearManifest: async () => ({}) });

    await expect(readPt9Manifest('src-project')).resolves.toEqual({});

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
