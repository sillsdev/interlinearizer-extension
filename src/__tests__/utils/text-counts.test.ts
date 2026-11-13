/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { countTextByTag, isTextCountsByTag } from '../../utils/text-counts';
import { FIXTURE_STAMPS } from '../test-helpers';

describe('countTextByTag', () => {
  it('counts word, morpheme, and phrase glosses and free translations in each tag', () => {
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
      segmentAnalyses: [
        {
          id: 'sa-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'Big fish.',
          freeTranslation: { fr: 'Un gros poisson.' },
        },
        { id: 'sa-2', ...FIXTURE_STAMPS, surfaceText: 'Fish.' },
      ],
    };

    expect(countTextByTag(analysis, ['en', 'fr', 'de'])).toStrictEqual({
      en: { glosses: 3, freeTranslations: 0 },
      fr: { glosses: 1, freeTranslations: 1 },
      de: { glosses: 0, freeTranslations: 0 },
    });
  });

  it('leaves out blank text', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: ' ', fr: '' } },
      ],
      segmentAnalyses: [
        { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'Big fish.', freeTranslation: { en: '  ' } },
      ],
    };

    expect(countTextByTag(analysis, ['en', 'fr'])).toStrictEqual({
      en: { glosses: 0, freeTranslations: 0 },
      fr: { glosses: 0, freeTranslations: 0 },
    });
  });
});

describe('isTextCountsByTag', () => {
  it.each([{}, { en: { glosses: 2, freeTranslations: 0 } }])('accepts %p', (value) => {
    expect(isTextCountsByTag(value)).toBe(true);
  });

  it.each([
    undefined,
    'counts',
    [1, 2],
    { en: 2 },
    { en: undefined },
    { en: { glosses: 2 } },
    { en: { glosses: '2', freeTranslations: 0 } },
    { en: { glosses: 2, freeTranslations: '0' } },
  ])('refuses %p', (value) => {
    expect(isTextCountsByTag(value)).toBe(false);
  });
});
