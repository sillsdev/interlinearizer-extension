/// <reference types="jest" />

import type { Book, TextAnalysis } from 'interlinearizer';
import { describeChange, describeScriptureEdit } from '../../services/analysisChanges';
import { DraftRepository } from '../../services/draftRepository';
import type { ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  FIXTURE_STAMPS,
  makePhraseLink,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

const book = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning' },
  { sid: 'GEN 1:2', text: 'God created' },
  { sid: 'GEN 1:3', text: 'the light' },
]);
const ref = (surfaceText: string) => tokenRefOf(book, surfaceText);

async function repositoryOver(analysis: Partial<TextAnalysis> = {}): Promise<DraftRepository> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return repository;
}

const held = (bookId: string): Book | undefined => (bookId === 'GEN' ? book : undefined);

describe('describeChange', () => {
  it("names the range of the segment a token link was put on, and the link's analysis", async () => {
    const link = makeTokenLink('ta-god', ref('God'));
    const changes: ChangeSet = {
      intent: 'writeGloss',
      tokenAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'writeGloss',
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change).toStrictEqual({
      books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
      analysisIds: ['ta-god'],
      forms: [],
      queries: ['getCatalogRows', 'getConcordance'],
    });
  });

  it('names where a moved link was and where it went, joining neighboring segments into one range', async () => {
    const before = makeTokenLink('ta-a', ref('In'), { id: 'tl' });
    const after = makeTokenLink('ta-b', ref('God'), { id: 'tl' });
    const elsewhere = makeTokenLink('ta-c', ref('light'));
    const changes: ChangeSet = {
      intent: 'move',
      tokenAnalysisLinks: { puts: [after, elsewhere], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'move',
      tokenAnalysisLinks: { puts: [before], deletes: [elsewhere.id] },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'GEN', ranges: [{ start: 0, end: 3 }] }]);
    expect(change.analysisIds).toStrictEqual(['ta-a', 'ta-b', 'ta-c']);
  });

  it('names a book the host holds no outline for whole', async () => {
    const link = makeTokenLink('ta', 'EXO 1:1:0');
    const changes: ChangeSet = { intent: 'x', tokenAnalysisLinks: { puts: [link], deletes: [] } };
    const inverse: ChangeSet = {
      intent: 'x',
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'EXO' }]);
  });

  it('names whole each book whose boundaries the change moved, and only those', async () => {
    const scope = emptyDraft('src');
    const split = {
      removedVerseStarts: ['EXO 1:2:0'],
      addedStarts: [{ tokenRef: ref('created'), surfaceText: 'created' }],
    };
    const link = makeTokenLink('ta', ref('In'));
    const changes: ChangeSet = {
      intent: 'splitSegment',
      scope: { ...scope, segmentation: split },
      tokenAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'splitSegment',
      scope: { ...scope, segmentation: { removedVerseStarts: ['EXO 1:2:0'], addedStarts: [] } },
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'GEN' }]);
  });

  it('names a link on a token the text no longer holds nowhere', async () => {
    const link = makeTokenLink('ta', 'GEN 1:9:0', { status: 'stale' });
    const changes: ChangeSet = {
      intent: 'x',
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };
    const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: { puts: [link], deletes: [] } };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([]);
  });

  it("names the segment of each of a phrase link's tokens", async () => {
    const link = makePhraseLink('pl', [ref('beginning'), ref('light')]);
    const changes: ChangeSet = { intent: 'x', phraseAnalysisLinks: { puts: [link], deletes: [] } };
    const inverse: ChangeSet = {
      intent: 'x',
      phraseAnalysisLinks: { puts: [], deletes: [link.id] },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change).toStrictEqual({
      books: [
        {
          bookId: 'GEN',
          ranges: [
            { start: 0, end: 1 },
            { start: 2, end: 3 },
          ],
        },
      ],
      analysisIds: ['pl'],
      forms: [],
      queries: [],
    });
  });

  it('names a payload change by its analysis alone', async () => {
    const changes: ChangeSet = {
      intent: 'writeAnalysisGloss',
      tokenAnalyses: { puts: [{ id: 'ta', ...FIXTURE_STAMPS, surfaceText: 'God' }], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'writeAnalysisGloss',
      tokenAnalyses: {
        puts: [{ id: 'ta', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'x' } }],
        deletes: [],
      },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change).toStrictEqual({
      books: [],
      analysisIds: ['ta'],
      forms: ['god'],
      queries: ['getCatalogRows', 'getConcordance'],
    });
  });

  describe('a segment link', () => {
    async function rangesFor(segmentId: string) {
      const link = {
        id: 'sl',
        analysisId: 'sa',
        segmentId,
        status: 'stale' as const,
        ...FIXTURE_STAMPS,
      };
      const changes: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [], deletes: ['sl'] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [link], deletes: [] },
      };
      return (await describeChange(await repositoryOver(), { changes, inverse }, held)).books;
    }

    it('names its own segment', async () => {
      expect(await rangesFor('GEN 1:2')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 1, end: 2 }] },
      ]);
    });

    it('names the segment covering a vanished segment it was on', async () => {
      expect(await rangesFor(ref('light'))).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 2, end: 3 }] },
      ]);
    });

    it('names the segment an orphan of a lost verse follows', async () => {
      expect(await rangesFor('GEN 1:7')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 2, end: 3 }] },
      ]);
    });

    it('names the first segment for an orphan ahead of every verse', async () => {
      expect(await rangesFor('GEN 1:0')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 0, end: 1 }] },
      ]);
    });

    it('names nothing in a book holding no text to show it beside', async () => {
      const empty: Book = { ...book, segments: [] };
      const link = {
        id: 'sl',
        analysisId: 'sa',
        segmentId: 'GEN 1:2',
        status: 'stale' as const,
        ...FIXTURE_STAMPS,
      };
      const changes: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [link], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [], deletes: ['sl'] },
      };

      const change = await describeChange(
        await repositoryOver(),
        { changes, inverse },
        () => empty,
      );

      expect(change.books).toStrictEqual([]);
    });
  });

  describe('the stale summary', () => {
    it('is named when a link was or becomes stale', async () => {
      const link = makeTokenLink('ta', ref('God'));
      const changes: ChangeSet = {
        intent: 'x',
        tokenAnalysisLinks: { puts: [{ ...link, status: 'stale' }], deletes: [] },
      };
      const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: { puts: [link], deletes: [] } };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.queries).toContain('getStaleSummary');
    });

    it('is named when a payload a stale link names changes', async () => {
      const segmentPayload = { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'God created' };
      const repository = await repositoryOver({
        segmentAnalyses: [segmentPayload],
        segmentAnalysisLinks: [
          { id: 'sl', analysisId: 'sa', segmentId: 'GEN 1:2', status: 'stale', ...FIXTURE_STAMPS },
        ],
      });
      const changes: ChangeSet = {
        intent: 'x',
        segmentAnalyses: {
          puts: [{ ...segmentPayload, freeTranslation: { en: 'y' } }],
          deletes: [],
        },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalyses: { puts: [segmentPayload], deletes: [] },
      };

      const change = await describeChange(repository, { changes, inverse }, held);

      expect(change.queries).toStrictEqual(['getStaleSummary']);
    });

    it('is not named for a change no stale link reaches', async () => {
      const segmentPayload = { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'God created' };
      const repository = await repositoryOver({
        segmentAnalyses: [segmentPayload],
        segmentAnalysisLinks: [
          {
            id: 'sl',
            analysisId: 'sa',
            segmentId: 'GEN 1:2',
            status: 'approved',
            ...FIXTURE_STAMPS,
          },
        ],
      });
      const changes: ChangeSet = {
        intent: 'x',
        segmentAnalyses: {
          puts: [{ ...segmentPayload, freeTranslation: { en: 'y' } }],
          deletes: [],
        },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalyses: { puts: [segmentPayload], deletes: [] },
      };

      const change = await describeChange(repository, { changes, inverse }, held);

      expect(change.queries).toStrictEqual([]);
    });
  });
});

describe('describeScriptureEdit', () => {
  it('names the edited book whole, with every query', () => {
    expect(describeScriptureEdit('GEN', [])).toStrictEqual({
      books: [{ bookId: 'GEN' }],
      analysisIds: [],
      forms: [],
      queries: ['getCatalogRows', 'getConcordance', 'getStaleSummary'],
    });
  });

  it('names whole each book its passes touched, and each analysis and form once', () => {
    const passes = [
      {
        books: [{ bookId: 'GEN', ranges: [{ start: 0, end: 1 }] }],
        analysisIds: ['ta'],
        forms: ['a'],
        queries: [],
      },
      { books: [{ bookId: 'EXO' }], analysisIds: ['ta', 'tb'], forms: ['a', 'b'], queries: [] },
    ];

    expect(describeScriptureEdit('GEN', passes)).toStrictEqual({
      books: [{ bookId: 'GEN' }, { bookId: 'EXO' }],
      analysisIds: ['ta', 'tb'],
      forms: ['a', 'b'],
      queries: ['getCatalogRows', 'getConcordance', 'getStaleSummary'],
    });
  });
});
