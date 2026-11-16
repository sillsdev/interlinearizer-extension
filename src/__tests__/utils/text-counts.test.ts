/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import { countTextOfEveryTag, isLanguageTextCounts } from '../../utils/text-counts';
import { FIXTURE_STAMPS } from '../test-helpers';

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
          morphemes: [
            { id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { tpi: 'pis' } },
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
          freeTranslation: { fr: 'Un gros poisson.', en: '  ' },
        },
        { id: 'sa-2', ...FIXTURE_STAMPS, surfaceText: 'Fish.' },
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
