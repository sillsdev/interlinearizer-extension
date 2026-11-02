/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { readEditOutcome } from '../../utils/edit-outcome';
import { FIXTURE_STAMPS, makeTokenLink } from '../test-helpers';

/** "In" glossed "at" under `ta-in`, approved on two tokens and suggested on a third. */
const after: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [{ id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
  tokenAnalysisLinks: [
    makeTokenLink('ta-in', 'GEN 1:1:0'),
    makeTokenLink('ta-in', 'GEN 1:2:0'),
    makeTokenLink('ta-in', 'GEN 1:3:0', { status: 'suggested' }),
  ],
};

describe('readEditOutcome', () => {
  it('reads an edit as made in place while its record stands', () => {
    expect(readEditOutcome(after, undefined, 'ta-in', 'en')).toStrictEqual({ kind: 'edited' });
  });

  it('reads an edit as a removal when its record is gone and nothing survived it', () => {
    expect(readEditOutcome(after, undefined, 'ta-gone', 'en')).toStrictEqual({ kind: 'removed' });
  });

  it("reads an edit as a merge into the survivor, with the survivor's gloss and approvals", () => {
    expect(readEditOutcome(after, 'ta-in', 'ta-gone', 'en')).toStrictEqual({
      kind: 'merged',
      survivingAnalysisId: 'ta-in',
      survivingGloss: 'at',
      survivingUsageCount: 2,
    });
  });
});
