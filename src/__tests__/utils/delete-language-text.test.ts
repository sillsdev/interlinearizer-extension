/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { deleteLanguageText } from '../../utils/delete-language-text';
import { FIXTURE_STAMPS } from '../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

function analysisOf(fields: Partial<TextAnalysis>): TextAnalysis {
  return { ...emptyAnalysis(), ...fields };
}

describe('deleteLanguageText', () => {
  it('deletes the tag from glosses and free translations, counts them, and stamps what it changed', () => {
    const analysis = analysisOf({
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
        { id: 'ta-2', ...FIXTURE_STAMPS, surfaceText: 'big', gloss: { fr: 'gros' } },
      ],
      phraseAnalyses: [
        { id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { en: 'whale' } },
      ],
      segmentAnalyses: [
        {
          id: 'sa-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'Big fish.',
          freeTranslation: { en: 'A big fish.', fr: 'Un gros poisson.' },
        },
      ],
    });

    const { counts, tokenAnalyses, phraseAnalyses, segmentAnalyses } = deleteLanguageText(
      analysis,
      'en',
      NOW,
    );

    expect(counts).toEqual({ glosses: 3, freeTranslations: 1 });
    expect(tokenAnalyses.map(({ id }) => id)).toEqual(['ta-1']);
    expect(phraseAnalyses.map(({ id }) => id)).toEqual(['pa-1']);
    expect(segmentAnalyses.map(({ id }) => id)).toEqual(['sa-1']);
    const [token, untouched] = analysis.tokenAnalyses;
    expect(token.gloss).toEqual({ fr: 'poisson' });
    expect(token.morphemes?.[0].gloss).toEqual({});
    expect(token.updatedAt).toBe(NOW);
    expect(untouched.updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
    expect(analysis.phraseAnalyses[0]).toMatchObject({ gloss: {}, updatedAt: NOW });
    expect(analysis.segmentAnalyses[0]).toMatchObject({
      freeTranslation: { fr: 'Un gros poisson.' },
      updatedAt: NOW,
    });
  });

  it('deletes blank text under the tag without counting it', () => {
    const analysis = analysisOf({
      tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: ' ' } }],
    });

    const { counts, tokenAnalyses } = deleteLanguageText(analysis, 'en', NOW);

    expect(counts).toEqual({ glosses: 0, freeTranslations: 0 });
    expect(tokenAnalyses.map(({ id }) => id)).toEqual(['ta-1']);
    expect(analysis.tokenAnalyses[0].gloss).toEqual({});
  });

  it('changes nothing when no text is under the tag', () => {
    const analysis = analysisOf({
      tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { fr: 'x' } }],
    });

    const deletion = deleteLanguageText(analysis, 'en', NOW);

    expect(deletion).toEqual({
      counts: { glosses: 0, freeTranslations: 0 },
      tokenAnalyses: [],
      phraseAnalyses: [],
      segmentAnalyses: [],
    });
  });
});
