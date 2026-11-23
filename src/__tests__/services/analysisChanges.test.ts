/// <reference types="jest" />

import type { Book, TextAnalysis } from 'interlinearizer';
import { describeChange, describeScriptureEdit } from '../../services/analysisChanges';
import { DraftRepository } from '../../services/draftRepository';
import type { AppliedChangeSet, ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { scopeRecordOf } from '../../utils/change-set';
import {
  creating,
  FIXTURE_STAMPS,
  makePhraseLink,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  seedRepository,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

const book = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning' },
  { sid: 'GEN 1:2', text: 'Rain fell' },
  { sid: 'GEN 1:3', text: 'the light' },
]);
const ref = (surfaceText: string) => tokenRefOf(book, surfaceText);

async function repositoryOver(analysis: Partial<TextAnalysis> = {}): Promise<DraftRepository> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await seedRepository(repository, {
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return repository;
}

const held = (bookId: string): Book | undefined => (bookId === 'GEN' ? book : undefined);

describe('describeChange', () => {
  it("names the range of the segment a token link was put on, the link's analysis, and its token's form", async () => {
    const link = makeTokenLink('ta-fell', ref('fell'), { surfaceText: 'Fell' });
    const changes: AppliedChangeSet = {
      intent: 'writeGloss',
      tokenAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'writeGloss',
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change).toStrictEqual({
      books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
      analysisIds: ['ta-fell'],
      forms: ['fell'],
      queries: ['getCatalogRows', 'getConcordance'],
    });
  });

  it("names the form of a removed token link's token", async () => {
    const link = makeTokenLink('ta-fell', ref('fell'), { surfaceText: 'Fell' });
    const changes: AppliedChangeSet = {
      intent: 'writeGloss',
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };
    const inverse: ChangeSet = {
      intent: 'writeGloss',
      tokenAnalysisLinks: creating([link]),
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.forms).toStrictEqual(['fell']);
  });

  it('names where a moved link was and where it went, joining neighboring segments into one range', async () => {
    const before = makeTokenLink('ta-a', ref('In'), { id: 'tl' });
    const after = makeTokenLink('ta-b', ref('Rain'), { id: 'tl' });
    const elsewhere = makeTokenLink('ta-c', ref('light'));
    const changes: AppliedChangeSet = {
      intent: 'move',
      tokenAnalysisLinks: { puts: [after, elsewhere], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'move',
      tokenAnalysisLinks: creating([before]),
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'GEN', ranges: [{ start: 0, end: 3 }] }]);
    expect(change.analysisIds).toStrictEqual(['ta-a', 'ta-b', 'ta-c']);
  });

  it('names a book the host holds no outline for whole', async () => {
    const link = makeTokenLink('ta', 'EXO 1:1:0');
    const changes: AppliedChangeSet = {
      intent: 'x',
      tokenAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'x',
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'EXO' }]);
  });

  it('names whole each book whose boundaries the change moved, and only those', async () => {
    const scope = scopeRecordOf(emptyDraft('src'));
    const split = {
      removedVerseStarts: ['EXO 1:2:0'],
      addedStarts: [{ tokenRef: ref('fell'), surfaceText: 'fell' }],
    };
    const link = makeTokenLink('ta', ref('In'));
    const changes: AppliedChangeSet = {
      intent: 'splitSegment',
      scope: { ...scope, segmentation: split },
      tokenAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'splitSegment',
      scope: {
        before: { ...scope, segmentation: split },
        after: { ...scope, segmentation: { removedVerseStarts: ['EXO 1:2:0'], addedStarts: [] } },
      },
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([{ bookId: 'GEN' }]);
  });

  it('names a link on a token the text no longer holds nowhere', async () => {
    const link = makeTokenLink('ta', 'GEN 1:9:0', { status: 'stale' });
    const changes: AppliedChangeSet = {
      intent: 'x',
      tokenAnalysisLinks: { puts: [], deletes: [link.id] },
    };
    const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: creating([link]) };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change.books).toStrictEqual([]);
  });

  it("names the segment of each of a phrase link's tokens", async () => {
    const link = makePhraseLink('pl', [ref('beginning'), ref('light')]);
    const changes: AppliedChangeSet = {
      intent: 'x',
      phraseAnalysisLinks: { puts: [link], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'x',
      phraseAnalysisLinks: creating([]),
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
    const changes: AppliedChangeSet = {
      intent: 'writeAnalysisGloss',
      tokenAnalyses: { puts: [{ id: 'ta', ...FIXTURE_STAMPS, surfaceText: 'Rain' }], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'writeAnalysisGloss',
      tokenAnalyses: creating([
        { id: 'ta', ...FIXTURE_STAMPS, surfaceText: 'Rain', gloss: { en: 'x' } },
      ]),
    };

    const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

    expect(change).toStrictEqual({
      books: [],
      analysisIds: ['ta'],
      forms: ['rain'],
      queries: ['getCatalogRows', 'getConcordance'],
    });
  });

  describe('a segment link', () => {
    async function rangesFor(segmentId: string, status: 'stale' | 'approved' = 'stale') {
      const link = {
        id: 'sl',
        analysisId: 'sa',
        segmentId,
        status,
        ...FIXTURE_STAMPS,
      };
      const changes: AppliedChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [], deletes: ['sl'] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: creating([link]),
      };
      return (await describeChange(await repositoryOver(), { changes, inverse }, held)).books;
    }

    it('names its own segment', async () => {
      expect(await rangesFor('GEN 1:2')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 1, end: 2 }], staleTranslations: true },
      ]);
    });

    it('names the segment covering a vanished segment it was on', async () => {
      expect(await rangesFor(ref('light'))).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 2, end: 3 }], staleTranslations: true },
      ]);
    });

    it('names the segment an orphan of a lost verse follows', async () => {
      expect(await rangesFor('GEN 1:7')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 2, end: 3 }], staleTranslations: true },
      ]);
    });

    it('names the first segment for an orphan ahead of every verse', async () => {
      expect(await rangesFor('GEN 1:0')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 0, end: 1 }], staleTranslations: true },
      ]);
    });

    it('leaves the book unflagged when the link is not stale', async () => {
      expect(await rangesFor('GEN 1:2', 'approved')).toStrictEqual([
        { bookId: 'GEN', ranges: [{ start: 1, end: 2 }] },
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
      const changes: AppliedChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: { puts: [link], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalysisLinks: creating([]),
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
      const link = makeTokenLink('ta', ref('Rain'));
      const changes: AppliedChangeSet = {
        intent: 'x',
        tokenAnalysisLinks: { puts: [{ ...link, status: 'stale' }], deletes: [] },
      };
      const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: creating([link]) };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.queries).toContain('getStaleSummary');
    });

    it('leaves the book unflagged for a stale token link, which places no translation', async () => {
      const link = makeTokenLink('ta', ref('Rain'));
      const changes: AppliedChangeSet = {
        intent: 'x',
        tokenAnalysisLinks: { puts: [{ ...link, status: 'stale' }], deletes: [] },
      };
      const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: creating([link]) };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.books.some(({ staleTranslations }) => staleTranslations)).toBe(false);
    });

    it('is named when the change moved boundaries, which can move where a stale translation shows', async () => {
      const scope = scopeRecordOf(emptyDraft('src'));
      const merged = { removedVerseStarts: [ref('Rain')], addedStarts: [] };
      const changes: AppliedChangeSet = {
        intent: 'mergeSegments',
        scope: { ...scope, segmentation: merged },
      };
      const inverse: ChangeSet = {
        intent: 'mergeSegments',
        scope: { before: { ...scope, segmentation: merged }, after: scope },
      };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.queries).toContain('getStaleSummary');
    });

    it('flags the book of a stale token link that the change put or removed', async () => {
      const link = makeTokenLink('ta', ref('Rain'));
      const changes: AppliedChangeSet = {
        intent: 'x',
        tokenAnalysisLinks: { puts: [{ ...link, status: 'stale' }], deletes: [] },
      };
      const inverse: ChangeSet = { intent: 'x', tokenAnalysisLinks: creating([link]) };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.books).toStrictEqual([
        expect.objectContaining({ bookId: 'GEN', staleGlosses: true }),
      ]);
    });

    it('flags the book of a stale phrase link that the change put', async () => {
      const link = makePhraseLink('pl', [ref('fell'), ref('the')]);
      const changes: AppliedChangeSet = {
        intent: 'x',
        phraseAnalysisLinks: { puts: [{ ...link, status: 'stale' }], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        phraseAnalysisLinks: creating([link]),
      };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.books).toStrictEqual([
        expect.objectContaining({ bookId: 'GEN', staleGlosses: true }),
      ]);
    });

    it('flags the book of a stale phrase link that the change removed', async () => {
      const link = makePhraseLink('pl', [ref('fell'), ref('the')]);
      const changes: AppliedChangeSet = {
        intent: 'x',
        phraseAnalysisLinks: { puts: [link], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        phraseAnalysisLinks: creating([{ ...link, status: 'stale' }]),
      };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.books).toStrictEqual([
        expect.objectContaining({ bookId: 'GEN', staleGlosses: true }),
      ]);
    });

    it('is named when a phrase payload a stale link names changes', async () => {
      const phrasePayload = { id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'fell the' };
      const repository = await repositoryOver({
        phraseAnalyses: [phrasePayload],
        phraseAnalysisLinks: [
          { ...makePhraseLink('pa', [ref('fell'), ref('the')]), status: 'stale' },
        ],
      });
      const changes: AppliedChangeSet = {
        intent: 'x',
        phraseAnalyses: { puts: [{ ...phrasePayload, gloss: { en: 'y' } }], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        phraseAnalyses: creating([phrasePayload]),
      };

      const change = await describeChange(repository, { changes, inverse }, held);

      expect(change.queries).toStrictEqual(['getStaleSummary']);
    });

    it('leaves the book unflagged for glosses when no stale token link changed', async () => {
      const link = makeTokenLink('ta', ref('Rain'));
      const changes: AppliedChangeSet = {
        intent: 'x',
        tokenAnalysisLinks: { puts: [link], deletes: [] },
      };
      const inverse: ChangeSet = {
        intent: 'x',
      };

      const change = await describeChange(await repositoryOver(), { changes, inverse }, held);

      expect(change.books).toStrictEqual([
        expect.not.objectContaining({ staleGlosses: expect.anything() }),
      ]);
    });

    it('is named when a payload a stale link names changes', async () => {
      const segmentPayload = { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'Rain fell' };
      const repository = await repositoryOver({
        segmentAnalyses: [segmentPayload],
        segmentAnalysisLinks: [
          { id: 'sl', analysisId: 'sa', segmentId: 'GEN 1:2', status: 'stale', ...FIXTURE_STAMPS },
        ],
      });
      const changes: AppliedChangeSet = {
        intent: 'x',
        segmentAnalyses: {
          puts: [{ ...segmentPayload, freeTranslation: { en: 'y' } }],
          deletes: [],
        },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalyses: creating([segmentPayload]),
      };

      const change = await describeChange(repository, { changes, inverse }, held);

      expect(change.queries).toStrictEqual(['getStaleSummary']);
    });

    it('is not named for a change no stale link reaches', async () => {
      const segmentPayload = { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'Rain fell' };
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
      const changes: AppliedChangeSet = {
        intent: 'x',
        segmentAnalyses: {
          puts: [{ ...segmentPayload, freeTranslation: { en: 'y' } }],
          deletes: [],
        },
      };
      const inverse: ChangeSet = {
        intent: 'x',
        segmentAnalyses: creating([segmentPayload]),
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
