/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import type { ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { BOOKLESS_PARTITION, splitAnalysisByBook } from '../../utils/analysis-book';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import { applyChangeSet } from '../../utils/change-set';
import { creating, deleting, FIXTURE_STAMPS, makePhraseLink, updating } from '../test-helpers';

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

    /** {@link withUnlinked}'s record of `kind` under `id`. */
    function stored<Kind extends keyof TextAnalysis>(
      kind: Kind,
      id: string,
    ): TextAnalysis[Kind][number] {
      const records: TextAnalysis[Kind][number][] = withUnlinked()[kind];
      const record = records.find((candidate) => candidate.id === id);
      if (!record) throw new Error(`No ${kind} fixture ${id}`);
      return record;
    }

    const cases: [string, ChangeSet, string[]][] = [
      [
        'a payload edit reaches the books linking it',
        {
          intent: 'gloss',
          tokenAnalyses: updating({
            before: stored('tokenAnalyses', 'ta-and'),
            after: { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'but' },
          }),
        },
        ['GEN'],
      ],
      [
        'a link edit reaches its book',
        {
          intent: 'status',
          tokenAnalysisLinks: updating({
            before: exodusLink,
            after: { ...exodusLink, status: 'approved' },
          }),
        },
        ['EXO'],
      ],
      [
        'deleting the last link to a payload reaches the bookless partition',
        {
          intent: 'clear',
          tokenAnalysisLinks: deleting([stored('tokenAnalysisLinks', 'tl-gen')]),
        },
        ['GEN', BOOKLESS_PARTITION],
      ],
      [
        'deleting a phrase with its payload leaves the bookless partition alone',
        {
          intent: 'removePhrase',
          phraseAnalyses: deleting([stored('phraseAnalyses', 'pa-1')]),
          phraseAnalysisLinks: deleting([stored('phraseAnalysisLinks', 'pa-1')]),
        },
        ['GEN'],
      ],
      [
        'a payload put with no link reaches the bookless partition',
        {
          intent: 'add',
          tokenAnalyses: creating([{ id: 'ta-new', ...FIXTURE_STAMPS, surfaceText: 'new' }]),
        },
        [BOOKLESS_PARTITION],
      ],
      [
        'linking an unlinked payload reaches its new book and the bookless partition',
        {
          intent: 'link',
          tokenAnalysisLinks: creating([{ ...genesisLink, id: 'tl-so', analysisId: 'ta-so' }]),
        },
        ['GEN', BOOKLESS_PARTITION],
      ],
      [
        'relinking a link reaches the bookless partition when its old payload is left unlinked',
        {
          intent: 'relink',
          tokenAnalysisLinks: updating({
            before: exodusLink,
            after: { ...exodusLink, analysisId: 'ta-and' },
          }),
        },
        ['EXO', BOOKLESS_PARTITION],
      ],
      [
        'a segment link into a new book reaches that book',
        {
          intent: 'translate',
          segmentAnalysisLinks: creating([
            { ...link, id: 'sl-lev', analysisId: 'sa-1', segmentId: 'LEV 1:1' },
          ]),
        },
        ['LEV'],
      ],
      [
        'deleting a payload still named by links reaches their books',
        { intent: 'delete', tokenAnalyses: deleting([stored('tokenAnalyses', 'ta-And')]) },
        ['EXO'],
      ],
    ];

    it.each(cases)('%s', (_name, changes, expected) => {
      const base = withUnlinked();
      const before = splitAnalysisByBook(base);
      const { draft, applied } = applyChangeSet({ ...emptyDraft('src'), analysis: base }, changes);
      const after = splitAnalysisByBook(draft.analysis);
      const index = new AnalysisIndex(base);

      const reached = index.reach(applied);
      index.apply(applied);

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
        tokenAnalysisLinks: updating({
          before: genesisLink,
          after: { ...genesisLink, token: { tokenRef: 'EXO 1:1:4', surfaceText: 'and' } },
        }),
      };
      const { draft, applied } = applyChangeSet({ ...emptyDraft('src'), analysis: base }, changes);
      const after = splitAnalysisByBook(draft.analysis);
      const index = new AnalysisIndex(base);

      expect([...index.reach(applied)].sort()).toStrictEqual(['EXO', 'GEN']);
      index.apply(applied);

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
