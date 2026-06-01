/** @file Unit tests for the useArcSplitHandler hook. */
/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import { useArcSplitHandler } from '../../hooks/useArcSplitHandler';

// ---------------------------------------------------------------------------
// AnalysisStore mock — supply spyable phrase dispatch callbacks
// ---------------------------------------------------------------------------

const mockCreatePhrase = jest.fn<string, [unknown]>().mockReturnValue('new-phrase');
const mockUpdatePhrase = jest.fn();
const mockDeletePhrase = jest.fn();

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseDispatch: () => ({
    createPhrase: mockCreatePhrase,
    updatePhrase: mockUpdatePhrase,
    deletePhrase: mockDeletePhrase,
  }),
}));

/**
 * Builds a phrase link map keyed by `analysisId`, mirroring how {@link usePhraseLinkByIdMap} indexes
 * its links for O(1) lookup by phrase id.
 *
 * @param link - The phrase link to index.
 * @returns A map from the link's `analysisId` to the link.
 */
function linkMap(link: PhraseAnalysisLink): Map<string, PhraseAnalysisLink> {
  return new Map([[link.analysisId, link]]);
}

describe('useArcSplitHandler', () => {
  beforeEach(() => {
    mockCreatePhrase.mockReturnValue('new-phrase');
  });

  it('is a no-op when no phrase in the map matches the given id', () => {
    const link: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    const { result } = renderHook(() => useArcSplitHandler(linkMap(link), new Map()));

    result.current('phrase-absent', 'tok-0');

    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
    expect(mockDeletePhrase).not.toHaveBeenCalled();
  });

  it('deletes the phrase when both halves of a two-token split are solo', () => {
    const link: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    const { result } = renderHook(() => useArcSplitHandler(linkMap(link), new Map()));

    result.current('phrase-1', 'tok-0');

    expect(mockDeletePhrase).toHaveBeenCalledWith('phrase-1');
    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
  });

  it('orders tokens by tokenDocOrder before slicing, splitting into two new phrases', () => {
    // Stored out of document order to prove tokenDocOrder drives the boundary.
    const link: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-3', surfaceText: 'd' },
        { tokenRef: 'tok-0', surfaceText: 'a' },
        { tokenRef: 'tok-2', surfaceText: 'c' },
        { tokenRef: 'tok-1', surfaceText: 'b' },
      ],
    };
    const tokenDocOrder = new Map([
      ['tok-0', 0],
      ['tok-1', 1],
      ['tok-2', 2],
      ['tok-3', 3],
    ]);
    const { result } = renderHook(() => useArcSplitHandler(linkMap(link), tokenDocOrder));

    result.current('phrase-1', 'tok-1');

    expect(mockUpdatePhrase).toHaveBeenCalledWith('phrase-1', [
      { tokenRef: 'tok-0', surfaceText: 'a' },
      { tokenRef: 'tok-1', surfaceText: 'b' },
    ]);
    expect(mockCreatePhrase).toHaveBeenCalledWith([
      { tokenRef: 'tok-2', surfaceText: 'c' },
      { tokenRef: 'tok-3', surfaceText: 'd' },
    ]);
  });
});
