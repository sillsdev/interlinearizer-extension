/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { reanchorDraftToMissingBook } from '../../utils/reanchor-draft';
import { FIXTURE_STAMPS, makeTokenLink } from '../test-helpers';

describe('reanchorDraftToMissingBook', () => {
  it('stales an approval in the book', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'beta' }],
      tokenAnalysisLinks: [makeTokenLink('ta-1', 'GEN 1:1:6', { surfaceText: 'beta' })],
    };

    const reanchored = reanchorDraftToMissingBook('GEN')({ analysis, segmentation: undefined });

    expect(reanchored.analysis.tokenAnalysisLinks[0].status).toBe('stale');
  });
});
