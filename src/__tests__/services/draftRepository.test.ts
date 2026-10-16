/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import type {
  DraftScope,
  KeyValueStorage,
  RepositoryLogger,
} from '../../types/analysis-repository';
import { DraftRepository } from '../../services/draftRepository';
import { draftAnalysisKey, draftKey } from '../../services/storageKeys';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { FIXTURE_STAMPS, makePhraseLink } from '../test-helpers';

/** Storage held in a map, recording every write in order. */
function memoryStorage(initial: Record<string, string> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: KeyValueStorage = {
    read: async (key) => records.get(key),
    write: async (key, data) => {
      writes.push(key);
      records.set(key, data);
    },
    delete: async (key) => {
      records.delete(key);
    },
  };
  return { storage, records, writes };
}

/** An empty draft's scope. */
function scopeOf(sourceProjectId: string): DraftScope {
  return {
    sourceProjectId,
    modelVersion: CURRENT_MODEL_VERSION,
    analysisLanguages: [],
    dirty: false,
  };
}

function silentLogger(): RepositoryLogger & { warn: jest.Mock } {
  return { warn: jest.fn() };
}

/** An analysis with a token payload shared by GEN and EXO, a phrase in GEN and a segment in EXO. */
function twoBookAnalysis(): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'and', gloss: { en: 'and' } }],
    tokenAnalysisLinks: ['GEN', 'EXO'].map((book) => ({
      id: `tl-${book}`,
      analysisId: 'ta-and',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      token: { tokenRef: `${book} 1:1!0`, surfaceText: 'and' },
    })),
    phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'in the', gloss: { en: 'in' } }],
    phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1!0', 'GEN 1:1!4'])],
    segmentAnalyses: [
      { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'And so', freeTranslation: { en: 'And so.' } },
    ],
    segmentAnalysisLinks: [
      {
        id: 'sl-1',
        analysisId: 'sa-1',
        ...FIXTURE_STAMPS,
        status: 'approved',
        segmentId: 'EXO 1:1',
      },
    ],
  };
}

describe('DraftRepository', () => {
  it('holds an empty draft for its source project before anything is loaded', async () => {
    const { storage } = memoryStorage();
    const repository = new DraftRepository(storage, 'src', silentLogger());

    await expect(repository.getScope()).resolves.toEqual(scopeOf('src'));
    await expect(repository.exportAll()).resolves.toEqual(emptyAnalysis());
  });

  it('reads back in a new instance what another wrote', async () => {
    const { storage } = memoryStorage();
    const scope = { ...scopeOf('src'), analysisLanguages: ['en'] };
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(scope, twoBookAnalysis());

    const reader = new DraftRepository(storage, 'src', silentLogger());
    await reader.load();

    await expect(reader.getScope()).resolves.toEqual(scope);
    await expect(reader.exportAll()).resolves.toEqual(twoBookAnalysis());
  });

  it('serves the payloads asked for by id, in request order, leaving out ids with none', async () => {
    const { storage } = memoryStorage();
    const repository = new DraftRepository(storage, 'src', silentLogger());
    await repository.replaceAll(scopeOf('src'), twoBookAnalysis());
    const [tokenAnalysis] = twoBookAnalysis().tokenAnalyses;
    const [phraseAnalysis] = twoBookAnalysis().phraseAnalyses;
    const [segmentAnalysis] = twoBookAnalysis().segmentAnalyses;

    await expect(repository.getTokenAnalyses(['missing', 'ta-and'])).resolves.toEqual([
      tokenAnalysis,
    ]);
    await expect(repository.getPhraseAnalyses(['pa-1'])).resolves.toEqual([phraseAnalysis]);
    await expect(repository.getSegmentAnalyses(['sa-1', 'missing'])).resolves.toEqual([
      segmentAnalysis,
    ]);
  });

  it('serves one copy of a payload every book it is linked from stores', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(
      scopeOf('src'),
      twoBookAnalysis(),
    );
    expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('ta-and');
    expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('ta-and');

    const reader = new DraftRepository(storage, 'src', silentLogger());
    await reader.load();

    await expect(reader.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
  });

  it('serves payloads from what a load read, not what the instance held before', async () => {
    const { storage } = memoryStorage();
    const repository = new DraftRepository(storage, 'src', silentLogger());
    await repository.replaceAll(scopeOf('src'), twoBookAnalysis());
    await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toHaveLength(1);
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(
      scopeOf('src'),
      emptyAnalysis(),
    );

    await repository.load();

    await expect(repository.getTokenAnalyses(['ta-and'])).resolves.toEqual([]);
  });

  it('rewrites only the books whose records changed since the load', async () => {
    const { storage, writes } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(
      scopeOf('src'),
      twoBookAnalysis(),
    );
    const repository = new DraftRepository(storage, 'src', silentLogger());
    await repository.load();
    writes.length = 0;
    const edited = twoBookAnalysis();
    edited.segmentAnalyses[0].freeTranslation = { en: 'And then.' };

    await repository.replaceAll(scopeOf('src'), edited);

    expect(writes).toContain(draftAnalysisKey('src', 'EXO'));
    expect(writes).not.toContain(draftAnalysisKey('src', 'GEN'));
  });

  it('leaves a draft written by a newer build as it stands', async () => {
    const newer = JSON.stringify({ ...emptyDraft('src'), modelVersion: CURRENT_MODEL_VERSION + 1 });
    const { storage, records, writes } = memoryStorage({ [draftKey('src')]: newer });
    const repository = new DraftRepository(storage, 'src', silentLogger());

    await expect(repository.load()).rejects.toThrow(/newer than this build supports/);
    await expect(repository.replaceAll(scopeOf('src'), twoBookAnalysis())).rejects.toThrow(
      /newer than this build supports/,
    );

    expect(writes).toEqual([]);
    expect(records.get(draftKey('src'))).toBe(newer);
  });

  it('reports a stored shard it cannot use to its logger', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(
      scopeOf('src'),
      twoBookAnalysis(),
    );
    records.set(draftAnalysisKey('src', 'GEN'), 'not json');
    const logger = silentLogger();
    const repository = new DraftRepository(storage, 'src', logger);

    await repository.load();

    expect(logger.warn).toHaveBeenCalledWith(
      `Interlinearizer: analysis shard ${draftAnalysisKey('src', 'GEN')} is not valid JSON; treating as empty`,
    );
  });
});
