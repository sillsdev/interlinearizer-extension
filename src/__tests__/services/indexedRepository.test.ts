/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import { type IndexedDraft, IndexedRepository } from '../../services/indexedRepository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';

/** Answers lookups from an index over `records`, reporting it as kept when `keep` is `'kept'`. */
class StubRepository extends IndexedRepository {
  readonly kept: IndexedDraft | undefined;

  private readonly indexedDraft: IndexedDraft;

  constructor(records: TextAnalysis, keep: 'kept' | 'none') {
    super();
    this.indexedDraft = {
      draft: { ...emptyDraft('src'), analysisLanguages: ['en'], analysis: records },
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

  it("reads the draft's own record without its analysis", async () => {
    await expect(new StubRepository(analysis(), 'none').getScope()).resolves.toStrictEqual({
      sourceProjectId: 'src',
      modelVersion: emptyDraft('src').modelVersion,
      analysisLanguages: ['en'],
    });
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

  it('reports nothing while it keeps no index', async () => {
    await expect(new StubRepository(analysis(), 'none').checkIndexes()).resolves.toStrictEqual([]);
  });
});
