/// <reference types="jest" />

import type { InterlinearProject } from 'interlinearizer';
import { DraftRepository } from '../../services/draftRepository';
import { Pt9ImportRepository } from '../../services/pt9ImportRepository';
import { draftAnalysisKey, draftKey, projectKey } from '../../services/storageKeys';
import { emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { describeAnalysisRepositoryConformance } from '../analysis-repository-conformance';
import { memoryStorage, silentLogger } from '../test-helpers';

const logger = silentLogger();

/** Whether the current test damaged storage or failed its cleanup, which a repository may log. */
let warningsExpected = false;

const IMPORT_ID = 'pt9-import';

describeAnalysisRepositoryConformance('DraftRepository with Pt9ImportRepository', () => {
  const { storage: memory, records } = memoryStorage();
  warningsExpected = false;
  /** The key of the draft whose cleanup fails; unset while cleanup succeeds. */
  let failingDraftKey: string | undefined;
  let landed = false;
  /**
   * Refuses writes and deletions of the failing draft's other records from the time a save of it
   * lands until the draft is next read, which is how every call on it starts.
   */
  const refuseAfterLanding = async (key: string, operation: () => Promise<void>) => {
    if (landed && key.startsWith(`${failingDraftKey}:`)) throw new Error('cleanup refused');
    await operation();
    if (key === failingDraftKey) landed = true;
  };
  const storage = {
    read: async (key: string) => {
      if (key === failingDraftKey) landed = false;
      return memory.read(key);
    },
    write: (key: string, data: string) => refuseAfterLanding(key, () => memory.write(key, data)),
    delete: (key: string) => refuseAfterLanding(key, () => memory.delete(key)),
  };
  return {
    open: async (sourceProjectId) => new DraftRepository(storage, sourceProjectId, logger),
    storeNewerBuildDraft: (sourceProjectId) =>
      memory.write(
        draftKey(sourceProjectId),
        JSON.stringify({ ...emptyDraft(sourceProjectId), modelVersion: CURRENT_MODEL_VERSION + 1 }),
      ),
    damageBook: async (sourceProjectId, bookCode, damage) => {
      warningsExpected = true;
      const key = draftAnalysisKey(sourceProjectId, bookCode);
      if (damage === 'lost') records.delete(key);
      else records.set(key, 'not json');
    },
    damageDraft: async (sourceProjectId) => {
      warningsExpected = true;
      records.set(draftKey(sourceProjectId), JSON.stringify({ dirty: true }));
    },
    failCleanup: (sourceProjectId) => {
      warningsExpected = true;
      failingDraftKey = draftKey(sourceProjectId);
      return () => {
        failingDraftKey = undefined;
        landed = false;
      };
    },
    holdsLeftovers: async (sourceProjectId) => {
      const stored: { analysisBooks?: string[] } = JSON.parse(
        records.get(draftKey(sourceProjectId)) ?? '{}',
      );
      const needed = new Set([
        draftKey(sourceProjectId),
        ...(stored.analysisBooks ?? []).map((bookCode) =>
          draftAnalysisKey(sourceProjectId, bookCode),
        ),
      ]);
      return [...records.keys()].some(
        (key) => key.startsWith(`${draftKey(sourceProjectId)}:`) && !needed.has(key),
      );
    },
    async openReadOnly({ sourceProjectId, analysisLanguages, analysis }) {
      const project: InterlinearProject = {
        id: IMPORT_ID,
        modelVersion: CURRENT_MODEL_VERSION,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        sourceProjectId,
        analysisLanguages,
        analysis,
        pt9Import: { fileHashes: {}, importedAt: '2026-01-01T00:00:00.000Z' },
      };
      await memory.write(projectKey(IMPORT_ID), JSON.stringify(project));
      return new Pt9ImportRepository(IMPORT_ID, async () => {
        const raw = await memory.read(projectKey(IMPORT_ID));
        return raw === undefined ? undefined : JSON.parse(raw);
      });
    },
  };
});

// A conforming save and load of well-formed drafts has nothing to warn about, so a warning there
// means the repository found fault with records it wrote itself.
afterEach(() => {
  if (!warningsExpected) expect(logger.warn).not.toHaveBeenCalled();
});
