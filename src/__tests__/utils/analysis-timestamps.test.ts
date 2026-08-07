/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { backfillAnalysisTimestamps } from '../../utils/analysis-timestamps';
import { FIXTURE_STAMPS, makePhraseLink } from '../test-helpers';

const FALLBACK = '2026-05-05T05:05:05.000Z';

/**
 * Builds a {@link TextAnalysis} holding one record and one link in every collection, with the
 * timestamp fields omitted the way storage holds records written before those fields existed. A
 * legacy shape cannot be spelled as the current types, hence the widened local view.
 */
function makeLegacyAnalysis(): TextAnalysis {
  const analysis = emptyAnalysis();
  const legacy: {
    segmentAnalyses: { id: string; surfaceText: string }[];
    segmentAnalysisLinks: { analysisId: string; status: string; segmentId: string }[];
    tokenAnalyses: { id: string; surfaceText: string }[];
    tokenAnalysisLinks: {
      analysisId: string;
      status: string;
      token: { tokenRef: string; surfaceText: string };
    }[];
    phraseAnalyses: { id: string; surfaceText: string }[];
    phraseAnalysisLinks: {
      analysisId: string;
      status: string;
      tokens: { tokenRef: string; surfaceText: string }[];
    }[];
  } = analysis;
  legacy.segmentAnalyses.push({ id: 'sa-1', surfaceText: 'In the beginning' });
  legacy.segmentAnalysisLinks.push({ analysisId: 'sa-1', status: 'approved', segmentId: 'seg-1' });
  legacy.tokenAnalyses.push({ id: 'ta-1', surfaceText: 'In' });
  legacy.tokenAnalysisLinks.push({
    analysisId: 'ta-1',
    status: 'approved',
    token: { tokenRef: 'tok-1', surfaceText: 'In' },
  });
  legacy.phraseAnalyses.push({ id: 'pa-1', surfaceText: 'In the' });
  legacy.phraseAnalysisLinks.push({
    analysisId: 'pa-1',
    status: 'approved',
    tokens: [{ tokenRef: 'tok-1', surfaceText: 'In' }],
  });
  return analysis;
}

describe('backfillAnalysisTimestamps', () => {
  it('stamps every legacy analysis payload with the fallback', () => {
    const analysis = makeLegacyAnalysis();

    backfillAnalysisTimestamps(analysis, FALLBACK);

    [analysis.segmentAnalyses[0], analysis.tokenAnalyses[0], analysis.phraseAnalyses[0]].forEach(
      (record) => {
        expect(record.createdAt).toBe(FALLBACK);
        expect(record.updatedAt).toBe(FALLBACK);
      },
    );
  });

  it('stamps every legacy analysis link with the fallback', () => {
    const analysis = makeLegacyAnalysis();

    backfillAnalysisTimestamps(analysis, FALLBACK);

    [
      analysis.segmentAnalysisLinks[0],
      analysis.tokenAnalysisLinks[0],
      analysis.phraseAnalysisLinks[0],
    ].forEach((link) => {
      expect(link.createdAt).toBe(FALLBACK);
      expect(link.updatedAt).toBe(FALLBACK);
    });
  });

  it('leaves timestamps that are already present untouched', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' }],
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['tok-1'])],
    };

    backfillAnalysisTimestamps(analysis, FALLBACK);

    expect(analysis.tokenAnalyses[0].createdAt).toBe(FIXTURE_STAMPS.createdAt);
    expect(analysis.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
    expect(analysis.phraseAnalysisLinks[0].createdAt).toBe(FIXTURE_STAMPS.createdAt);
    expect(analysis.phraseAnalysisLinks[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
  });

  it('fills only the missing half when a record carries one timestamp', () => {
    const analysis = emptyAnalysis();
    const partial: { id: string; surfaceText: string; createdAt: string }[] =
      analysis.tokenAnalyses;
    partial.push({ id: 'ta-1', surfaceText: 'In', createdAt: FIXTURE_STAMPS.createdAt });

    backfillAnalysisTimestamps(analysis, FALLBACK);

    expect(analysis.tokenAnalyses[0].createdAt).toBe(FIXTURE_STAMPS.createdAt);
    expect(analysis.tokenAnalyses[0].updatedAt).toBe(FALLBACK);
  });
});
