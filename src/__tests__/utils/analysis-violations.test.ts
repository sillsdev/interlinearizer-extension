/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { reportAnalysisViolations } from '../../utils/analysis-violations';
import { FIXTURE_STAMPS, makeTokenLink, silentLogger } from '../test-helpers';

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

    reportAnalysisViolations(logger, analysisWithLinks([makeTokenLink('ta-1', 'GEN 1:1:0')]), 'x');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports each violation kind once, with its count and a sample', () => {
    const logger = silentLogger();
    const analysis = analysisWithLinks([
      makeTokenLink('ta-missing', 'GEN 1:1:0'),
      makeTokenLink('ta-missing', 'GEN 1:1:4'),
      makeTokenLink('ta-1', 'GEN 1:1:8', { id: 'tl-same' }),
      makeTokenLink('ta-1', 'GEN 1:1:12', { id: 'tl-same' }),
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
