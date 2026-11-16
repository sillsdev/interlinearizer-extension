/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { isEmptyDraft } from '../../utils/empty-draft';
import { makeTokenLink } from '../test-helpers';

describe('isEmptyDraft', () => {
  it('is true for a draft with no records and no boundary edits', () => {
    expect(isEmptyDraft({ analysis: emptyAnalysis(), segmentation: undefined })).toBe(true);
  });

  it('is false for a draft holding a record', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalysisLinks: [makeTokenLink('analysis-1', 'GEN 1:1:0')],
    };

    expect(isEmptyDraft({ analysis, segmentation: undefined })).toBe(false);
  });

  it('is false for a draft that moves a boundary', () => {
    const segmentation = {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
    };

    expect(isEmptyDraft({ analysis: emptyAnalysis(), segmentation })).toBe(false);
  });
});
