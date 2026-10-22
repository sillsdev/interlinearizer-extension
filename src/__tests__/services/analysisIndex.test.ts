/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import { emptyAnalysis } from '../../types/empty-factories';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import { FIXTURE_STAMPS, makePhraseLink } from '../test-helpers';

const link = { ...FIXTURE_STAMPS, status: 'approved' as const };

/** Records in GEN and EXO, with a heading's segment in GEN and a suggested link in EXO. */
function analysis(): TextAnalysis {
  return {
    segmentAnalyses: [{ id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'The Creation' }],
    segmentAnalysisLinks: [{ ...link, id: 'sl-1', analysisId: 'sa-1', segmentId: 'GEN 1:1/s1' }],
    tokenAnalyses: [
      { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and' },
      { id: 'ta-And', ...FIXTURE_STAMPS, surfaceText: 'And' },
    ],
    tokenAnalysisLinks: [
      {
        ...link,
        id: 'tl-gen',
        analysisId: 'ta-and',
        token: { tokenRef: 'GEN 1:1:0', surfaceText: 'and' },
      },
      {
        ...link,
        id: 'tl-exo',
        analysisId: 'ta-And',
        status: 'suggested',
        token: { tokenRef: 'EXO 1:1:0', surfaceText: 'And' },
      },
    ],
    phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
    phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:4', 'GEN 1:1:7'])],
  };
}

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

describe('AnalysisIndex', () => {
  it('gets payloads of each kind by id', () => {
    const index = new AnalysisIndex(analysis());

    expect(ids(index.getTokenAnalyses(['ta-and', 'missing']))).toStrictEqual(['ta-and']);
    expect(ids(index.getPhraseAnalyses(['pa-1']))).toStrictEqual(['pa-1']);
    expect(ids(index.getSegmentAnalyses(['sa-1']))).toStrictEqual(['sa-1']);
  });

  it('finds token links by token ref, and phrase links by any of their tokens', () => {
    const { tokenAnalysisLinks, phraseAnalysisLinks } = new AnalysisIndex(
      analysis(),
    ).findLinksByToken(['GEN 1:1:0', 'GEN 1:1:7']);

    expect(ids(tokenAnalysisLinks)).toStrictEqual(['tl-gen']);
    expect(ids(phraseAnalysisLinks)).toStrictEqual(['pa-1']);
  });

  it('finds segment links by segment id', () => {
    expect(ids(new AnalysisIndex(analysis()).findLinksBySegment(['GEN 1:1/s1']))).toStrictEqual([
      'sl-1',
    ]);
  });

  it('finds the links of every kind to analyses', () => {
    const links = new AnalysisIndex(analysis()).findLinksToAnalyses(['ta-and', 'pa-1', 'sa-1']);

    expect(ids(links.tokenAnalysisLinks)).toStrictEqual(['tl-gen']);
    expect(ids(links.phraseAnalysisLinks)).toStrictEqual(['pa-1']);
    expect(ids(links.segmentAnalysisLinks)).toStrictEqual(['sl-1']);
  });

  it('files a heading segment link and a phrase link under their books', () => {
    const links = new AnalysisIndex(analysis()).findLinksInBooks(['GEN']);

    expect(ids(links.tokenAnalysisLinks)).toStrictEqual(['tl-gen']);
    expect(ids(links.phraseAnalysisLinks)).toStrictEqual(['pa-1']);
    expect(ids(links.segmentAnalysisLinks)).toStrictEqual(['sl-1']);
  });

  it('finds the links into books with the statuses asked for', () => {
    const links = new AnalysisIndex(analysis()).findLinksInBooks(['GEN', 'EXO'], ['suggested']);

    expect(ids(links.tokenAnalysisLinks)).toStrictEqual(['tl-exo']);
    expect(links.phraseAnalysisLinks).toStrictEqual([]);
    expect(links.segmentAnalysisLinks).toStrictEqual([]);
  });

  it('finds payloads by normalized form', () => {
    const index = new AnalysisIndex(analysis());

    expect(ids(index.findTokenAnalysesByForm([normalizeSurfaceForm('AND')]))).toStrictEqual([
      'ta-And',
      'ta-and',
    ]);
    expect(ids(index.findPhraseAnalysesByForm(['in the']))).toStrictEqual(['pa-1']);
  });

  it('keeps every lookup current as changes apply', () => {
    const index = new AnalysisIndex(analysis());

    index.apply({
      intent: 'edit',
      tokenAnalyses: {
        puts: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'but' }],
        deletes: [],
      },
      tokenAnalysisLinks: { puts: [], deletes: ['tl-exo'] },
      phraseAnalyses: { puts: [], deletes: ['pa-1'] },
      phraseAnalysisLinks: { puts: [], deletes: ['pa-1'] },
      segmentAnalyses: { puts: [], deletes: ['sa-1'] },
      segmentAnalysisLinks: { puts: [], deletes: ['sl-1'] },
    });

    expect(ids(index.findTokenAnalysesByForm(['and']))).toStrictEqual(['ta-And']);
    expect(ids(index.findTokenAnalysesByForm(['but']))).toStrictEqual(['ta-and']);
    expect(index.findLinksInBooks(['GEN', 'EXO'])).toStrictEqual({
      tokenAnalysisLinks: [analysis().tokenAnalysisLinks[0]],
      phraseAnalysisLinks: [],
      segmentAnalysisLinks: [],
    });
    expect(index.findPhraseAnalysesByForm(['in the'])).toStrictEqual([]);
    expect(index.getSegmentAnalyses(['sa-1'])).toStrictEqual([]);
  });

  describe('differencesFrom', () => {
    it('reports none against the analysis it was built from', () => {
      expect(new AnalysisIndex(analysis()).differencesFrom(analysis())).toStrictEqual([]);
    });

    it('reports none once kept current through changes the analysis also took', () => {
      const index = new AnalysisIndex(analysis());
      const changed = analysis();
      changed.tokenAnalysisLinks.pop();

      index.apply({ intent: 'delete', tokenAnalysisLinks: { puts: [], deletes: ['tl-exo'] } });

      expect(index.differencesFrom(changed)).toStrictEqual([]);
    });

    it('reports the records and entries of every kind that an analysis holds differently', () => {
      const differences = new AnalysisIndex(emptyAnalysis()).differencesFrom(analysis());

      expect(new Set(differences.map(({ index }) => index))).toStrictEqual(
        new Set([
          'tokenAnalyses',
          'tokenAnalyses by form',
          'phraseAnalyses',
          'phraseAnalyses by form',
          'segmentAnalyses',
          'tokenAnalysisLinks',
          'tokenAnalysisLinks by analysisId',
          'tokenAnalysisLinks by book',
          'tokenAnalysisLinks by bookStatus',
          'tokenAnalysisLinks by tokenRef',
          'phraseAnalysisLinks',
          'phraseAnalysisLinks by analysisId',
          'phraseAnalysisLinks by book',
          'phraseAnalysisLinks by bookStatus',
          'phraseAnalysisLinks by tokenRef',
          'segmentAnalysisLinks',
          'segmentAnalysisLinks by analysisId',
          'segmentAnalysisLinks by book',
          'segmentAnalysisLinks by bookStatus',
          'segmentAnalysisLinks by segmentId',
        ]),
      );
      expect(differences).toContainEqual({
        index: 'tokenAnalysisLinks by bookStatus',
        key: 'EXO/suggested',
        missing: ['tl-exo'],
        extra: [],
      });
    });
  });
});
