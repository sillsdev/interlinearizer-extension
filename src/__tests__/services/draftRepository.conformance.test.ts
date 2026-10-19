/// <reference types="jest" />

import { DraftRepository } from '../../services/draftRepository';
import { draftKey } from '../../services/storageKeys';
import { emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { describeAnalysisRepositoryConformance } from '../analysis-repository-conformance';
import { memoryStorage, silentLogger } from '../test-helpers';

const logger = silentLogger();

describeAnalysisRepositoryConformance('DraftRepository', () => {
  const { storage } = memoryStorage();
  return {
    open: async (sourceProjectId) => new DraftRepository(storage, sourceProjectId, logger),
    storeNewerBuildDraft: (sourceProjectId) =>
      storage.write(
        draftKey(sourceProjectId),
        JSON.stringify({ ...emptyDraft(sourceProjectId), modelVersion: CURRENT_MODEL_VERSION + 1 }),
      ),
  };
});

// A conforming save and load of well-formed drafts has nothing to warn about, so a warning means
// the repository found fault with records it wrote itself.
afterEach(() => {
  expect(logger.warn).not.toHaveBeenCalled();
});
