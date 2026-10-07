/// <reference types="jest" />

import { render } from '@testing-library/react';
import type { TokenAnalysisLink } from 'interlinearizer';
import {
  useStaleFreeTranslationsBySegment,
  useStaleTokenLinks,
} from '../../components/AnalysisStore';
import StaleAnalysesReporter from '../../components/StaleAnalysesReporter';
import type { StaleFreeTranslation } from '../../utils/stale-free-translations';
import { FIXTURE_STAMPS, GEN_1_1_BOOK } from '../test-helpers';

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  useStaleTokenLinks: jest.fn(),
  useStaleFreeTranslationsBySegment: jest.fn(),
}));

function staleLink(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return { ...FIXTURE_STAMPS, analysisId, token: { tokenRef, surfaceText: 'In' }, status: 'stale' };
}

function staleTranslation(analysisId: string, segmentId: string): StaleFreeTranslation {
  return { analysisId, segmentId, text: 'Au début' };
}

/** Serves the store's stale analyses: these stale links, and these translations by segment. */
function mockStale(
  links: readonly TokenAnalysisLink[],
  translationsBySegment: ReadonlyMap<string, readonly StaleFreeTranslation[]> = new Map(),
): void {
  jest.mocked(useStaleTokenLinks).mockReturnValue(links);
  jest.mocked(useStaleFreeTranslationsBySegment).mockReturnValue(translationsBySegment);
}

describe('StaleAnalysesReporter', () => {
  it('reports a key per place in the book an analysis went stale at', () => {
    mockStale([staleLink('a', 'GEN 1:1:0'), staleLink('b', 'GEN 1:1:0')]);
    const onReport = jest.fn();

    render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookRef: 'GEN',
        glosses: ['gloss a GEN 1:1:0', 'gloss b GEN 1:1:0'],
      }),
    );
  });

  it('leaves out places in other books', () => {
    mockStale([staleLink('a', 'EXO 1:1:0')]);
    const onReport = jest.fn();

    render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ glosses: [] }));
  });

  it('reports a place an analysis went stale at twice over once', () => {
    mockStale([staleLink('a', 'GEN 1:1:0'), staleLink('a', 'GEN 1:1:0')]);
    const onReport = jest.fn();

    render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ glosses: ['gloss a GEN 1:1:0'] }),
    );
  });

  it('reports each stale free translation with the segment showing it, in segment order', () => {
    mockStale(
      [],
      new Map([
        ['GEN 1:1', [staleTranslation('s1', 'GEN 1:1'), staleTranslation('s2', 'GEN 1:1:9')]],
        ['GEN 1:2', [staleTranslation('s3', 'GEN 1:2')]],
      ]),
    );
    const onReport = jest.fn();

    render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        freeTranslations: [
          { key: 'freeTranslation s1', segmentId: 'GEN 1:1' },
          { key: 'freeTranslation s2', segmentId: 'GEN 1:1' },
          { key: 'freeTranslation s3', segmentId: 'GEN 1:2' },
        ],
      }),
    );
  });

  it('reports again when the stale analyses change', () => {
    mockStale([staleLink('a', 'GEN 1:1:0')]);
    const onReport = jest.fn();
    const { rerender } = render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    mockStale([]);
    rerender(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ glosses: [] }));
  });

  it('does not report again when the store rebuilds the same stale analyses', () => {
    mockStale(
      [staleLink('a', 'GEN 1:1:0')],
      new Map([['GEN 1:1', [staleTranslation('s1', 'GEN 1:1')]]]),
    );
    const onReport = jest.fn();
    const { rerender } = render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    mockStale(
      [staleLink('a', 'GEN 1:1:0')],
      new Map([['GEN 1:1', [staleTranslation('s1', 'GEN 1:1')]]]),
    );
    rerender(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('reports to a new receiver what it reported to the last', () => {
    mockStale([staleLink('a', 'GEN 1:1:0')]);
    const { rerender } = render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={jest.fn()} />);
    const onReport = jest.fn();

    rerender(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ glosses: ['gloss a GEN 1:1:0'] }),
    );
  });

  it('reports nothing known once it unmounts', () => {
    mockStale([staleLink('a', 'GEN 1:1:0')]);
    const onReport = jest.fn();
    const { unmount } = render(<StaleAnalysesReporter book={GEN_1_1_BOOK} onReport={onReport} />);

    unmount();

    expect(onReport).toHaveBeenLastCalledWith(undefined);
  });
});
