/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { countTextByTag, countTextOfEveryTag, isLanguageTextCounts } from '../../utils/text-counts';
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

describe('countTextOfEveryTag', () => {
  it('counts each tag that has text that is not blank, and no other', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish', de: ' ' },
          morphemes: [{ id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { tpi: 'pis' } }],
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
      ],
    };

    expect(countTextOfEveryTag(analysis)).toStrictEqual({
      en: { glosses: 2, freeTranslations: 0 },
      tpi: { glosses: 1, freeTranslations: 0 },
      fr: { glosses: 0, freeTranslations: 1 },
    });
  });
});

describe('isLanguageTextCounts', () => {
  it('accepts counts of both kinds', () => {
    expect(isLanguageTextCounts({ glosses: 2, freeTranslations: 0 })).toBe(true);
  });

  it.each([
    undefined,
    'counts',
    { glosses: 2 },
    { glosses: '2', freeTranslations: 0 },
    { glosses: 2, freeTranslations: '0' },
  ])('refuses %p', (value) => {
    expect(isLanguageTextCounts(value)).toBe(false);
  });
});
