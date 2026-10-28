/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import {
  readBookOutline,
  readPoolBuckets,
  readSegmentPage,
  readTouchedPoolBuckets,
} from '../../services/sessionPages';
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

function payload(id: string, surfaceText: string): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText, gloss: { en: id } };
}

/** The ids of `records`, sorted, since lookups promise no order. */
function idsOf(records: readonly { id: string }[] | undefined): string[] | undefined {
  return records?.map(({ id }) => id).sort();
}

async function repositoryOver(analysis: Partial<TextAnalysis> = {}): Promise<DraftRepository> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return repository;
}

describe('readPoolBuckets', () => {
  it('files each approved payload under its form, ranked by how many tokens approve it', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-b', 'word'), payload('ta-a', 'Word'), payload('ta-c', 'other')],
      tokenAnalysisLinks: [
        makeTokenLink('ta-a', 'GEN 1:1:0'),
        makeTokenLink('ta-b', 'GEN 1:2:0'),
        makeTokenLink('ta-b', 'GEN 1:3:0'),
        makeTokenLink('ta-a', 'GEN 1:4:0', { status: 'suggested' }),
        makeTokenLink('ta-c', 'GEN 1:5:0'),
      ],
    });

    const { poolBuckets } = await readPoolBuckets(repository, ['word']);

    expect(poolBuckets).toStrictEqual({
      word: [
        { analysisId: 'ta-b', frequency: 2 },
        { analysisId: 'ta-a', frequency: 1 },
      ],
    });
  });

  it('answers [] for a form no approved payload has', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-a', 'word')],
      tokenAnalysisLinks: [makeTokenLink('ta-a', 'GEN 1:1:0', { status: 'suggested' })],
    });

    const { poolBuckets, poolAnalyses } = await readPoolBuckets(repository, ['word', 'none']);

    expect(poolBuckets).toStrictEqual({ word: [], none: [] });
    expect(poolAnalyses).toStrictEqual([]);
  });

  it("counts a token's approval once, for the link an approval tie picks", async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-a', 'word'), payload('ta-b', 'word')],
      tokenAnalysisLinks: [
        makeTokenLink('ta-a', 'GEN 1:1:0'),
        { ...makeTokenLink('ta-b', 'GEN 1:1:0'), updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
    });

    const { poolBuckets } = await readPoolBuckets(repository, ['word']);

    expect(poolBuckets).toStrictEqual({ word: [{ analysisId: 'ta-b', frequency: 1 }] });
  });

  it('passes over an approved link whose payload is not stored when picking a tie', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-a', 'word')],
      tokenAnalysisLinks: [
        makeTokenLink('ta-a', 'GEN 1:1:0'),
        { ...makeTokenLink('ta-gone', 'GEN 1:1:0'), updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
    });

    const { poolBuckets } = await readPoolBuckets(repository, ['word']);

    expect(poolBuckets).toStrictEqual({ word: [{ analysisId: 'ta-a', frequency: 1 }] });
  });

  it("counts a token only toward the form of its tie-winning approval's payload", async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-a', 'word'), payload('ta-b', 'other')],
      tokenAnalysisLinks: [
        makeTokenLink('ta-a', 'GEN 1:1:0'),
        { ...makeTokenLink('ta-b', 'GEN 1:1:0'), updatedAt: '2026-02-01T00:00:00.000Z' },
      ],
    });

    const { poolBuckets, poolAnalyses } = await readPoolBuckets(repository, ['word']);

    expect(poolBuckets).toStrictEqual({ word: [] });
    expect(poolAnalyses).toStrictEqual([]);
  });

  it('returns each payload a bucket names', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-a', 'word')],
      tokenAnalysisLinks: [makeTokenLink('ta-a', 'GEN 1:1:0')],
    });

    const { poolAnalyses } = await readPoolBuckets(repository, ['word']);

    expect(poolAnalyses).toStrictEqual([payload('ta-a', 'word')]);
  });
});

const book = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning' },
  { sid: 'GEN 1:2', text: 'God created' },
  { sid: 'GEN 1:3', text: 'the light' },
]);
const ref = (surfaceText: string) => tokenRefOf(book, surfaceText);

function staleTranslation(segmentId: string): Partial<TextAnalysis> {
  const analysisId = `sa ${segmentId}`;
  return {
    segmentAnalyses: [{ id: analysisId, ...FIXTURE_STAMPS, surfaceText: segmentId }],
    segmentAnalysisLinks: [
      { id: `sl ${segmentId}`, analysisId, segmentId, status: 'stale', ...FIXTURE_STAMPS },
    ],
  };
}

describe('readBookOutline', () => {
  it('outlines the book, counting the orphaned free-translation cards beside each segment', async () => {
    const translations = ['GEN 1:0', 'GEN 1:2', 'GEN 1:5', 'GEN 1:6'].map(staleTranslation);
    const repository = await repositoryOver({
      segmentAnalyses: translations.flatMap((t) => t.segmentAnalyses ?? []),
      segmentAnalysisLinks: translations.flatMap((t) => t.segmentAnalysisLinks ?? []),
    });

    const outline = await readBookOutline(repository, book);

    expect(outline.bookRef).toBe('GEN');
    expect(outline.textVersion).toBe(book.textVersion);
    expect(outline.segments.map((segment) => segment.id)).toStrictEqual([
      'GEN 1:1',
      'GEN 1:2',
      'GEN 1:3',
    ]);
    expect(outline.segments.map((segment) => segment.orphanedCardCount)).toStrictEqual([1, 0, 2]);
  });
});

describe('readSegmentPage', () => {
  it("serves the range's segments with the links on them and the payloads those name", async () => {
    const phrase = makePhraseLink('pl-god', [ref('God'), ref('created')]);
    const repository = await repositoryOver({
      tokenAnalyses: [
        payload('ta-god', 'God'),
        payload('ta-created', 'created'),
        payload('ta-in', 'In'),
      ],
      tokenAnalysisLinks: [
        makeTokenLink('ta-god', ref('God')),
        makeTokenLink('ta-created', ref('created'), { status: 'suggested' }),
        makeTokenLink('ta-in', ref('In')),
      ],
      phraseAnalyses: [{ id: 'pl-god', ...FIXTURE_STAMPS, surfaceText: 'God created' }],
      phraseAnalysisLinks: [phrase, makePhraseLink('pl-in', [ref('In'), ref('the')])],
      segmentAnalyses: [
        { id: 'sa-2', ...FIXTURE_STAMPS, surfaceText: 'God created' },
        { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning' },
      ],
      segmentAnalysisLinks: [
        {
          id: 'sl-2',
          analysisId: 'sa-2',
          segmentId: 'GEN 1:2',
          status: 'approved',
          ...FIXTURE_STAMPS,
        },
        {
          id: 'sl-1',
          analysisId: 'sa-1',
          segmentId: 'GEN 1:1',
          status: 'approved',
          ...FIXTURE_STAMPS,
        },
      ],
    });

    const page = await readSegmentPage(repository, book, 1, 2);

    expect(page.start).toBe(1);
    expect(page.textVersion).toBe(book.textVersion);
    expect(page.segments).toStrictEqual([book.segments[1]]);
    const { analysis } = page;
    expect(idsOf(analysis?.tokenAnalysisLinks)).toStrictEqual(
      idsOf([
        makeTokenLink('ta-created', ref('created'), { status: 'suggested' }),
        makeTokenLink('ta-god', ref('God')),
      ]),
    );
    expect(idsOf(analysis?.tokenAnalyses)).toStrictEqual(['ta-created', 'ta-god']);
    expect(analysis?.phraseAnalysisLinks).toStrictEqual([phrase]);
    expect(idsOf(analysis?.phraseAnalyses)).toStrictEqual(['pl-god']);
    expect(idsOf(analysis?.segmentAnalysisLinks)).toStrictEqual(['sl-2']);
    expect(idsOf(analysis?.segmentAnalyses)).toStrictEqual(['sa-2']);
    expect(analysis?.poolBuckets).toStrictEqual({
      god: [{ analysisId: 'ta-god', frequency: 1 }],
      created: [],
    });
  });

  it('spans each phrase touching the range with every member the book holds, wherever it sits', async () => {
    const phrase = makePhraseLink('pl', [ref('God'), ref('light'), 'GEN 1:9:0']);
    const repository = await repositoryOver({
      phraseAnalyses: [{ id: 'pl', ...FIXTURE_STAMPS, surfaceText: 'God light' }],
      phraseAnalysisLinks: [phrase, makePhraseLink('pl-in', [ref('In'), ref('beginning')])],
    });
    const [, light] = book.segments[2].tokens;

    const page = await readSegmentPage(repository, book, 1, 2);

    expect(page.analysis?.phraseSpans).toStrictEqual({
      pl: [
        { token: book.segments[1].tokens[0], segmentId: 'GEN 1:2', docOrder: 3 },
        { token: light, segmentId: 'GEN 1:3', docOrder: 6, gapText: ' ' },
      ],
    });
  });

  describe('stale free translations', () => {
    async function pageWith(segmentId: string, start: number) {
      const repository = await repositoryOver(staleTranslation(segmentId));
      return (await readSegmentPage(repository, book, start, start + 1)).analysis;
    }

    it('files one whose segment stands under that segment', async () => {
      const analysis = await pageWith('GEN 1:2', 1);

      expect(analysis?.staleFreeTranslations).toStrictEqual({
        bySegment: { 'GEN 1:2': ['sa GEN 1:2'] },
        orphanedAfter: {},
        orphanedAhead: [],
      });
      expect(idsOf(analysis?.segmentAnalysisLinks)).toStrictEqual(['sl GEN 1:2']);
    });

    it('files one whose segment has vanished under the segment covering its place, with its link and payload', async () => {
      const analysis = await pageWith(ref('created'), 1);

      expect(analysis?.staleFreeTranslations.bySegment).toStrictEqual({
        'GEN 1:2': [`sa ${ref('created')}`],
      });
      expect(idsOf(analysis?.segmentAnalysisLinks)).toStrictEqual([`sl ${ref('created')}`]);
      expect(idsOf(analysis?.segmentAnalyses)).toStrictEqual([`sa ${ref('created')}`]);
    });

    it('orphans one whose verse the book lacks after the segment ending the verse before', async () => {
      const analysis = await pageWith('GEN 1:5', 2);

      expect(analysis?.staleFreeTranslations).toStrictEqual({
        bySegment: {},
        orphanedAfter: { 'GEN 1:3': ['sa GEN 1:5'] },
        orphanedAhead: [],
      });
      expect(idsOf(analysis?.segmentAnalyses)).toStrictEqual(['sa GEN 1:5']);
    });

    it('lists one orphaned ahead of every verse only on the first page', async () => {
      expect((await pageWith('GEN 1:0', 0))?.staleFreeTranslations.orphanedAhead).toStrictEqual([
        'sa GEN 1:0',
      ]);
      expect((await pageWith('GEN 1:0', 1))?.staleFreeTranslations.orphanedAhead).toStrictEqual([]);
    });

    it('leaves out one placed outside the range', async () => {
      const analysis = await pageWith('GEN 1:5', 1);

      expect(analysis?.staleFreeTranslations).toStrictEqual({
        bySegment: {},
        orphanedAfter: {},
        orphanedAhead: [],
      });
      expect(analysis?.segmentAnalysisLinks).toStrictEqual([]);
    });

    it('leaves out one whose payload is not stored', async () => {
      const { segmentAnalysisLinks } = staleTranslation(ref('created'));
      const repository = await repositoryOver({ segmentAnalysisLinks });

      const page = await readSegmentPage(repository, book, 1, 2);

      expect(page.analysis?.staleFreeTranslations.bySegment).toStrictEqual({});
      expect(page.analysis?.segmentAnalysisLinks).toStrictEqual([]);
    });
  });
});

describe('readTouchedPoolBuckets', () => {
  it('reads the bucket of each form whose payload or token link the change put or restored', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [payload('ta-god', 'God'), payload('ta-light', 'light')],
      tokenAnalysisLinks: [
        makeTokenLink('ta-god', ref('God')),
        makeTokenLink('ta-light', ref('light')),
      ],
    });
    const approved = makeTokenLink('ta-light', ref('light'));
    const changes: ChangeSet = {
      intent: 'x',
      tokenAnalyses: { puts: [], deletes: ['ta-gone'] },
      tokenAnalysisLinks: { puts: [approved], deletes: [] },
    };
    const inverse: ChangeSet = {
      intent: 'x',
      tokenAnalyses: { puts: [payload('ta-gone', 'In')], deletes: [] },
      tokenAnalysisLinks: { puts: [], deletes: [approved.id] },
    };

    const { poolBuckets, poolAnalyses } = await readTouchedPoolBuckets(repository, {
      changes,
      inverse,
    });

    expect(poolBuckets).toStrictEqual({
      in: [],
      light: [{ analysisId: 'ta-light', frequency: 1 }],
    });
    expect(poolAnalyses).toStrictEqual([payload('ta-light', 'light')]);
  });

  it('reads none for a change touching no token payload or link', async () => {
    const repository = await repositoryOver();

    const read = await readTouchedPoolBuckets(repository, {
      changes: { intent: 'x' },
      inverse: { intent: 'x' },
    });

    expect(read).toStrictEqual({ poolBuckets: {}, poolAnalyses: [] });
  });
});
