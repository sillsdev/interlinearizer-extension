/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { isGlossRetagCounts, retagGlosses } from '../../utils/retag-glosses';
import { FIXTURE_STAMPS } from '../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

function analysisOf(fields: Partial<TextAnalysis>): TextAnalysis {
  return { ...emptyAnalysis(), ...fields };
}

describe('retagGlosses', () => {
  it('moves word, morpheme, and phrase glosses to the new tag and stamps what it changed', () => {
    const analysis = analysisOf({
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish', fr: 'poisson' },
          morphemes: [
            { id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { en: 'fish' } },
            { id: 'm-2', form: 's', writingSystem: 'x', gloss: { en: 'PL' } },
          ],
        },
      ],
      phraseAnalyses: [
        { id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { en: 'whale' } },
      ],
    });

    const { counts, tokenAnalyses, phraseAnalyses } = retagGlosses(analysis, 'en', 'es', NOW);

    expect(counts).toEqual({ words: 2, morphemes: 2, skipped: 0 });
    expect(tokenAnalyses.map(({ id }) => id)).toEqual(['ta-1']);
    expect(phraseAnalyses.map(({ id }) => id)).toEqual(['pa-1']);
    const [token] = analysis.tokenAnalyses;
    expect(token.gloss).toEqual({ fr: 'poisson', es: 'fish' });
    expect(token.morphemes?.map(({ gloss }) => gloss)).toEqual([{ es: 'fish' }, { es: 'PL' }]);
    expect(token.updatedAt).toBe(NOW);
    expect(analysis.phraseAnalyses[0]).toMatchObject({ gloss: { es: 'whale' }, updatedAt: NOW });
  });

  it('drops a gloss whose word or morpheme already has the same one under the new tag, as moved', () => {
    const analysis = analysisOf({
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish', es: 'fish ' },
          morphemes: [
            { id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { en: 'fish', es: 'fish' } },
          ],
        },
      ],
      phraseAnalyses: [
        {
          id: 'pa-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'big fish',
          gloss: { en: 'whale', es: 'whale' },
        },
      ],
    });

    const { counts, tokenAnalyses, phraseAnalyses } = retagGlosses(analysis, 'en', 'es', NOW);

    expect(counts).toEqual({ words: 2, morphemes: 1, skipped: 0 });
    expect(tokenAnalyses.map(({ id }) => id)).toEqual(['ta-1']);
    expect(phraseAnalyses.map(({ id }) => id)).toEqual(['pa-1']);
    const [token] = analysis.tokenAnalyses;
    expect(token.gloss).toEqual({ es: 'fish ' });
    expect(token.morphemes?.[0].gloss).toEqual({ es: 'fish' });
    expect(token.updatedAt).toBe(NOW);
    expect(analysis.phraseAnalyses[0]).toMatchObject({ gloss: { es: 'whale' }, updatedAt: NOW });
  });

  it('leaves a gloss whose word or morpheme already has a different one under the new tag, counting it', () => {
    const analysis = analysisOf({
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish', es: 'pez' },
          morphemes: [
            { id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { en: 'fish', es: 'pez' } },
            { id: 'm-2', form: 's', writingSystem: 'x', gloss: { en: 'PL' } },
          ],
        },
      ],
    });

    const { counts, tokenAnalyses } = retagGlosses(analysis, 'en', 'es', NOW);

    expect(counts).toEqual({ words: 0, morphemes: 1, skipped: 2 });
    expect(tokenAnalyses).toHaveLength(1);
    const [token] = analysis.tokenAnalyses;
    expect(token.gloss).toEqual({ en: 'fish', es: 'pez' });
    expect(token.morphemes?.map(({ gloss }) => gloss)).toEqual([
      { en: 'fish', es: 'pez' },
      { es: 'PL' },
    ]);
  });

  it('moves onto a blank gloss under the new tag', () => {
    const analysis = analysisOf({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'fish', es: ' ' } },
      ],
    });

    expect(retagGlosses(analysis, 'en', 'es', NOW).counts).toEqual({
      words: 1,
      morphemes: 0,
      skipped: 0,
    });
    expect(analysis.tokenAnalyses[0].gloss).toEqual({ es: 'fish' });
  });

  it('changes nothing with no gloss under the old tag, nor a blank one', () => {
    const analysis = analysisOf({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: '  ' } },
        { id: 'ta-2', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { fr: 'poisson' } },
        { id: 'ta-3', ...FIXTURE_STAMPS, surfaceText: 'fish' },
      ],
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'big fish' }],
    });
    const before = JSON.parse(JSON.stringify(analysis));

    const { counts, tokenAnalyses, phraseAnalyses } = retagGlosses(analysis, 'en', 'es', NOW);

    expect(counts).toEqual({ words: 0, morphemes: 0, skipped: 0 });
    expect(tokenAnalyses).toEqual([]);
    expect(phraseAnalyses).toEqual([]);
    expect(analysis).toEqual(before);
  });
});

describe('isGlossRetagCounts', () => {
  it('accepts counts', () => {
    expect(isGlossRetagCounts({ words: 1, morphemes: 0, skipped: 2 })).toBe(true);
  });

  it.each([
    undefined,
    'counts',
    { words: 1, morphemes: 0 },
    { words: '1', morphemes: 0, skipped: 0 },
  ])('refuses %p', (value) => {
    expect(isGlossRetagCounts(value)).toBe(false);
  });
});
