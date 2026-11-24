/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import { SUMMARY_PLACE_COUNT, type ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { BOOKLESS_PARTITION, splitAnalysisByBook } from '../../utils/analysis-book';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import { applyChangeSet } from '../../utils/change-set';
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

  it('gets phrase links by id', () => {
    const index = new AnalysisIndex(analysis());

    expect(ids(index.getPhraseAnalysisLinks(['pa-1', 'missing', 'pa-1']))).toStrictEqual(['pa-1']);
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

  describe('reach and partition', () => {
    const unlinked = { id: 'ta-so', ...FIXTURE_STAMPS, surfaceText: 'so' };
    const [genesisLink, exodusLink] = analysis().tokenAnalysisLinks;

    /** {@link analysis} with a token payload no link references. */
    function withUnlinked(): TextAnalysis {
      const base = analysis();
      return { ...base, tokenAnalyses: [...base.tokenAnalyses, unlinked] };
    }

    const cases: [string, ChangeSet, string[]][] = [
      [
        'a payload edit reaches the books linking it',
        {
          intent: 'gloss',
          tokenAnalyses: {
            puts: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'but' }],
            deletes: [],
          },
        },
        ['GEN'],
      ],
      [
        'a link edit reaches its book',
        {
          intent: 'status',
          tokenAnalysisLinks: { puts: [{ ...exodusLink, status: 'approved' }], deletes: [] },
        },
        ['EXO'],
      ],
      [
        'deleting the last link to a payload reaches the bookless partition',
        { intent: 'clear', tokenAnalysisLinks: { puts: [], deletes: ['tl-gen'] } },
        ['GEN', BOOKLESS_PARTITION],
      ],
      [
        'deleting a phrase with its payload leaves the bookless partition alone',
        {
          intent: 'removePhrase',
          phraseAnalyses: { puts: [], deletes: ['pa-1'] },
          phraseAnalysisLinks: { puts: [], deletes: ['pa-1'] },
        },
        ['GEN'],
      ],
      [
        'a payload put with no link reaches the bookless partition',
        {
          intent: 'add',
          tokenAnalyses: {
            puts: [{ id: 'ta-new', ...FIXTURE_STAMPS, surfaceText: 'new' }],
            deletes: [],
          },
        },
        [BOOKLESS_PARTITION],
      ],
      [
        'linking an unlinked payload reaches its new book and the bookless partition',
        {
          intent: 'link',
          tokenAnalysisLinks: {
            puts: [{ ...genesisLink, id: 'tl-so', analysisId: 'ta-so' }],
            deletes: [],
          },
        },
        ['GEN', BOOKLESS_PARTITION],
      ],
      [
        'relinking a link reaches the bookless partition when its old payload is left unlinked',
        {
          intent: 'relink',
          tokenAnalysisLinks: { puts: [{ ...exodusLink, analysisId: 'ta-and' }], deletes: [] },
        },
        ['EXO', BOOKLESS_PARTITION],
      ],
      [
        'a segment link into a new book reaches that book',
        {
          intent: 'translate',
          segmentAnalysisLinks: {
            puts: [{ ...link, id: 'sl-lev', analysisId: 'sa-1', segmentId: 'LEV 1:1' }],
            deletes: [],
          },
        },
        ['LEV'],
      ],
      [
        'deleting a payload still named by links reaches their books',
        { intent: 'delete', tokenAnalyses: { puts: [], deletes: ['ta-And'] } },
        ['EXO'],
      ],
    ];

    it.each(cases)('%s', (_name, changes, expected) => {
      const base = withUnlinked();
      const before = splitAnalysisByBook(base);
      const after = splitAnalysisByBook(
        applyChangeSet({ ...emptyDraft('src'), analysis: base }, changes).draft.analysis,
      );
      const index = new AnalysisIndex(base);

      const reached = index.reach(changes);
      index.apply(changes);

      expect([...reached].sort()).toStrictEqual([...expected].sort());
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
      );
      expect(changed.filter((key) => !reached.has(key))).toStrictEqual([]);
      expect(index.partitionKeys().sort()).toStrictEqual([...after.keys()].sort());
      after.forEach((partition, key) => expect(index.partition(key)).toStrictEqual(partition));
    });

    it('reaches both books of a link moved between them, filing it last in the new one', () => {
      const base = withUnlinked();
      const changes: ChangeSet = {
        intent: 'move',
        tokenAnalysisLinks: {
          puts: [{ ...genesisLink, token: { tokenRef: 'EXO 1:1:4', surfaceText: 'and' } }],
          deletes: [],
        },
      };
      const after = splitAnalysisByBook(
        applyChangeSet({ ...emptyDraft('src'), analysis: base }, changes).draft.analysis,
      );
      const index = new AnalysisIndex(base);

      expect([...index.reach(changes)].sort()).toStrictEqual(['EXO', 'GEN']);
      index.apply(changes);

      expect(index.partition('GEN')).toStrictEqual(after.get('GEN'));
      const exodus = index.partition('EXO');
      expect(exodus?.tokenAnalysisLinks.map(({ id }) => id)).toStrictEqual(['tl-exo', 'tl-gen']);
      expect(after.get('EXO')?.tokenAnalysisLinks.map(({ id }) => id)).toStrictEqual([
        'tl-gen',
        'tl-exo',
      ]);
      expect(ids(exodus?.tokenAnalyses ?? [])).toStrictEqual(
        ids(after.get('EXO')?.tokenAnalyses ?? []),
      );
    });

    it('files no partition where a whole split would file none', () => {
      const index = new AnalysisIndex(analysis());

      expect(index.partition('LEV')).toBeUndefined();
      expect(index.partition(BOOKLESS_PARTITION)).toBeUndefined();
      expect(index.partitionKeys().sort()).toStrictEqual(['EXO', 'GEN']);
    });
  });

  describe('countApprovals', () => {
    it('counts the tokens approving each analysis, leaving out those none approves', () => {
      const index = new AnalysisIndex(analysis());

      expect(index.countApprovals(['ta-and', 'ta-And', 'ta-and'])).toStrictEqual({ 'ta-and': 1 });
    });

    it('moves a token from the analysis it approved to the one it approves now', () => {
      const index = new AnalysisIndex(analysis());
      const [gen] = analysis().tokenAnalysisLinks;

      index.apply({
        intent: 'relink',
        tokenAnalysisLinks: { puts: [{ ...gen, analysisId: 'ta-And' }], deletes: [] },
      });

      expect(index.countApprovals(['ta-and', 'ta-And'])).toStrictEqual({ 'ta-And': 1 });
    });

    it('counts a token again once the payload its approval names is stored again', () => {
      const index = new AnalysisIndex(analysis());
      const [and] = analysis().tokenAnalyses;

      index.apply({ intent: 'drop', tokenAnalyses: { puts: [], deletes: ['ta-and'] } });
      expect(index.countApprovals(['ta-and'])).toStrictEqual({});
      index.apply({ intent: 'restore', tokenAnalyses: { puts: [and], deletes: [] } });

      expect(index.countApprovals(['ta-and'])).toStrictEqual({ 'ta-and': 1 });
    });

    it('stops counting a token whose approved link is removed', () => {
      const index = new AnalysisIndex(analysis());

      index.apply({ intent: 'unlink', tokenAnalysisLinks: { puts: [], deletes: ['tl-gen'] } });

      expect(index.countApprovals(['ta-and'])).toStrictEqual({});
    });

    it('keeps counting a token whose other links change', () => {
      const index = new AnalysisIndex(analysis());
      const [, exo] = analysis().tokenAnalysisLinks;

      index.apply({
        intent: 'suggest',
        tokenAnalysisLinks: {
          puts: [
            {
              ...exo,
              id: 'tl-gen-suggested',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'and' },
            },
          ],
          deletes: [],
        },
      });

      expect(index.countApprovals(['ta-and', 'ta-And'])).toStrictEqual({ 'ta-and': 1 });
    });
  });

  describe('summarizeTokenAnalyses', () => {
    /** A link from `tokenRef` to `analysisId`, approved unless `status` says otherwise. */
    function tokenLink(
      id: string,
      analysisId: string,
      tokenRef: string,
      status: TokenAnalysisLink['status'] = 'approved',
    ): TokenAnalysisLink {
      return { ...link, id, analysisId, status, token: { tokenRef, surfaceText: 'and' } };
    }

    /** {@link analysis}, its token links replaced by `links`. */
    function withLinks(...links: TokenAnalysisLink[]): TextAnalysis {
      return { ...analysis(), tokenAnalysisLinks: links };
    }

    /** The summary of `analysisId` in `index`. */
    function summaryOf(index: AnalysisIndex, analysisId: string) {
      return index.summarizeTokenAnalyses().find(({ analysis: ta }) => ta.id === analysisId);
    }

    it('summarizes every stored token analysis, used or not', () => {
      const index = new AnalysisIndex(analysis());

      expect(ids(index.summarizeTokenAnalyses().map(({ analysis: ta }) => ta))).toStrictEqual([
        'ta-And',
        'ta-and',
      ]);
    });

    it('counts the approving and stale tokens in each book', () => {
      const index = new AnalysisIndex(
        withLinks(
          tokenLink('l-1', 'ta-and', 'GEN 1:1:0'),
          tokenLink('l-2', 'ta-and', 'GEN 1:2:0'),
          tokenLink('l-3', 'ta-and', 'EXO 1:1:0'),
          tokenLink('l-4', 'ta-and', 'EXO 2:1:0', 'stale'),
          tokenLink('l-5', 'ta-and', 'EXO 2:2:0', 'suggested'),
        ),
      );

      expect(summaryOf(index, 'ta-and')).toMatchObject({
        approvalsByBook: { GEN: 2, EXO: 1 },
        staleByBook: { EXO: 1 },
      });
    });

    it('counts a token once however many links carry it to the analysis', () => {
      const index = new AnalysisIndex(
        withLinks(tokenLink('l-1', 'ta-and', 'GEN 1:1:0'), tokenLink('l-2', 'ta-and', 'GEN 1:1:0')),
      );

      expect(summaryOf(index, 'ta-and')?.approvalsByBook).toStrictEqual({ GEN: 1 });
    });

    it('counts a token approved to two analyses toward both', () => {
      const index = new AnalysisIndex(
        withLinks(tokenLink('l-1', 'ta-and', 'GEN 1:1:0'), tokenLink('l-2', 'ta-And', 'GEN 1:1:0')),
      );

      expect(summaryOf(index, 'ta-and')?.approvalsByBook).toStrictEqual({ GEN: 1 });
      expect(summaryOf(index, 'ta-And')?.approvalsByBook).toStrictEqual({ GEN: 1 });
    });

    it('lists the places of the first verses in canonical order, verses whole', () => {
      const firstVerse = Array.from({ length: SUMMARY_PLACE_COUNT - 1 }, (_unused, i) => i * 4);
      const index = new AnalysisIndex(
        withLinks(
          tokenLink('l-exo', 'ta-and', 'EXO 1:1:0'),
          tokenLink('l-gen-3', 'ta-and', 'GEN 1:3:0'),
          ...[8, 0, 4].map((at) => tokenLink(`l-gen-2-${at}`, 'ta-and', `GEN 1:2:${at}`)),
          ...firstVerse.map((at) => tokenLink(`l-gen-1-${at}`, 'ta-and', `GEN 1:1:${at}`)),
        ),
      );

      expect(summaryOf(index, 'ta-and')?.firstApprovals).toStrictEqual([
        ...firstVerse.map((at) => `GEN 1:1:${at}`),
        'GEN 1:2:0',
        'GEN 1:2:4',
        'GEN 1:2:8',
      ]);
    });

    it('lists every place when fewer than a summary lists are held', () => {
      const index = new AnalysisIndex(
        withLinks(
          tokenLink('l-1', 'ta-and', 'EXO 1:1:0', 'stale'),
          tokenLink('l-2', 'ta-and', 'GEN 1:1:0', 'stale'),
        ),
      );

      expect(summaryOf(index, 'ta-and')).toMatchObject({
        firstApprovals: [],
        firstStale: ['GEN 1:1:0', 'EXO 1:1:0'],
      });
    });

    it('lists the same summaries while no apply changes one', () => {
      const index = new AnalysisIndex(analysis());
      const before = index.summarizeTokenAnalyses();

      index.apply({ intent: 'phrase', phraseAnalyses: { puts: [], deletes: ['pa-1'] } });

      expect(index.summarizeTokenAnalyses()).toBe(before);
    });

    it('summarizes again the analyses that an applied link names, before the apply and after', () => {
      const index = new AnalysisIndex(analysis());
      const [gen] = analysis().tokenAnalysisLinks;
      index.summarizeTokenAnalyses();

      index.apply({
        intent: 'relink',
        tokenAnalysisLinks: { puts: [{ ...gen, analysisId: 'ta-And' }], deletes: [] },
      });

      expect(summaryOf(index, 'ta-and')?.approvalsByBook).toStrictEqual({});
      expect(summaryOf(index, 'ta-And')?.approvalsByBook).toStrictEqual({ GEN: 1 });
    });

    it('keeps the summary of an analysis that an apply leaves alone', () => {
      const index = new AnalysisIndex(analysis());
      const before = summaryOf(index, 'ta-And');

      index.apply({ intent: 'unlink', tokenAnalysisLinks: { puts: [], deletes: ['tl-gen'] } });

      expect(summaryOf(index, 'ta-And')).toBe(before);
    });

    it('summarizes a replaced analysis from its new record', () => {
      const index = new AnalysisIndex(analysis());
      const [and] = analysis().tokenAnalyses;
      index.summarizeTokenAnalyses();

      index.apply({
        intent: 'gloss',
        tokenAnalyses: { puts: [{ ...and, gloss: { en: 'also' } }], deletes: [] },
      });

      expect(summaryOf(index, 'ta-and')?.analysis.gloss).toStrictEqual({ en: 'also' });
    });

    it('drops the summary of a deleted analysis', () => {
      const index = new AnalysisIndex(analysis());
      index.summarizeTokenAnalyses();

      index.apply({ intent: 'drop', tokenAnalyses: { puts: [], deletes: ['ta-and'] } });

      expect(summaryOf(index, 'ta-and')).toBeUndefined();
    });
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
          'tokenAnalyses by approving token',
          'tokenAnalyses by approved form',
        ]),
      );
      expect(differences).toContainEqual({
        index: 'tokenAnalysisLinks by bookStatus',
        key: 'EXO/suggested',
        missing: ['tl-exo'],
        extra: [],
      });
      expect(differences).toContainEqual({
        index: 'tokenAnalyses by approving token',
        key: 'ta-and',
        missing: ['GEN 1:1:0'],
        extra: [],
      });
    });

    it('reports none for summaries while none are kept', () => {
      const differences = new AnalysisIndex(emptyAnalysis()).differencesFrom(analysis());

      expect(differences.some(({ index }) => index === 'tokenAnalyses by summary')).toBe(false);
    });

    it('reports each kept summary that differs from the analysis', () => {
      const index = new AnalysisIndex(analysis());
      index.summarizeTokenAnalyses();
      const changed = analysis();
      changed.tokenAnalysisLinks.shift();

      expect(index.differencesFrom(changed)).toContainEqual({
        index: 'tokenAnalyses by summary',
        key: 'ta-and',
        missing: ['ta-and'],
        extra: ['ta-and'],
      });
    });

    it('reports a summary the analysis gives that none is kept for', () => {
      const index = new AnalysisIndex(emptyAnalysis());
      index.summarizeTokenAnalyses();

      expect(index.differencesFrom(analysis())).toContainEqual({
        index: 'tokenAnalyses by summary',
        key: 'ta-and',
        missing: ['ta-and'],
        extra: [],
      });
    });

    it('reports a kept summary of an analysis the analysis lacks', () => {
      const index = new AnalysisIndex(analysis());
      index.summarizeTokenAnalyses();

      expect(index.differencesFrom(emptyAnalysis())).toContainEqual({
        index: 'tokenAnalyses by summary',
        key: 'ta-and',
        missing: [],
        extra: ['ta-and'],
      });
    });

    it('reports the approvals it keeps that an analysis lacks', () => {
      const differences = new AnalysisIndex(analysis()).differencesFrom(emptyAnalysis());

      expect(differences).toContainEqual({
        index: 'tokenAnalyses by approving token',
        key: 'ta-and',
        missing: [],
        extra: ['GEN 1:1:0'],
      });
      expect(differences).toContainEqual({
        index: 'tokenAnalyses by approved form',
        key: 'and',
        missing: [],
        extra: ['GEN 1:1:0'],
      });
    });
  });
});
