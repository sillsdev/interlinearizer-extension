/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { countGlossesByTag, isGlossCountsByTag } from '../../utils/gloss-counts';
import { FIXTURE_STAMPS } from '../test-helpers';

describe('countGlossesByTag', () => {
  it('counts word, morpheme, and phrase glosses under each tag', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish', fr: 'poisson' },
          morphemes: [
            { id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { en: 'fish' } },
            { id: 'm-2', form: 's', writingSystem: 'x' },
          ],
        },
        { id: 'ta-2', ...FIXTURE_STAMPS, surfaceText: 'big' },
      ],
      phraseAnalyses: [
        { id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { en: 'whale' } },
      ],
    };

    expect(countGlossesByTag(analysis, ['en', 'fr', 'de'])).toStrictEqual({ en: 3, fr: 1, de: 0 });
  });

  it('leaves out blank glosses', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: ' ', fr: '' } },
      ],
    };

    expect(countGlossesByTag(analysis, ['en', 'fr'])).toStrictEqual({ en: 0, fr: 0 });
  });
});

describe('isGlossCountsByTag', () => {
  it.each([{}, { en: 2, fr: 0 }])('accepts %p', (value) => {
    expect(isGlossCountsByTag(value)).toBe(true);
  });

  it.each([undefined, 'counts', [1, 2], { en: '2' }])('refuses %p', (value) => {
    expect(isGlossCountsByTag(value)).toBe(false);
  });
});
