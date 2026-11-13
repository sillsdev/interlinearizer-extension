/// <reference types="jest" />

import { envelopeOf } from '../../types/draft-envelope';
import { emptyDraft } from '../../types/empty-factories';

describe('envelopeOf', () => {
  it('keeps every field of the draft but its analysis and boundaries', () => {
    const draft = {
      ...emptyDraft('src'),
      segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
    };

    const envelope = envelopeOf(draft);

    expect(envelope).not.toHaveProperty('analysis');
    expect(envelope).not.toHaveProperty('segmentation');
    expect({
      ...envelope,
      analysis: draft.analysis,
      segmentation: draft.segmentation,
    }).toStrictEqual(draft);
  });
});
