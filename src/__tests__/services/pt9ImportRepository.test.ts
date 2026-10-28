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

/** The revision of an import that no sync replaces. */
const NEVER_SYNCED = () => 0;

function repositoryOver(project: InterlinearProject | undefined) {
  return new Pt9ImportRepository(
    'import-id',
    async () => project && JSON.parse(JSON.stringify(project)),
    NEVER_SYNCED,
  );
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
      const repository = new Pt9ImportRepository(
        'import-id',
        async () => {
          throw new Error('disk full');
        },
        NEVER_SYNCED,
      );

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

      await expect(
        new Pt9ImportRepository('import-id', readProject, NEVER_SYNCED).markClean(),
      ).rejects.toThrow(ReadOnlyAnalysisError);
      expect(readProject).not.toHaveBeenCalled();
    });
  });

  describe('replaceAll', () => {
    it('refuses every save', async () => {
      const readProject = jest.fn(async () => makeImport());
      const repository: AnalysisRepository = new Pt9ImportRepository(
        'import-id',
        readProject,
        NEVER_SYNCED,
      );

      await expect(repository.replaceAll(emptyDraft('src-project'))).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
      expect(readProject).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('refuses every change', async () => {
      const readProject = jest.fn(async () => makeImport());
      const repository: AnalysisRepository = new Pt9ImportRepository(
        'import-id',
        readProject,
        NEVER_SYNCED,
      );

      await expect(repository.apply({ intent: 'writeGloss' })).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
      expect(readProject).not.toHaveBeenCalled();
    });
  });

  describe('lookups', () => {
    const imported = () =>
      makeImport({
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'and' }],
        },
      });

    it("answer from the import's records, reading it once", async () => {
      const readProject = jest.fn(async () => imported());
      const repository = new Pt9ImportRepository('import-id', readProject, NEVER_SYNCED);

      await expect(repository.getTokenAnalyses(['ta-1'])).resolves.toStrictEqual(
        imported().analysis.tokenAnalyses,
      );
      await repository.findTokenAnalysesByForm(['and']);

      expect(readProject).toHaveBeenCalledTimes(1);
    });

    it('keep what they read across a load', async () => {
      const readProject = jest.fn(async () => imported());
      const repository = new Pt9ImportRepository('import-id', readProject, NEVER_SYNCED);
      await repository.getTokenAnalyses(['ta-1']);

      await repository.exportAll();
      await repository.getTokenAnalyses(['ta-1']);

      expect(readProject).toHaveBeenCalledTimes(2);
    });

    it('answer from what exportAll read, reading nothing more', async () => {
      const readProject = jest.fn(async () => imported());
      const repository = new Pt9ImportRepository('import-id', readProject, NEVER_SYNCED);
      await repository.exportAll();

      await expect(repository.getTokenAnalyses(['ta-1'])).resolves.toHaveLength(1);
      expect(readProject).toHaveBeenCalledTimes(1);
    });

    it('are unchanged by changes to the draft exportAll returned', async () => {
      const repository = new Pt9ImportRepository('import-id', async () => imported(), NEVER_SYNCED);
      const { draft } = await repository.exportAll();

      draft.analysis.tokenAnalyses.length = 0;

      await expect(repository.getTokenAnalyses(['ta-1'])).resolves.toHaveLength(1);
    });

    it('read the import again once a sync replaces what exportAll read', async () => {
      let revision = 0;
      const readProject = jest.fn(async () => imported());
      const repository = new Pt9ImportRepository('import-id', readProject, () => revision);
      await repository.exportAll();

      revision = 1;
      await repository.getTokenAnalyses(['ta-1']);

      expect(readProject).toHaveBeenCalledTimes(2);
    });

    it('read the import again once a sync replaces it', async () => {
      let revision = 0;
      const synced = makeImport({
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [{ id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'but' }],
        },
      });
      const readProject = jest.fn(async () => (revision === 0 ? imported() : synced));
      const repository = new Pt9ImportRepository('import-id', readProject, () => revision);
      await repository.getTokenAnalyses(['ta-1']);

      revision = 1;

      await expect(repository.getTokenAnalyses(['ta-1'])).resolves.toStrictEqual(
        synced.analysis.tokenAnalyses,
      );
      expect(readProject).toHaveBeenCalledTimes(2);
    });

    it('read the import again after a sync that lands during a read', async () => {
      let revision = 0;
      const readProject = jest.fn(async () => {
        revision += 1;
        return imported();
      });
      const repository = new Pt9ImportRepository('import-id', readProject, () => revision);

      await repository.getTokenAnalyses(['ta-1']);
      await repository.getTokenAnalyses(['ta-1']);

      expect(readProject).toHaveBeenCalledTimes(2);
    });

    it('refuse when no import is stored', async () => {
      await expect(repositoryOver(undefined).getTokenAnalyses(['ta-1'])).rejects.toThrow(
        'no Paratext 9 import is stored as project import-id',
      );
    });
  });

  describe('checkIndexes', () => {
    it('reports nothing before a lookup', async () => {
      await expect(repositoryOver(makeImport()).checkIndexes()).resolves.toStrictEqual([]);
    });

    it('reports nothing after a lookup', async () => {
      const repository = repositoryOver(makeImport());
      await repository.getTokenAnalyses(['ta-1']);

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });

    it('reports nothing once a sync replaces the import', async () => {
      let revision = 0;
      const repository = new Pt9ImportRepository(
        'import-id',
        async () => makeImport(),
        () => revision,
      );
      await repository.getTokenAnalyses(['ta-1']);

      revision = 1;

      await expect(repository.checkIndexes()).resolves.toStrictEqual([]);
    });
  });
});
