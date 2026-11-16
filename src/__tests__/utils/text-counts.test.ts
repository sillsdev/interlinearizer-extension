/// <reference types="jest" />

import { emptyAnalysis } from '../../types/empty-factories';
import {
  countTextOfEveryTag,
  isLanguageTextCounts,
  isTextCountsByTag,
} from '../../utils/text-counts';
import { FIXTURE_STAMPS } from '../test-helpers';

describe('countTextOfEveryTag', () => {
  it('counts a tag named like an inherited property as its own, leaving every object alone', () => {
    const analysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: JSON.parse('{"__proto__": "fish", "constructor": "fish"}'),
        },
      ],
    };

    const counts = countTextOfEveryTag(analysis);

    expect(Object.entries(counts)).toStrictEqual([
      ['__proto__', { glosses: 1, freeTranslations: 0 }],
      ['constructor', { glosses: 1, freeTranslations: 0 }],
    ]);
    expect(Object.prototype).not.toHaveProperty('glosses');
  });

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

describe('isTextCountsByTag', () => {
  it('accepts counts keyed by tag', () => {
    expect(isTextCountsByTag({ fr: { glosses: 2, freeTranslations: 0 } })).toBe(true);
  });

  it.each([undefined, 'counts', [{ glosses: 2, freeTranslations: 0 }], { fr: { glosses: 2 } }])(
    'refuses %p',
    (value) => {
      expect(isTextCountsByTag(value)).toBe(false);
    },
  );
});
