/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { summarizeAnalysis } from '../../utils/project-analysis-summary';
import { FIXTURE_STAMPS, makePhraseLink } from '../test-helpers';

/** Creates a minimal {@link TokenAnalysis} payload record fixture. */
function mkTokenAnalysis(id: string): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText: id };
}

/** Creates a {@link TokenAnalysisLink} joining a token ref to an analysis id. */
function mkTokenLink(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: tokenRef },
  };
}

/** Builds a {@link TextAnalysis} with the given token analyses and links, other layers empty. */
function mkAnalysis(overrides: Partial<TextAnalysis> = {}): TextAnalysis {
  return {
    tokenAnalyses: [],
    tokenAnalysisLinks: [],
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    phraseAnalyses: [],
    phraseAnalysisLinks: [],
    ...overrides,
  };
}

describe('summarizeAnalysis', () => {
  it('counts token analyses and collects the books their links reference', () => {
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1'), mkTokenAnalysis('a2')],
      tokenAnalysisLinks: [mkTokenLink('a1', 'GEN 1:1:0'), mkTokenLink('a2', 'EXO 2:3:4')],
    });

    expect(summarizeAnalysis(analysis)).toEqual({
      books: ['GEN', 'EXO'],
      tokenAnalysisCount: 2,
    });
  });

  it('ignores segment and phrase analyses, which the row does not describe', () => {
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1')],
      tokenAnalysisLinks: [mkTokenLink('a1', 'GEN 1:1:0')],
      segmentAnalyses: [{ ...FIXTURE_STAMPS, id: 's1', surfaceText: 's1' }],
      segmentAnalysisLinks: [
        { ...FIXTURE_STAMPS, analysisId: 's1', status: 'approved', segmentId: 'LEV 1:1' },
      ],
      phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'p1', surfaceText: 'p1' }],
      phraseAnalysisLinks: [makePhraseLink('p1', ['NUM 1:1:0'])],
    });

    expect(summarizeAnalysis(analysis)).toEqual({ books: ['GEN'], tokenAnalysisCount: 1 });
  });

  it('lists each book once, however many links it has', () => {
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1'), mkTokenAnalysis('a2'), mkTokenAnalysis('a3')],
      tokenAnalysisLinks: [
        mkTokenLink('a1', 'MRK 1:1:0'),
        mkTokenLink('a2', 'GEN 1:1:0'),
        mkTokenLink('a3', 'GEN 5:2:0'),
      ],
    });

    expect(summarizeAnalysis(analysis).books).toEqual(['GEN', 'MRK']);
  });

  it('lists the books in canonical order, not the order their links happen to appear', () => {
    // Alphabetically these sort DEU, EXO, GEN, LEV — so any of the three differs from canonical.
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1'), mkTokenAnalysis('a2'), mkTokenAnalysis('a3')],
      tokenAnalysisLinks: [
        mkTokenLink('a1', 'LEV 1:1:0'),
        mkTokenLink('a2', 'GEN 1:1:0'),
        mkTokenLink('a3', 'EXO 1:1:0'),
      ],
    });

    expect(summarizeAnalysis(analysis).books).toEqual(['GEN', 'EXO', 'LEV']);
  });

  it('keeps an unrecognized book code in the list rather than dropping the analysis', () => {
    // A corrupt ref stays visible rather than vanishing from a row whose count still includes it.
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1'), mkTokenAnalysis('a2')],
      tokenAnalysisLinks: [mkTokenLink('a1', 'GEN 1:1:0'), mkTokenLink('a2', 'ZZZ 1:1:0')],
    });

    expect(summarizeAnalysis(analysis).books).toEqual(['ZZZ', 'GEN']);
  });

  it('reports no books and a zero count for an untouched analysis', () => {
    expect(summarizeAnalysis(mkAnalysis())).toEqual({ books: [], tokenAnalysisCount: 0 });
  });

  it('counts an analysis payload no link references, so the count matches what is stored', () => {
    const analysis = mkAnalysis({
      tokenAnalyses: [mkTokenAnalysis('a1'), mkTokenAnalysis('orphan')],
      tokenAnalysisLinks: [mkTokenLink('a1', 'GEN 1:1:0')],
    });

    expect(summarizeAnalysis(analysis)).toEqual({ books: ['GEN'], tokenAnalysisCount: 2 });
  });
});
