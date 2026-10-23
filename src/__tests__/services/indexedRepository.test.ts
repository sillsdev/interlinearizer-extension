/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { AnalysisIndex } from '../../services/analysisIndex';
import { type IndexedAnalysis, IndexedRepository } from '../../services/indexedRepository';
import { emptyAnalysis } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';

/** Answers lookups from an index over `records`, reporting it as kept when `keep` is `'kept'`. */
class StubRepository extends IndexedRepository {
  readonly kept: IndexedAnalysis | undefined;

  private readonly index: AnalysisIndex;

  constructor(records: TextAnalysis, keep: 'kept' | 'none') {
    super();
    this.index = new AnalysisIndex(records);
    this.kept = keep === 'kept' ? { analysis: records, index: this.index } : undefined;
  }

  protected async indexed(): Promise<AnalysisIndex> {
    return this.index;
  }

  protected keptIndex(): IndexedAnalysis | undefined {
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
    repository.kept?.analysis.tokenAnalyses.pop();

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
