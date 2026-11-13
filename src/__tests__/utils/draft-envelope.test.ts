/// <reference types="jest" />

import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { envelopeOf } from '../../utils/draft-envelope';

describe('envelopeOf', () => {
  it('keeps every field of the draft but its analysis and boundaries', () => {
    const draft = {
      ...emptyDraft('src'),
      analysisLanguages: ['en'],
      targetProjectId: 'tgt',
      suggestedDescription: 'A draft',
      dirty: true,
      analysis: emptyAnalysis(),
      segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
    };

    expect(envelopeOf(draft)).toStrictEqual({
      sourceProjectId: 'src',
      modelVersion: draft.modelVersion,
      analysisLanguages: ['en'],
      targetProjectId: 'tgt',
      suggestedDescription: 'A draft',
      dirty: true,
    });
  });

  it('leaves out the optional fields that the draft lacks', () => {
    const draft = emptyDraft('src');

    expect(Object.keys(envelopeOf(draft))).toStrictEqual([
      'sourceProjectId',
      'modelVersion',
      'analysisLanguages',
      'dirty',
    ]);
  });
});
