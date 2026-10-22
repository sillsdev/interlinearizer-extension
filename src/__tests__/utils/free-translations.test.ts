/// <reference types="jest" />

import type { SegmentAnalysis, TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { analysisHasFreeTranslations } from '../../utils/free-translations';
import { FIXTURE_STAMPS } from '../test-helpers';

function withSegmentAnalyses(...analyses: Partial<SegmentAnalysis>[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    segmentAnalyses: analyses.map((analysis, i) => ({
      id: `sa-${i}`,
      ...FIXTURE_STAMPS,
      surfaceText: 'In the beginning',
      ...analysis,
    })),
  };
}

describe('analysisHasFreeTranslations', () => {
  it('finds a free translation on any segment analysis', () => {
    expect(
      analysisHasFreeTranslations(
        withSegmentAnalyses({}, { freeTranslation: { en: 'In the start' } }),
      ),
    ).toBe(true);
  });

  it('finds none in an analysis without segment analyses', () => {
    expect(analysisHasFreeTranslations(emptyAnalysis())).toBe(false);
  });

  it('counts a free translation holding only whitespace as none', () => {
    expect(analysisHasFreeTranslations(withSegmentAnalyses({ freeTranslation: { en: ' ' } }))).toBe(
      false,
    );
  });

  it('counts a literal translation as none', () => {
    expect(
      analysisHasFreeTranslations(withSegmentAnalyses({ literalTranslation: { en: 'In the' } })),
    ).toBe(false);
  });
});
