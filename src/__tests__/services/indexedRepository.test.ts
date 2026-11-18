/// <reference types="jest" />

import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import { type IndexedDraft, IndexedRepository } from '../../services/indexedRepository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { FIXTURE_STAMPS, makeTokenLink } from '../test-helpers';

/** Answers lookups from an index over `records`, reporting it as kept when `keep` is `'kept'`. */
class StubRepository extends IndexedRepository {
  readonly kept: IndexedDraft | undefined;

  private readonly indexedDraft: IndexedDraft;

  constructor(records: TextAnalysis, keep: 'kept' | 'none', segmentation?: SegmentationDelta) {
    super();
    this.indexedDraft = {
      draft: {
        ...emptyDraft('src'),
        analysisLanguages: ['en'],
        analysis: records,
        ...(segmentation && { segmentation }),
      },
      index: new AnalysisIndex(records),
    };
    this.kept = keep === 'kept' ? this.indexedDraft : undefined;
  }

  protected async indexed(): Promise<IndexedDraft> {
    return this.indexedDraft;
  }

  protected keptIndex(): IndexedDraft | undefined {
    return this.kept;
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- the base class's method, answered with a constant
  protected unreadableBooks(): string[] {
    return ['EXO'];
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- the base class's method, answered with a constant
  protected anchoredVersions(): Record<string, string> {
    return { GEN: 'v1' };
  }
}

function analysis(): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and' }],
  };
}

describe('IndexedRepository', () => {
  it('answers lookups from its index', async () => {
    await expect(
      new StubRepository(analysis(), 'none').getTokenAnalyses(['ta-and']),
    ).resolves.toStrictEqual(analysis().tokenAnalyses);
  });

  it('counts approvals from its index', async () => {
    const records: TextAnalysis = {
      ...analysis(),
      tokenAnalysisLinks: [makeTokenLink('ta-and', 'GEN 1:1:0')],
    };

    await expect(
      new StubRepository(records, 'none').countApprovals(['ta-and']),
    ).resolves.toStrictEqual({ 'ta-and': 1 });
  });

  it('hands out copies of the records its index holds', async () => {
    const repository = new StubRepository(analysis(), 'none');

    const [and] = await repository.getTokenAnalyses(['ta-and']);
    and.surfaceText = 'changed';

    await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toStrictEqual(
      analysis().tokenAnalyses,
    );
  });

  it('reports the differences of the index it keeps from its analysis', async () => {
    const repository = new StubRepository(analysis(), 'kept');
    repository.kept?.draft.analysis.tokenAnalyses.pop();

    await expect(repository.checkIndexes()).resolves.toContainEqual({
      index: 'tokenAnalyses',
      key: 'ta-and',
      missing: [],
      extra: ['ta-and'],
    });
  });

  it("reads the draft's own record without its analysis", async () => {
    await expect(new StubRepository(analysis(), 'none').getScope()).resolves.toStrictEqual({
      sourceProjectId: 'src',
      modelVersion: emptyDraft('src').modelVersion,
      analysisLanguages: ['en'],
    });
  });

  it("reports the draft's state, with the books its last load could not read", async () => {
    const records: TextAnalysis = {
      ...analysis(),
      segmentAnalyses: [
        { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'In', freeTranslation: { en: 'At the start' } },
      ],
    };

    await expect(new StubRepository(records, 'none').getDraftState()).resolves.toStrictEqual({
      dirty: false,
      empty: false,
      hasFreeTranslations: true,
      unreadableBooks: ['EXO'],
      anchoredVersions: { GEN: 'v1' },
    });
  });

  it('reports a draft with no records and no boundaries as empty', async () => {
    await expect(
      new StubRepository(emptyAnalysis(), 'none').getDraftState(),
    ).resolves.toMatchObject({ empty: true });
  });

  it('reports a draft that only moves boundaries as not empty', async () => {
    const segmentation = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

    await expect(
      new StubRepository(emptyAnalysis(), 'none', segmentation).getDraftState(),
    ).resolves.toMatchObject({ empty: false });
  });

  it('finds the payloads no link names', async () => {
    const records: TextAnalysis = {
      ...analysis(),
      tokenAnalyses: [
        ...analysis().tokenAnalyses,
        { id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'in' },
      ],
      tokenAnalysisLinks: [makeTokenLink('ta-in', 'GEN 1:1:0')],
    };

    await expect(new StubRepository(records, 'none').findUnlinkedPayloads()).resolves.toStrictEqual(
      {
        tokenAnalyses: analysis().tokenAnalyses,
        phraseAnalyses: [],
        segmentAnalyses: [],
      },
    );
  });

  it('reports nothing while it keeps no index', async () => {
    await expect(new StubRepository(analysis(), 'none').checkIndexes()).resolves.toStrictEqual([]);
  });
});
