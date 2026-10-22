/// <reference types="jest" />

import type { InterlinearProject } from 'interlinearizer';
import { Pt9ImportRepository } from '../../services/pt9ImportRepository';
import type { AnalysisRepository } from '../../types/analysis-repository';
import { ReadOnlyAnalysisError } from '../../types/read-only-analysis-error';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import { FIXTURE_STAMPS, makeStubProject } from '../test-helpers';

function makeImport(overrides: Partial<InterlinearProject> = {}): InterlinearProject {
  return {
    ...makeStubProject('import-id'),
    name: 'Paratext 9 import',
    description: 'Imported from Paratext 9',
    pt9Import: { fileHashes: { 'Interlinear_en_GEN.xml': 'hash' }, importedAt: '2026-02-01' },
    ...overrides,
  };
}

function repositoryOver(project: InterlinearProject | undefined) {
  return new Pt9ImportRepository('import-id', async () => project);
}

describe('Pt9ImportRepository', () => {
  it('is read-only', () => {
    expect(repositoryOver(makeImport()).capabilities.readOnly).toBe(true);
  });

  describe('exportAll', () => {
    it("loads the import's analysis and languages as a clean draft of its source project", async () => {
      const analysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'and' }],
      };

      await expect(
        repositoryOver(makeImport({ analysisLanguages: ['fr', 'en'], analysis })).exportAll(),
      ).resolves.toStrictEqual({
        draft: { ...emptyDraft('src-project'), analysisLanguages: ['fr', 'en'], analysis },
        unreadableBooks: [],
      });
    });

    it("carries the import's target project and boundaries", async () => {
      const segmentation = { removedVerseStarts: ['GEN 1:2'], addedStarts: [] };

      const { draft } = await repositoryOver(
        makeImport({ targetProjectId: 'target', segmentation }),
      ).exportAll();

      expect(draft.targetProjectId).toBe('target');
      expect(draft.segmentation).toStrictEqual(segmentation);
    });

    it('stamps the draft with the current model version', async () => {
      const { draft } = await repositoryOver(
        makeImport({ modelVersion: CURRENT_MODEL_VERSION - 1 }),
      ).exportAll();

      expect(draft.modelVersion).toBe(CURRENT_MODEL_VERSION);
    });

    it('refuses when no project is stored under its id', async () => {
      await expect(repositoryOver(undefined).exportAll()).rejects.toThrow(
        'no Paratext 9 import is stored as project import-id',
      );
    });

    it('refuses a project that is not a Paratext 9 import', async () => {
      await expect(repositoryOver(makeStubProject('import-id')).exportAll()).rejects.toThrow(
        'no Paratext 9 import is stored as project import-id',
      );
    });

    it('rethrows a failed read', async () => {
      const repository = new Pt9ImportRepository('import-id', async () => {
        throw new Error('disk full');
      });

      await expect(repository.exportAll()).rejects.toThrow('disk full');
    });
  });

  describe('exportForCopy', () => {
    it('loads the import as exportAll does', async () => {
      const repository = repositoryOver(makeImport());

      await expect(repository.exportForCopy()).resolves.toStrictEqual(await repository.exportAll());
    });
  });

  describe('markClean', () => {
    it('refuses, reading nothing', async () => {
      const readProject = jest.fn(async () => makeImport());

      await expect(new Pt9ImportRepository('import-id', readProject).markClean()).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
      expect(readProject).not.toHaveBeenCalled();
    });
  });

  describe('replaceAll', () => {
    it('refuses every save', async () => {
      const readProject = jest.fn(async () => makeImport());
      const repository: AnalysisRepository = new Pt9ImportRepository('import-id', readProject);

      await expect(repository.replaceAll(emptyDraft('src-project'))).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
      expect(readProject).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('refuses every change', async () => {
      const readProject = jest.fn(async () => makeImport());
      const repository: AnalysisRepository = new Pt9ImportRepository('import-id', readProject);

      await expect(repository.apply({ intent: 'writeGloss' })).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
      expect(readProject).not.toHaveBeenCalled();
    });
  });
});
