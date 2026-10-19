/// <reference types="jest" />

import type { DraftProject, TextAnalysis } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { draftAnalysisKey, draftKey } from '../../services/storageKeys';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { FIXTURE_STAMPS, makePhraseLink, memoryStorage, silentLogger } from '../test-helpers';

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

function twoBookDraft(): DraftProject {
  return { ...emptyDraft('src'), analysisLanguages: ['en'], analysis: twoBookAnalysis() };
}

describe('DraftRepository', () => {
  it('loads an empty draft for its source project when none is stored', async () => {
    const { storage } = memoryStorage();

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).resolves.toEqual(
      emptyDraft('src'),
    );
  });

  it('loads in a new instance what another saved', async () => {
    const { storage } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).resolves.toEqual(
      twoBookDraft(),
    );
  });

  it('loads a payload shared by several books once', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    expect(records.get(draftAnalysisKey('src', 'EXO'))).toContain('ta-and');
    expect(records.get(draftAnalysisKey('src', 'GEN'))).toContain('ta-and');

    const { analysis } = await new DraftRepository(storage, 'src', silentLogger()).exportAll();

    expect(analysis.tokenAnalyses).toHaveLength(1);
  });

  it('rewrites only the books whose records changed since the load', async () => {
    const { storage, writes } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    const repository = new DraftRepository(storage, 'src', silentLogger());
    const draft = await repository.exportAll();
    writes.length = 0;
    draft.analysis.segmentAnalyses[0].freeTranslation = { en: 'And then.' };

    await repository.replaceAll(draft);

    expect(writes).toContain(draftAnalysisKey('src', 'EXO'));
    expect(writes).not.toContain(draftAnalysisKey('src', 'GEN'));
  });

  it('refuses to load a draft written by a newer build', async () => {
    const newer = JSON.stringify({ ...emptyDraft('src'), modelVersion: CURRENT_MODEL_VERSION + 1 });
    const { storage } = memoryStorage({ [draftKey('src')]: newer });

    await expect(new DraftRepository(storage, 'src', silentLogger()).exportAll()).rejects.toThrow(
      /newer than this build supports/,
    );
  });

  it('leaves a draft written by a newer build as it stands', async () => {
    const newer = JSON.stringify({ ...emptyDraft('src'), modelVersion: CURRENT_MODEL_VERSION + 1 });
    const { storage, records, writes } = memoryStorage({ [draftKey('src')]: newer });

    await expect(
      new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft()),
    ).rejects.toThrow(/newer than this build supports/);

    expect(writes).toEqual([]);
    expect(records.get(draftKey('src'))).toBe(newer);
  });

  it('reports a stored shard it cannot use to its logger', async () => {
    const { storage, records } = memoryStorage();
    await new DraftRepository(storage, 'src', silentLogger()).replaceAll(twoBookDraft());
    records.set(draftAnalysisKey('src', 'GEN'), 'not json');
    const logger = silentLogger();

    await new DraftRepository(storage, 'src', logger).exportAll();

    expect(logger.warn).toHaveBeenCalledWith(
      `Interlinearizer: analysis shard ${draftAnalysisKey('src', 'GEN')} is not valid JSON; treating as empty`,
    );
  });
});
