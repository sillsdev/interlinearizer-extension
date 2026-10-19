/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import type { WarningLogger } from '../../types/analysis-repository';
import { emptyAnalysis } from '../../types/empty-factories';
import { reportAnalysisViolations } from '../../utils/analysis-violations';
import { FIXTURE_STAMPS } from '../test-helpers';

function silentLogger(): WarningLogger & { warn: jest.Mock } {
  return { warn: jest.fn() };
}

function linkTo(analysisId: string, tokenRef: string, id = `tl-${tokenRef}`): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'word' },
  };
}

function analysisWithLinks(tokenAnalysisLinks: TokenAnalysisLink[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'word', gloss: { en: 'word' } }],
    tokenAnalysisLinks,
  };
}

describe('reportAnalysisViolations', () => {
  it('reports nothing for an absent analysis', () => {
    const logger = silentLogger();

    reportAnalysisViolations(logger, undefined, 'project abc on load');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports a null analysis as structurally invalid', () => {
    const logger = silentLogger();

    // eslint-disable-next-line no-null/no-null -- the corrupt stored shape under test
    reportAnalysisViolations(logger, null, 'project abc on load');

    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: project abc on load has a structurally invalid analysis',
    );
  });

  it('reports a misshapen analysis once, without checking its invariants', () => {
    const logger = silentLogger();

    reportAnalysisViolations(logger, { tokenAnalysisLinks: 'GEN' }, 'project abc on load');

    expect(logger.warn.mock.calls).toEqual([
      ['Interlinearizer: project abc on load has a structurally invalid analysis'],
    ]);
  });

  it('reports nothing for an analysis whose collections agree', () => {
    const logger = silentLogger();

    reportAnalysisViolations(logger, analysisWithLinks([linkTo('ta-1', 'GEN 1:1:0')]), 'x');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports each violation kind once, with its count and a sample', () => {
    const logger = silentLogger();
    const analysis = analysisWithLinks([
      linkTo('ta-missing', 'GEN 1:1:0'),
      linkTo('ta-missing', 'GEN 1:1:4'),
      linkTo('ta-1', 'GEN 1:1:8', 'tl-same'),
      linkTo('ta-1', 'GEN 1:1:12', 'tl-same'),
    ]);

    reportAnalysisViolations(logger, analysis, 'project abc on save');

    expect(logger.warn.mock.calls).toEqual([
      [
        'Interlinearizer: project abc on save has 2 token-layer danglingLink violation(s): GEN 1:1:0, GEN 1:1:4',
      ],
      [
        'Interlinearizer: project abc on save has 1 token-layer duplicateLinkId violation(s): tl-same',
      ],
    ]);
  });
});
