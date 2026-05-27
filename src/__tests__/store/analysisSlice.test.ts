/** @file Unit tests for store/analysisSlice.ts. */
/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { createAnalysisStore } from '../../store';
import {
  defaultAnalysis,
  defaultState,
  selectApprovedGloss,
  setAnalysis,
  writeGloss,
} from '../../store/analysisSlice';

/**
 * Builds an approved `TokenAnalysisLink` for `tok-1` pointing at the given `TokenAnalysis`.
 *
 * @param ta - The `TokenAnalysis` the link should reference.
 * @returns A `TokenAnalysisLink` with `status: 'approved'` and `tokenRef: 'tok-1'`.
 */
function makeApprovedLink(ta: TokenAnalysis): TokenAnalysisLink {
  return {
    analysisId: ta.id,
    status: 'approved',
    token: { tokenRef: 'tok-1', surfaceText: ta.surfaceText },
  };
}

/**
 * Builds a minimal `TextAnalysis` with a single approved link for `tok-1`/`ta-1`.
 *
 * @param ta - The `TokenAnalysis` payload to include.
 * @returns A `TextAnalysis` seeded with one approved token analysis link.
 */
function makeAnalysis(ta: TokenAnalysis): TextAnalysis {
  return {
    ...defaultAnalysis,
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [makeApprovedLink(ta)],
  };
}

describe('setAnalysis', () => {
  it('replaces the full analysis in state', () => {
    const store = createAnalysisStore();
    const next = makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { und: 'hi' } });

    store.dispatch(setAnalysis(next));

    expect(store.getState().analysis.analysis).toStrictEqual(next);
  });

  it('does not mutate analysisLanguage', () => {
    const store = createAnalysisStore({ analysis: { ...defaultState, analysisLanguage: 'fr' } });
    store.dispatch(setAnalysis(defaultAnalysis));
    expect(store.getState().analysis.analysisLanguage).toBe('fr');
  });
});

describe('writeGloss', () => {
  it('initializes gloss when the existing approved analysis has none', () => {
    // Seed an approved TokenAnalysis with no gloss field, then update it via writeGloss.
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word' }),
        analysisLanguage: 'und',
      },
    });

    store.dispatch(writeGloss('tok-1', 'word', 'hello'));

    const { tokenAnalyses } = store.getState().analysis.analysis;
    expect(tokenAnalyses[0].gloss).toStrictEqual({ und: 'hello' });
  });
});

describe('selectApprovedGloss', () => {
  it('returns empty string when the approved analysis has no gloss for the language', () => {
    // Approved analysis exists but has no gloss entry for the requested language.
    const store = createAnalysisStore({
      analysis: {
        analysis: makeAnalysis({ id: 'ta-1', surfaceText: 'word', gloss: { fr: 'bonjour' } }),
        analysisLanguage: 'en',
      },
    });

    expect(selectApprovedGloss(store.getState().analysis, 'tok-1')).toBe('');
  });
});
