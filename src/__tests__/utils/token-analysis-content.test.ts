/// <reference types="jest" />

import type { TokenAnalysis } from 'interlinearizer';
import { clearAnalysisGloss, isEmptyTokenAnalysis } from '../../utils/token-analysis-content';
import { FIXTURE_STAMPS } from '../test-helpers';

function analysis(fields: Partial<TokenAnalysis> = {}): TokenAnalysis {
  return { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'In', ...fields };
}

describe('isEmptyTokenAnalysis', () => {
  it('finds a record holding only blank glosses and provenance empty', () => {
    expect(isEmptyTokenAnalysis(analysis({ gloss: { en: ' ' }, confidence: 'high' }))).toBe(true);
  });

  it.each([
    ['a gloss', { gloss: { en: 'at' } }],
    ['morphemes', { morphemes: [{ id: 'm-1', form: 'in', writingSystem: 'en' }] }],
    ['a part of speech', { pos: 'prep' }],
    ['features', { features: { case: 'loc' } }],
    ['a gloss sense', { glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }],
  ])('finds a record holding %s not empty', (_field, fields) => {
    expect(isEmptyTokenAnalysis(analysis(fields))).toBe(false);
  });
});

describe('clearAnalysisGloss', () => {
  it('clears one language, keeping the others and the sense', () => {
    const record = analysis({
      gloss: { en: 'at', fr: 'à' },
      glossSenseRef: { authority: 'fwlite', senseId: 's-1' },
    });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ gloss: { fr: 'à' }, glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });

  it('drops the gloss once no language holds usable text, keeping the sense', () => {
    const record = analysis({
      gloss: { en: 'at', fr: ' ' },
      glossSenseRef: { authority: 'fwlite', senseId: 's-1' },
    });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });

  it('leaves a record holding only a sense as it is', () => {
    const record = analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });
});
