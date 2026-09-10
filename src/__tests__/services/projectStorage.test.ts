/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { DraftProject } from 'interlinearizer';
import {
  createEditableCopy,
  createProject,
  deleteProject,
  getDraft,
  getProject,
  getProjectsForSource,
  getPt9ImportForSource,
  hasDraft,
  listProjects,
  resetQueuesForTesting,
  saveDraft,
  savePt9Import,
  sweepPendingCleanup,
  updateAnalysis,
  updateProjectMetadata,
} from '../../services/projectStorage';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { removeBookFromAnalysis } from '../../utils/analysis-book';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import {
  createTestActivationContext,
  enoentError,
  FIXTURE_STAMPS,
  makePhraseLink,
  makeStubProject,
} from '../test-helpers';

/**
 * Mock implementation of storage methods used in tests. Exposes `__mockReadUserData`,
 * `__mockWriteUserData`, and `__mockDeleteUserData` as jest fns so tests can assert on calls to
 * `papi.storage`, and `__mockLogger` so tests can assert on `papi.logger` calls.
 */
interface StorageMock {
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockDeleteUserData: jest.Mock;
  __mockLogger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock; warn: jest.Mock };
}

function isStorageMock(m: unknown): m is StorageMock {
  return (
    !!m &&
    typeof m === 'object' &&
    '__mockReadUserData' in m &&
    '__mockWriteUserData' in m &&
    '__mockDeleteUserData' in m &&
    '__mockLogger' in m
  );
}

if (!isStorageMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend with storage');
const { __mockReadUserData, __mockWriteUserData, __mockDeleteUserData, __mockLogger } =
  papiBackendMock;

const token = createTestActivationContext().executionToken;

/** A draft with one approved token analysis in each of the named books. */
function makeDraftSpanningBooks(sourceProjectId: string, ...bookCodes: string[]): DraftProject {
  const draft = emptyDraft(sourceProjectId);
  bookCodes.forEach((book) => {
    draft.analysis.tokenAnalyses.push({
      id: `analysis-${book}`,
      ...FIXTURE_STAMPS,
      surfaceText: `word-${book}`,
      gloss: { en: `gloss-${book}` },
    });
    draft.analysis.tokenAnalysisLinks.push({
      analysisId: `analysis-${book}`,
      ...FIXTURE_STAMPS,
      status: 'approved',
      token: { tokenRef: `${book} 1:1!0`, surfaceText: `word-${book}` },
    });
  });
  return draft;
}

/** Every key written during the test, in call order. */
function writtenKeys(): string[] {
  return __mockWriteUserData.mock.calls.map(([, key]) => (typeof key === 'string' ? key : ''));
}

/** Total characters of JSON handed to storage across every write of the current test. */
function bytesWritten(): number {
  return __mockWriteUserData.mock.calls.reduce(
    (sum, [, , json]) => sum + (typeof json === 'string' ? json.length : 0),
    0,
  );
}

describe('projectStorage', () => {
  beforeEach(() => {
    resetQueuesForTesting();
    __mockWriteUserData.mockResolvedValue(undefined);
    __mockDeleteUserData.mockResolvedValue(undefined);
    jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
  });

  // restoreMocks does not undo fake timers, so a test that installs them and then fails an
  // assertion would strand every later test on a frozen clock.
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createProject', () => {
    it('returns a project with the given fields and empty analysis when analysis-only', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project).toMatchObject({
        id: '00000000-0000-0000-0000-000000000001',
        sourceProjectId: 'src-proj',
        analysisLanguages: ['en'],
        analysis: emptyAnalysis(),
      });
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets updatedAt equal to createdAt at creation', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project.updatedAt).toBe(project.createdAt);
    });

    it('stamps the model version this build writes', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project.modelVersion).toBe(CURRENT_MODEL_VERSION);
    });

    it('omits links and targetProjectId for analysis-only projects', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project).not.toHaveProperty('links');
      expect(project).not.toHaveProperty('targetProjectId');
    });

    it('initializes empty links and stores targetProjectId for bilateral projects', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en'], 'tgt-proj');

      expect(project).toMatchObject({
        sourceProjectId: 'src-proj',
        targetProjectId: 'tgt-proj',
        links: [],
      });
    });

    it('stores name and description when provided', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(
        token,
        'src-proj',
        ['en'],
        undefined,
        'My Name',
        'My Desc',
      );

      expect(project.name).toBe('My Name');
      expect(project.description).toBe('My Desc');
    });

    it('writes the project JSON under the project key', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:00000000-0000-0000-0000-000000000001',
        JSON.stringify(project),
      );
    });

    it('creates a new index when none exists', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await createProject(token, 'src-proj', ['en']);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['00000000-0000-0000-0000-000000000001']),
      );
    });

    it('appends to an existing index', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['existing-id']));

      await createProject(token, 'src-proj', ['en']);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['existing-id', '00000000-0000-0000-0000-000000000001']),
      );
    });

    it('rolls back the project write and rethrows when the index write fails', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockDeleteUserData).toHaveBeenCalledWith(
        token,
        'project:00000000-0000-0000-0000-000000000001',
      );
    });

    it('logs a rollback error and still rethrows the original error', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockLogger.error).toHaveBeenCalled();
    });

    it('records the orphaned project for cleanup when rollback fails', async () => {
      // Index read (ENOENT → []) and the later pendingCleanup read (ENOENT → []) both miss.
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['00000000-0000-0000-0000-000000000001']),
      );
    });

    it('logs and swallows a failure to record the orphan so the index error still surfaces', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      // project write ok; index write fails; pendingCleanup write also fails.
      __mockWriteUserData
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk full'))
        .mockRejectedValueOnce(new Error('cleanup write failed'));
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('record orphaned project'),
        expect.any(Error),
      );
    });

    it('does not re-record an orphan already in the pending-cleanup set', async () => {
      const orphanId = '00000000-0000-0000-0000-000000000001';
      // Index read → ENOENT ([]); pendingCleanup read → already contains this orphan.
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'pendingCleanup'
          ? Promise.resolve(JSON.stringify([orphanId]))
          : Promise.reject(enoentError()),
      );
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockWriteUserData).not.toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        expect.anything(),
      );
    });

    it('does not record the orphan when the rollback delete succeeds', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // index write fails
      // deleteUserData resolves (default mock) → rollback succeeds, nothing to record.

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockWriteUserData).not.toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        expect.anything(),
      );
    });
  });

  describe('getProject', () => {
    it('returns the parsed project when the key exists', async () => {
      const stored = { ...makeStubProject('abc'), analysisLanguages: ['fr'] };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const result = await getProject(token, 'abc');

      expect(result).toEqual(stored);
      expect(__mockReadUserData).toHaveBeenCalledWith(token, 'project:abc');
    });

    it('returns undefined when the key does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await getProject(token, 'missing');

      expect(result).toBeUndefined();
    });

    it('reports the model version a stored project carries', async () => {
      const stored = { ...makeStubProject('abc'), modelVersion: CURRENT_MODEL_VERSION - 1 };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const result = await getProject(token, 'abc');

      expect(result?.modelVersion).toBe(CURRENT_MODEL_VERSION - 1);
    });

    it('refuses a project written by a newer build', async () => {
      const stored = { ...makeStubProject('abc'), modelVersion: CURRENT_MODEL_VERSION + 1 };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await expect(getProject(token, 'abc')).rejects.toThrow(
        `Interlinearizer: project abc has model version ${CURRENT_MODEL_VERSION + 1}, which is newer than this build supports (${CURRENT_MODEL_VERSION})`,
      );
    });

    it('dates a project stored without a modification time by its creation time', async () => {
      const raw: Record<string, unknown> = JSON.parse(JSON.stringify(makeStubProject('abc')));
      delete raw.updatedAt;
      __mockReadUserData.mockResolvedValue(JSON.stringify(raw));

      const result = await getProject(token, 'abc');

      expect(result?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('dates a project stored without any time by the read time', async () => {
      // Only damage outside the extension drops the creation time, leaving the load itself as the
      // one bound left on the record's age.
      const READ_TIME = '2026-06-06T06:06:06.000Z';
      jest.useFakeTimers().setSystemTime(new Date(READ_TIME));
      const raw: Record<string, unknown> = JSON.parse(JSON.stringify(makeStubProject('abc')));
      delete raw.createdAt;
      delete raw.updatedAt;
      __mockReadUserData.mockResolvedValue(JSON.stringify(raw));

      const result = await getProject(token, 'abc');

      expect(result).toMatchObject({ createdAt: READ_TIME, updatedAt: READ_TIME });
    });

    it('returns a project whose analysis is missing rather than faulting', async () => {
      const raw: Record<string, unknown> = JSON.parse(JSON.stringify(makeStubProject('abc')));
      delete raw.analysis;
      __mockReadUserData.mockResolvedValue(JSON.stringify(raw));

      const result = await getProject(token, 'abc');

      expect(result?.id).toBe('abc');
      expect(result?.analysis).toBeUndefined();
    });
  });

  describe('listProjects', () => {
    it('returns an empty array when no index exists', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await listProjects(token);

      expect(result).toEqual([]);
    });

    it('returns all projects listed in the index', async () => {
      const p1 = makeStubProject('id-1');
      const p2 = { ...p1, id: 'id-2' };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1', 'id-2']))
        .mockResolvedValueOnce(JSON.stringify(p1))
        .mockResolvedValueOnce(JSON.stringify(p2));

      const result = await listProjects(token);

      expect(result).toEqual([p1, p2]);
    });

    it('omits projects whose storage keys are missing', async () => {
      const p1 = makeStubProject('id-1');
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1', 'id-missing']))
        .mockResolvedValueOnce(JSON.stringify(p1))
        .mockRejectedValueOnce(enoentError());

      const result = await listProjects(token);

      expect(result).toEqual([p1]);
    });
  });

  describe('updateProjectMetadata', () => {
    const storedProject = makeStubProject('proj-id');
    // `updateProjectMetadata` stamps `updatedAt` with `new Date()`; freeze the clock so the exact
    // stored payload is deterministic and distinct from the fixture's `createdAt`/`updatedAt`.
    const UPDATE_TIME = '2026-03-01T12:00:00.000Z';

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date(UPDATE_TIME));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns the updated project with the new name and description', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result).toMatchObject({ id: 'proj-id', name: 'My Name', description: 'My Desc' });
    });

    it('writes the updated project to storage', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:proj-id',
        JSON.stringify({
          ...storedProject,
          updatedAt: UPDATE_TIME,
          modelVersion: CURRENT_MODEL_VERSION,
          name: 'My Name',
          description: 'My Desc',
        }),
      );
    });

    it('refreshes updatedAt to the current time', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result?.updatedAt).toBe(UPDATE_TIME);
    });

    it('stamps the current model version over an older one', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify({ ...storedProject, modelVersion: 0 }));

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result?.modelVersion).toBe(CURRENT_MODEL_VERSION);
    });

    it('refuses a project written by a newer build', async () => {
      __mockReadUserData.mockResolvedValue(
        JSON.stringify({ ...storedProject, modelVersion: CURRENT_MODEL_VERSION + 1 }),
      );

      await expect(
        updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']),
      ).rejects.toThrow(/newer than this build supports/);
    });

    it('leaves a project written by a newer build unwritten', async () => {
      __mockReadUserData.mockResolvedValue(
        JSON.stringify({ ...storedProject, modelVersion: CURRENT_MODEL_VERSION + 1 }),
      );

      await expect(
        updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']),
      ).rejects.toThrow();

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('removes name and description when called with undefined', async () => {
      const withMeta = { ...storedProject, name: 'Old', description: 'Old desc' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(withMeta));

      const result = await updateProjectMetadata(token, 'proj-id', undefined, undefined, ['en']);

      expect(result?.name).toBeUndefined();
      expect(result?.description).toBeUndefined();
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).not.toHaveProperty('name');
        expect(parsed).not.toHaveProperty('description');
      }
    });

    it('returns undefined when the project does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await updateProjectMetadata(token, 'missing', 'Name', 'Desc', ['en']);

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('overwrites analysisLanguages with the provided value', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['fr', 'de']);

      expect(result?.analysisLanguages).toEqual(['fr', 'de']);
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).toMatchObject({ analysisLanguages: ['fr', 'de'] });
      }
    });

    it('leaves analysisLanguages unchanged when the current value is passed back', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['en']);

      expect(result?.analysisLanguages).toEqual(['en']);
    });

    it('sets targetProjectId when a value is provided', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(
        token,
        'proj-id',
        'Name',
        'Desc',
        ['en'],
        'tgt-proj',
      );

      expect(result?.targetProjectId).toBe('tgt-proj');
    });

    it('clears targetProjectId when undefined is passed', async () => {
      const withTarget = { ...storedProject, targetProjectId: 'tgt-proj' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(withTarget));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['en']);

      expect(result?.targetProjectId).toBeUndefined();
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).not.toHaveProperty('targetProjectId');
      }
    });
  });

  describe('deleteProject', () => {
    it('deletes the project key from storage', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete', 'other']));

      await deleteProject(token, 'to-delete');

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:to-delete');
    });

    it('removes the project ID from the index', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete', 'other']));

      await deleteProject(token, 'to-delete');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['other']),
      );
    });

    it('writes an empty index when the deleted project was the only one', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete']));

      await deleteProject(token, 'to-delete');

      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'projectIds', JSON.stringify([]));
    });

    it('no-ops silently when the project is not in the index', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['other']));

      await deleteProject(token, 'nonexistent');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['other']),
      );
    });

    it('completes index cleanup when the project file is already missing', async () => {
      __mockDeleteUserData.mockRejectedValue(enoentError());
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete', 'other']));

      await deleteProject(token, 'to-delete');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['other']),
      );
    });

    it('propagates unexpected errors from deleteUserData', async () => {
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete']));

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('permission denied');
    });

    it('completes successfully when the project index does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await deleteProject(token, 'nonexistent-id');

      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'projectIds', JSON.stringify([]));
    });
  });

  describe('sweepPendingCleanup', () => {
    /**
     * Makes `readUserData` return `pendingCleanup` as the given id list and ENOENT for every other
     * key, so a sweep sees exactly `ids` as its work set.
     */
    function stubPendingCleanup(ids: string[]): void {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'pendingCleanup'
          ? Promise.resolve(JSON.stringify(ids))
          : Promise.reject(enoentError()),
      );
    }

    it('returns 0 and writes nothing when the set is empty', async () => {
      stubPendingCleanup([]);

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(0);
      expect(__mockDeleteUserData).not.toHaveBeenCalled();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('deletes each recorded record and clears the set on full success', async () => {
      stubPendingCleanup(['orphan-a', 'orphan-b']);

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(2);
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:orphan-a');
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:orphan-b');
      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'pendingCleanup', JSON.stringify([]));
    });

    it('treats an already-missing record (ENOENT) as successfully cleaned', async () => {
      stubPendingCleanup(['gone']);
      __mockDeleteUserData.mockRejectedValue(enoentError());

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(1);
      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'pendingCleanup', JSON.stringify([]));
    });

    it('retains an id whose deletion fails again and logs it', async () => {
      stubPendingCleanup(['stubborn', 'ok']);
      __mockDeleteUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'project:stubborn'
          ? Promise.reject(new Error('still locked'))
          : Promise.resolve(undefined),
      );

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(1);
      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['stubborn']),
      );
      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('stubborn'),
        expect.any(Error),
      );
    });

    it('propagates a non-ENOENT error from reading the pending-cleanup set', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(sweepPendingCleanup(token)).rejects.toThrow('disk full');
    });

    it('does not rewrite the set when no ids could be cleaned', async () => {
      stubPendingCleanup(['stubborn']);
      __mockDeleteUserData.mockRejectedValue(new Error('still locked'));

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(0);
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('never deletes the record of an id still present in the index', async () => {
      // 'live' is both recorded for cleanup and still in the index (e.g. an index write that
      // persisted but reported failure). Its backing record must not be deleted.
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
        if (key === 'pendingCleanup') return Promise.resolve(JSON.stringify(['live', 'orphan']));
        if (key === 'projectIds') return Promise.resolve(JSON.stringify(['live']));
        return Promise.reject(enoentError());
      });

      const cleaned = await sweepPendingCleanup(token);

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'project:live');
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:orphan');
      // 'live' is only a real orphan record when deleted; it was skipped, so it is not counted.
      expect(cleaned).toBe(1);
    });

    it('drops a live id from the set without counting or deleting it', async () => {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
        if (key === 'pendingCleanup') return Promise.resolve(JSON.stringify(['live']));
        if (key === 'projectIds') return Promise.resolve(JSON.stringify(['live']));
        return Promise.reject(enoentError());
      });

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(0);
      expect(__mockDeleteUserData).not.toHaveBeenCalled();
      // The set is rewritten to drop the non-orphan id even though nothing was deleted.
      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'pendingCleanup', JSON.stringify([]));
    });

    it('self-heals a pending-cleanup value containing invalid JSON by rewriting it to an empty set', async () => {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'pendingCleanup' ? Promise.resolve('{ not json') : Promise.reject(enoentError()),
      );

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(0);
      expect(__mockDeleteUserData).not.toHaveBeenCalled();
      expect(__mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
      // The corrupt value is overwritten so it is not re-read and re-warned about on every launch.
      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'pendingCleanup', JSON.stringify([]));
    });

    it('self-heals a pending-cleanup value that is not an array of strings by rewriting it to an empty set', async () => {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'pendingCleanup'
          ? Promise.resolve(JSON.stringify([1, 2, 3]))
          : Promise.reject(enoentError()),
      );

      const cleaned = await sweepPendingCleanup(token);

      expect(cleaned).toBe(0);
      expect(__mockDeleteUserData).not.toHaveBeenCalled();
      expect(__mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not an array'));
      // The corrupt value is overwritten so it is not re-read and re-warned about on every launch.
      expect(__mockWriteUserData).toHaveBeenCalledWith(token, 'pendingCleanup', JSON.stringify([]));
    });
  });

  describe('updateAnalysis', () => {
    const storedProject = makeStubProject('proj-id');
    const newAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In', gloss: { en: 'in' } }],
    };
    // `updateAnalysis` stamps `updatedAt` with `new Date()`; freeze the clock so the exact stored
    // payload is deterministic and distinct from the fixture's `createdAt`/`updatedAt`.
    const UPDATE_TIME = '2026-03-01T12:00:00.000Z';

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date(UPDATE_TIME));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns the updated project with the new analysis', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toMatchObject({ id: 'proj-id', analysis: newAnalysis });
    });

    it('writes the updated project to storage', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:proj-id',
        JSON.stringify({
          ...storedProject,
          analysis: newAnalysis,
          updatedAt: UPDATE_TIME,
          modelVersion: CURRENT_MODEL_VERSION,
        }),
      );
    });

    it('refreshes updatedAt to the current time', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result?.updatedAt).toBe(UPDATE_TIME);
    });

    it('stamps the current model version over an older one', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify({ ...storedProject, modelVersion: 0 }));

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result?.modelVersion).toBe(CURRENT_MODEL_VERSION);
    });

    it('refuses a project written by a newer build', async () => {
      __mockReadUserData.mockResolvedValue(
        JSON.stringify({ ...storedProject, modelVersion: CURRENT_MODEL_VERSION + 1 }),
      );

      await expect(updateAnalysis(token, 'proj-id', newAnalysis)).rejects.toThrow(
        /newer than this build supports/,
      );
    });

    it('leaves a project written by a newer build unwritten', async () => {
      __mockReadUserData.mockResolvedValue(
        JSON.stringify({ ...storedProject, modelVersion: CURRENT_MODEL_VERSION + 1 }),
      );

      await expect(updateAnalysis(token, 'proj-id', newAnalysis)).rejects.toThrow();

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('returns undefined when the project does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await updateAnalysis(token, 'missing', newAnalysis);

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('propagates non-ENOENT errors from storage', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(updateAnalysis(token, 'proj-id', newAnalysis)).rejects.toThrow('disk full');
    });

    it('writes a provided segmentation delta onto the project', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));
      const segmentation = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

      const result = await updateAnalysis(token, 'proj-id', newAnalysis, segmentation);

      expect(result).toMatchObject({ analysis: newAnalysis, segmentation });
      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:proj-id',
        JSON.stringify({
          ...storedProject,
          analysis: newAnalysis,
          updatedAt: UPDATE_TIME,
          modelVersion: CURRENT_MODEL_VERSION,
          segmentation,
        }),
      );
    });

    it('clears stored boundaries when segmentation is null', async () => {
      const projectWithBoundaries = {
        ...storedProject,
        segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      };
      __mockReadUserData.mockResolvedValue(JSON.stringify(projectWithBoundaries));

      // eslint-disable-next-line no-null/no-null -- explicit "clear boundaries" sentinel under test
      const result = await updateAnalysis(token, 'proj-id', newAnalysis, null);

      expect(result && 'segmentation' in result).toBe(false);
    });

    it('leaves existing boundaries unchanged when segmentation is undefined', async () => {
      const projectWithBoundaries = {
        ...storedProject,
        segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      };
      __mockReadUserData.mockResolvedValue(JSON.stringify(projectWithBoundaries));

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toMatchObject({ segmentation: projectWithBoundaries.segmentation });
    });
  });

  describe('getProjectsForSource', () => {
    const baseProject = { ...makeStubProject('id-1'), sourceProjectId: 'src-a' };

    it('returns only projects whose sourceProjectId matches', async () => {
      const p1 = { ...baseProject, id: 'id-1' };
      const p2 = { ...baseProject, id: 'id-2', sourceProjectId: 'src-b' };
      const p3 = { ...baseProject, id: 'id-3' };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1', 'id-2', 'id-3']))
        .mockResolvedValueOnce(JSON.stringify(p1))
        .mockResolvedValueOnce(JSON.stringify(p2))
        .mockResolvedValueOnce(JSON.stringify(p3));

      const result = await getProjectsForSource(token, 'src-a');

      expect(result).toEqual([p1, p3]);
    });

    it('returns an empty array when no projects match the source', async () => {
      const p1 = { ...baseProject, id: 'id-1', sourceProjectId: 'src-b' };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1']))
        .mockResolvedValueOnce(JSON.stringify(p1));

      const result = await getProjectsForSource(token, 'src-a');

      expect(result).toEqual([]);
    });
  });

  describe('concurrent index serialization', () => {
    it('does not interleave index reads and writes across concurrent createProject calls', async () => {
      // Track the order of index reads and writes to verify they do not interleave.
      const ops: string[] = [];
      let resolveFirstIndexRead!: (value: string) => void;
      const firstIndexReadGate = new Promise<string>((resolve) => {
        resolveFirstIndexRead = resolve;
      });

      let readCallCount = 0;
      __mockReadUserData.mockImplementation(() => {
        readCallCount += 1;
        ops.push(`read:${readCallCount}`);
        if (readCallCount === 1) return firstIndexReadGate;
        return Promise.resolve(JSON.stringify([]));
      });
      __mockWriteUserData.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_t: unknown, key: unknown, _v: unknown): Promise<void> => {
          if (key === 'projectIds') ops.push('write:index');
          return Promise.resolve();
        },
      );

      jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000002');

      const p1 = createProject(token, 'src', ['en']);
      const p2 = createProject(token, 'src', ['en']);

      resolveFirstIndexRead(JSON.stringify([]));

      await Promise.all([p1, p2]);

      expect(ops).toEqual(['read:1', 'write:index', 'read:2', 'write:index']);
    });
  });

  describe('error propagation', () => {
    it('propagates non-ENOENT errors from readIds', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(createProject(token, 'src', ['en'])).rejects.toThrow('disk full');
    });

    it('propagates non-ENOENT errors from getProject', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(getProject(token, 'abc')).rejects.toThrow('disk full');
    });

    it('propagates a JSON parse error from readIds as a corrupt-index signal', async () => {
      __mockReadUserData.mockResolvedValue('not valid json');

      await expect(listProjects(token)).rejects.toThrow(SyntaxError);
    });

    it('throws a corruption error when the projectIds index is not an array', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify({ not: 'an array' }));

      await expect(listProjects(token)).rejects.toThrow(/index is corrupt/);
    });

    it('throws a corruption error when the projectIds index holds non-strings', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify([1, 2, 3]));

      await expect(listProjects(token)).rejects.toThrow(/index is corrupt/);
    });

    it('skips a project whose storage value is corrupt JSON and logs the error', async () => {
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['abc']))
        .mockResolvedValueOnce('not valid json');

      const result = await listProjects(token);

      expect(result).toEqual([]);
      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('abc'),
        expect.any(SyntaxError),
      );
    });

    it('skips a project written by a newer build rather than failing the whole list', async () => {
      const fromNewerBuild = {
        ...makeStubProject('future-proj'),
        modelVersion: CURRENT_MODEL_VERSION + 1,
      };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['future-proj', 'abc']))
        .mockResolvedValueOnce(JSON.stringify(fromNewerBuild))
        .mockResolvedValueOnce(JSON.stringify(makeStubProject('abc')));

      const result = await listProjects(token);

      expect(result.map((p) => p.id)).toEqual(['abc']);
      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('future-proj'),
        expect.objectContaining({ message: expect.stringContaining('newer than this build') }),
      );
    });
  });

  describe('hasDraft', () => {
    it('answers true when a draft is stored, without parsing it', async () => {
      __mockReadUserData.mockResolvedValue('not even json');

      await expect(hasDraft(token, 'src-proj')).resolves.toBe(true);
      expect(__mockReadUserData).toHaveBeenCalledWith(token, 'draft:src-proj');
    });

    it('answers false when no draft has ever been written', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await expect(hasDraft(token, 'src-proj')).resolves.toBe(false);
    });

    it('rethrows a read failure that is not file-not-found', async () => {
      __mockReadUserData.mockRejectedValue(new Error('storage unavailable'));

      await expect(hasDraft(token, 'src-proj')).rejects.toThrow('storage unavailable');
    });
  });

  describe('getDraft', () => {
    it('returns the parsed stored draft read from the draft key', async () => {
      const stored = { ...emptyDraft('src-proj'), analysisLanguages: ['fr'], dirty: true };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const result = await getDraft(token, 'src-proj');

      expect(result).toEqual(stored);
      expect(__mockReadUserData).toHaveBeenCalledWith(token, 'draft:src-proj');
    });

    it('discards a stored draft that carries no model version', async () => {
      const unversioned: Record<string, unknown> = { ...emptyDraft('src-proj') };
      delete unversioned.modelVersion;
      __mockReadUserData.mockResolvedValue(JSON.stringify(unversioned));

      const result = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: stored draft failed validation; resetting to empty draft',
      );
    });

    it('discards a stored draft whose model version is not a number', async () => {
      const stored = { ...emptyDraft('src-proj'), modelVersion: 'one' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const result = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: stored draft failed validation; resetting to empty draft',
      );
    });

    it('holds an auto-save for the same source behind an in-flight read', async () => {
      // Issuing the save mid-read is the window in which an unserialized read could observe a
      // part-written draft.
      const stored = emptyDraft('src-proj');
      let releaseRead = () => {};
      __mockReadUserData.mockReturnValue(
        new Promise<string>((resolve) => {
          releaseRead = () => resolve(JSON.stringify(stored));
        }),
      );
      const newer = { ...emptyDraft('src-proj'), analysisLanguages: ['fr'] };

      const read = getDraft(token, 'src-proj');
      const save = saveDraft(token, 'src-proj', newer);
      expect(__mockWriteUserData).not.toHaveBeenCalled();
      releaseRead();
      await Promise.all([read, save]);

      expect(__mockWriteUserData).toHaveBeenCalledTimes(1);
      const [, , json] = __mockWriteUserData.mock.calls[0];
      expect(typeof json === 'string' && JSON.parse(json)).toEqual({
        ...newer,
        modelVersion: CURRENT_MODEL_VERSION,
        analysisBooks: [],
      });
    });

    it('loads a draft stored before partitioning, whose analysis is inline', async () => {
      const legacy = emptyDraft('src-proj');
      legacy.analysis.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 'ta-1',
        surfaceText: 'In',
        gloss: { en: 'in' },
      });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj') return JSON.stringify(legacy);
        throw enoentError();
      });

      expect(await getDraft(token, 'src-proj')).toEqual(legacy);
    });

    it('keeps the other books when one shard is missing', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw enoentError();
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const loaded = await getDraft(token, 'src-proj');

      expect(loaded.analysis.tokenAnalysisLinks).toHaveLength(1);
      expect(loaded.analysis.tokenAnalysisLinks[0].token.tokenRef).toBe('GEN 1:1!0');
    });

    it('keeps the other books when one shard holds invalid JSON', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const loaded = await getDraft(token, 'src-proj');

      expect(loaded.analysis.tokenAnalysisLinks).toHaveLength(1);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: analysis shard draft:src-proj:analysis:JHN is not valid JSON; treating as empty',
      );
    });

    it('keeps the other books when one shard is not a valid analysis', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return JSON.stringify({ tokenAnalyses: 'no' });
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const loaded = await getDraft(token, 'src-proj');

      expect(loaded.analysis.tokenAnalysisLinks).toHaveLength(1);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: analysis shard draft:src-proj:analysis:JHN failed validation; treating as empty',
      );
    });

    it('propagates a shard read failure that is not a missing key', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:GEN') throw new Error('disk on fire');
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      await expect(getDraft(token, 'src-proj')).rejects.toThrow('disk on fire');
    });

    it('falls back to the inline analysis when the shard manifest is corrupt', async () => {
      // An unusable manifest names no readable shards, leaving the inline analysis the only copy.
      const legacy = emptyDraft('src-proj');
      legacy.analysis.tokenAnalyses.push({ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj') return JSON.stringify({ ...legacy, analysisBooks: 'GEN' });
        throw enoentError();
      });

      expect(await getDraft(token, 'src-proj')).toEqual(legacy);
    });

    it('does not write to storage when reading a stored draft', async () => {
      const stored = emptyDraft('src-proj');
      stored.analysis.tokenAnalyses.push({ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' });
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await getDraft(token, 'src-proj');

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('returns a fresh empty draft when no draft has been written (ENOENT)', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
    });

    it('does not write to storage when returning a fresh empty draft', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await getDraft(token, 'src-proj');

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('rethrows a non-ENOENT error from storage', async () => {
      __mockReadUserData.mockRejectedValue(new Error('permission denied'));

      await expect(getDraft(token, 'src-proj')).rejects.toThrow('permission denied');
    });

    it('propagates a JSON parse error when the stored draft is corrupt', async () => {
      __mockReadUserData.mockResolvedValue('not valid json');

      await expect(getDraft(token, 'src-proj')).rejects.toThrow(SyntaxError);
    });

    it('refuses a draft written by a newer build', async () => {
      const stored = { ...emptyDraft('src-proj'), modelVersion: CURRENT_MODEL_VERSION + 1 };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await expect(getDraft(token, 'src-proj')).rejects.toThrow(
        `Interlinearizer: draft for source project src-proj has model version ${CURRENT_MODEL_VERSION + 1}, which is newer than this build supports (${CURRENT_MODEL_VERSION})`,
      );
    });

    it('refuses a newer draft whose shape this build cannot validate, rather than discarding it', async () => {
      // The analysis is shaped in a way this build's validation rejects, and failing validation is
      // what discards a draft — so the refusal has to come first.
      const stored = {
        ...emptyDraft('src-proj'),
        modelVersion: CURRENT_MODEL_VERSION + 1,
        analysis: { someShapeThisBuildDoesNotKnow: [] },
      };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await expect(getDraft(token, 'src-proj')).rejects.toThrow(/newer than this build supports/);
      expect(__mockLogger.warn).not.toHaveBeenCalled();
    });

    it('returns an empty draft and warns when the stored value does not match DraftProject shape', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify({ not: 'a draft' }));

      const result = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: stored draft failed validation; resetting to empty draft',
      );
    });
  });

  describe('saveDraft', () => {
    beforeEach(() => {
      // Every save reads the stored draft before writing; absent unless a test stores one.
      __mockReadUserData.mockRejectedValue(enoentError());
    });

    it("writes a book's analyses to that book's own shard", async () => {
      await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'JHN'));

      expect(writtenKeys()).toContain('draft:src-proj:analysis:JHN');
    });

    it('reads back a draft spanning several books whole, so the pool keeps every book', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN', 'REV');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      expect(await getDraft(token, 'src-proj')).toEqual(draft);
    });

    it('stores a phrase spanning two books once, and reads it back intact', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'EXO');
      draft.analysis.phraseAnalyses.push({
        id: 'phrase-1',
        ...FIXTURE_STAMPS,
        surfaceText: 'across books',
        gloss: { en: 'spanning' },
      });
      draft.analysis.phraseAnalysisLinks.push(
        makePhraseLink('phrase-1', ['GEN 1:1!0', 'EXO 1:1!0']),
      );

      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const loaded = await getDraft(token, 'src-proj');
      expect(loaded.analysis.phraseAnalysisLinks).toHaveLength(1);
      expect(loaded.analysis.phraseAnalyses).toHaveLength(1);
      expect(loaded).toEqual(draft);
    });

    it('reunites an analysis shared across books into a single payload', async () => {
      // Dedup on write means several books link one analysis, so each shard carries its own copy.
      const draft = emptyDraft('src-proj');
      draft.analysis.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 'shared',
        surfaceText: 'and',
        gloss: { en: 'and' },
      });
      ['GEN', 'EXO'].forEach((book) => {
        draft.analysis.tokenAnalysisLinks.push({
          analysisId: 'shared',
          ...FIXTURE_STAMPS,
          status: 'approved',
          token: { tokenRef: `${book} 1:1!0`, surfaceText: 'and' },
        });
      });

      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const loaded = await getDraft(token, 'src-proj');
      expect(loaded.analysis.tokenAnalyses).toHaveLength(1);
      expect(loaded.analysis.tokenAnalysisLinks).toHaveLength(2);
    });

    it('rewrites only the edited book, leaving other books untouched', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN', 'REV');
      await saveDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockClear();

      const [genLink] = draft.analysis.tokenAnalysisLinks;
      genLink.token.surfaceText = 'edited';
      await saveDraft(token, 'src-proj', draft);

      expect(writtenKeys()).toContain('draft:src-proj:analysis:GEN');
      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:JHN');
      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:REV');
    });

    it('writes far fewer bytes for a one-book edit than for the whole draft', async () => {
      // The ratio is loose so this guards the bound rather than the fixture's exact size.
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'PSA', 'ISA', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      const fullSaveBytes = bytesWritten();
      __mockWriteUserData.mockClear();

      const [genLink] = draft.analysis.tokenAnalysisLinks;
      genLink.token.surfaceText = 'edited';
      await saveDraft(token, 'src-proj', draft);

      expect(bytesWritten()).toBeLessThan(fullSaveBytes / 2);
    });

    it("deletes a wiped book's shard rather than leaving it orphaned", async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('deletes a shard named only by the stored manifest, which this process never loaded', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      // Clears the shard caches so only the stored manifest knows the earlier shards exist, as in a
      // later run of the extension host that holds the draft in memory without loading it.
      resetQueuesForTesting();

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('wipes no shard when the stored draft names no readable manifest', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      // Stamped for this build, so the version check passes and the shape guard is what rejects it.
      __mockReadUserData.mockResolvedValue(
        JSON.stringify({ not: 'a draft', modelVersion: CURRENT_MODEL_VERSION }),
      );
      resetQueuesForTesting();

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('saves the remaining books when a wiped shard was already gone', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockDeleteUserData.mockRejectedValue(enoentError());

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toBeUndefined();
    });

    it('propagates a shard delete failure that is not a missing key', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');

      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('permission denied');
    });

    it("stops listing a wiped book before deleting that book's shard", async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      const order: string[] = [];
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj') order.push('envelope');
      });
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') order.push('delete');
      });

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await saveDraft(token, 'src-proj', draft);

      expect(order).toEqual(['envelope', 'delete']);
    });

    it('leaves no book listed whose shard a failed save already deleted', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj') throw new Error('envelope write failed');
      });

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('envelope write failed');

      // The old envelope still names JHN, so its shard had to survive for that entry to resolve.
      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('reopens a torn save holding books from both saves', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj') throw new Error('envelope write failed');
      });

      const regloss = draft.analysis.tokenAnalyses.find(({ id }) => id === 'analysis-GEN');
      if (!regloss) throw new Error('Expected the fixture to carry a GEN analysis');
      regloss.gloss = { en: 'regloss-GEN' };
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('envelope write failed');

      // GEN's shard landed before the envelope write failed, leaving JHN's as the first save wrote it.
      const reopened = await getDraft(token, 'src-proj');
      expect(reopened.analysis.tokenAnalyses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'analysis-GEN', gloss: { en: 'regloss-GEN' } }),
          expect.objectContaining({ id: 'analysis-JHN', gloss: { en: 'gloss-JHN' } }),
        ]),
      );
    });

    it('recovers a new book whose shard outlived the envelope write, across a restart', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      await saveDraft(token, 'src-proj', draft);
      // A write that rejects must leave nothing readable behind, or the stored envelope would name
      // the very shard this save is meant to strand.
      const stored = new Map<string, string>();
      __mockWriteUserData.mock.calls.forEach(([, key, json]) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key !== 'string' || !stored.has(key)) throw enoentError();
        return stored.get(key);
      });
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (key === 'draft:src-proj') throw new Error('envelope write failed');
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });

      // JHN is analyzed for the first time, so only this save's envelope would name its shard.
      draft.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('envelope write failed');

      // Stands in for an extension-host restart, which keeps no shard tally across it.
      resetQueuesForTesting();

      const reopened = await getDraft(token, 'src-proj');
      expect(reopened.analysis.tokenAnalyses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'analysis-JHN', gloss: { en: 'gloss-JHN' } }),
        ]),
      );
    });

    it('retries a failed shard deletion on a later save, across a restart', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      const stored = new Map<string, string>();
      __mockWriteUserData.mock.calls.forEach(([, key, json]) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key !== 'string' || !stored.has(key)) throw enoentError();
        return stored.get(key);
      });
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      // Only the shard deletion fails; clearing the journal must still be able to delete its key.
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw new Error('permission denied');
        if (typeof key === 'string') stored.delete(key);
      });

      // The envelope write has to land, or the manifest would still name JHN and rediscover the
      // orphan on its own, leaving the journal untested.
      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('permission denied');
      expect(stored.get('draft:src-proj')).not.toContain('JHN');

      // Stands in for an extension-host restart, leaving the journal as the orphan's only name.
      resetQueuesForTesting();
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key === 'string') stored.delete(key);
      });
      // Cleared so the failed attempt above cannot satisfy the retry this test is asserting on.
      __mockDeleteUserData.mockClear();

      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('reports the shard deletion failure, not a journal cleanup that also failed', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw new Error('shard delete failed');
      });
      // The orphan is owed to the journal, so recording it is a write rather than a delete. Only
      // the cleanup write fails; the one before the shard writes must land, or the save stops there.
      let journalWrites = 0;
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key !== 'draft:src-proj:shards') return;
        journalWrites += 1;
        if (journalWrites > 1) throw new Error('journal write failed');
      });

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');

      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('shard delete failed');
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not update the shard journal for src-proj:',
        expect.any(Error),
      );
    });

    it('propagates a journal cleanup failure when the deletions all succeeded', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockDeleteUserData.mockRejectedValue(new Error('journal delete failed'));

      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('journal delete failed');
    });

    it('propagates a journal read failure that is not a missing key', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:shards') throw new Error('permission denied');
        throw enoentError();
      });

      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('permission denied');
    });

    it('saves past a journal holding invalid JSON', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:shards') return '{not json';
        throw enoentError();
      });

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toBeUndefined();
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: shard journal for src-proj is not valid JSON; treating as empty',
      );
    });

    it('saves past a journal holding a JSON null', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:shards') return 'null';
        throw enoentError();
      });

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toBeUndefined();
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: shard journal for src-proj is malformed; treating as empty',
      );
    });

    it('saves past a journal that is well-formed JSON of the wrong shape', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:shards') return JSON.stringify({ adding: 'GEN' });
        throw enoentError();
      });

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toBeUndefined();
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: shard journal for src-proj is malformed; treating as empty',
      );
    });

    it("keeps an unreadable book's shard rather than treating it as wiped", async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      await saveDraft(token, 'src-proj', await getDraft(token, 'src-proj'));

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('keeps an unreadable book in the manifest so its shard stays reachable', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw enoentError();
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      await saveDraft(token, 'src-proj', await getDraft(token, 'src-proj'));

      const [, , json] = __mockWriteUserData.mock.calls.findLast(([, k]) => k === 'draft:src-proj');
      expect(typeof json === 'string' && JSON.parse(json).analysisBooks).toEqual(
        expect.arrayContaining(['GEN', 'JHN']),
      );
    });

    it("rewrites an unreadable book's shard once that book has analyses again", async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const loaded = await getDraft(token, 'src-proj');
      __mockWriteUserData.mockClear();

      loaded.analysis = makeDraftSpanningBooks('src-proj', 'JHN').analysis;
      await saveDraft(token, 'src-proj', loaded);

      expect(writtenKeys()).toContain('draft:src-proj:analysis:JHN');
    });

    it('wipes a book that an earlier save restored from an unreadable shard', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const loaded = await getDraft(token, 'src-proj');
      loaded.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await saveDraft(token, 'src-proj', loaded);

      loaded.analysis = removeBookFromAnalysis(loaded.analysis, 'JHN');
      await saveDraft(token, 'src-proj', loaded);

      const [, , json] = __mockWriteUserData.mock.calls.findLast(([, k]) => k === 'draft:src-proj');
      expect(typeof json === 'string' && JSON.parse(json).analysisBooks).toEqual(['GEN']);
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('wipes a restored book even when the same save failed to delete another shard', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN', 'MRK');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const loaded = await getDraft(token, 'src-proj');
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));

      loaded.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await expect(saveDraft(token, 'src-proj', loaded)).rejects.toThrow('permission denied');

      __mockDeleteUserData.mockResolvedValue(undefined);
      loaded.analysis = removeBookFromAnalysis(loaded.analysis, 'JHN');
      await saveDraft(token, 'src-proj', loaded);

      const [, , json] = __mockWriteUserData.mock.calls.findLast(([, k]) => k === 'draft:src-proj');
      expect(typeof json === 'string' && JSON.parse(json).analysisBooks).toEqual(['GEN']);
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('retries a shard deletion that failed on the save before', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('permission denied');

      __mockDeleteUserData.mockReset();
      __mockDeleteUserData.mockResolvedValue(undefined);
      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it('rewrites only the shard a failed save never landed', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw new Error('shard write failed');
      });

      const edited = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      edited.analysis.tokenAnalyses.forEach((analysis) => {
        analysis.gloss = { en: 'edited' };
      });
      await expect(saveDraft(token, 'src-proj', edited)).rejects.toThrow('shard write failed');

      __mockWriteUserData.mockReset();
      __mockWriteUserData.mockResolvedValue(undefined);
      await saveDraft(token, 'src-proj', edited);

      // GEN's edit reached storage on the failed save, so only JHN's is still owed a write.
      expect(writtenKeys()).toContain('draft:src-proj:analysis:JHN');
      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:GEN');
    });

    it('lets a slow shard write finish before a failed save releases the queue', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      let releaseSlowWrite = () => {};
      let markSlowWriteStarted = () => {};
      const slowWriteStarted = new Promise<void>((resolve) => {
        markSlowWriteStarted = resolve;
      });
      const slowWrite = new Promise<void>((resolve) => {
        releaseSlowWrite = resolve;
      });
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') throw new Error('shard write failed');
        if (key !== 'draft:src-proj:analysis:GEN') return;
        markSlowWriteStarted();
        await slowWrite;
      });

      const failing = saveDraft(token, 'src-proj', draft);
      await slowWriteStarted;
      // JHN has already rejected while GEN's write is still in flight, so a save that gave up on the
      // first rejection would reject before this timer releases GEN.
      let slowWriteSettled = false;
      const settleSlowWrite = () => {
        slowWriteSettled = true;
        releaseSlowWrite();
      };
      setTimeout(settleSlowWrite, 0);

      await expect(failing).rejects.toThrow('shard write failed');

      expect(slowWriteSettled).toBe(true);
    });

    it('writes the draft envelope under the draft key', async () => {
      const draft = { ...emptyDraft('src-proj'), analysisLanguages: ['en'], dirty: true };

      await saveDraft(token, 'src-proj', draft);

      const [, , json] = __mockWriteUserData.mock.calls.find(([, key]) => key === 'draft:src-proj');
      expect(typeof json === 'string' && JSON.parse(json)).toMatchObject({
        sourceProjectId: 'src-proj',
        analysisLanguages: ['en'],
        dirty: true,
        modelVersion: CURRENT_MODEL_VERSION,
      });
    });

    it('stamps the current model version over whatever version the caller held', async () => {
      await saveDraft(token, 'src-proj', { ...emptyDraft('src-proj'), modelVersion: 0 });

      const [, , json] = __mockWriteUserData.mock.calls[0];
      expect(typeof json === 'string' && JSON.parse(json).modelVersion).toBe(CURRENT_MODEL_VERSION);
    });

    it('never writes the projectIds index key', async () => {
      await saveDraft(token, 'src-proj', emptyDraft('src-proj'));

      expect(__mockWriteUserData).not.toHaveBeenCalledWith(token, 'projectIds', expect.anything());
    });

    it('replaces a stored draft this build can read', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(emptyDraft('src-proj')));

      await saveDraft(token, 'src-proj', { ...emptyDraft('src-proj'), dirty: true });

      expect(__mockWriteUserData).toHaveBeenCalledTimes(1);
    });

    it('refuses to overwrite a draft written by a newer build', async () => {
      const stored = { ...emptyDraft('src-proj'), modelVersion: CURRENT_MODEL_VERSION + 1 };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await expect(saveDraft(token, 'src-proj', emptyDraft('src-proj'))).rejects.toThrow(
        /newer than this build supports/,
      );

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('replaces a stored draft that cannot be parsed at all', async () => {
      // An unparseable draft carries no version to refuse and already reads as an empty draft, so a
      // save has to be able to replace it.
      __mockReadUserData.mockResolvedValue('not valid json');

      await saveDraft(token, 'src-proj', emptyDraft('src-proj'));

      expect(__mockWriteUserData).toHaveBeenCalledTimes(1);
    });

    it('refuses to write when the stored draft cannot be read at all', async () => {
      // A read that fails for a reason other than ENOENT says nothing about what is on disk, so it
      // cannot rule out a newer-build record that must not be overwritten.
      __mockReadUserData.mockRejectedValue(new Error('permission denied'));

      await expect(saveDraft(token, 'src-proj', emptyDraft('src-proj'))).rejects.toThrow(
        'permission denied',
      );

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('serializes concurrent writes to the same source so they resolve in order', async () => {
      const order: string[] = [];
      let resolveFirstWrite!: () => void;
      const firstWriteGate = new Promise<void>((resolve) => {
        resolveFirstWrite = resolve;
      });

      let writeCallCount = 0;
      __mockWriteUserData.mockImplementation((): Promise<void> => {
        writeCallCount += 1;
        if (writeCallCount === 1) return firstWriteGate;
        return Promise.resolve();
      });

      const first = saveDraft(token, 'src-proj', { ...emptyDraft('src-proj'), dirty: false }).then(
        () => order.push('first'),
      );
      const second = saveDraft(token, 'src-proj', { ...emptyDraft('src-proj'), dirty: true }).then(
        () => order.push('second'),
      );

      // The second write must not begin until the first settles: only one write has been issued.
      // A macrotask wait lets the first save's guard read settle, which is what releases its write.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      expect(writeCallCount).toBe(1);

      resolveFirstWrite();
      await Promise.all([first, second]);

      expect(order).toEqual(['first', 'second']);
      expect(writeCallCount).toBe(2);
    });

    describe('payloads belonging to no book', () => {
      /** A draft with one linked GEN analysis and one unlinked bare-wordform payload. */
      function makeDraftWithBareWord(): DraftProject {
        const draft = makeDraftSpanningBooks('src-proj', 'GEN');
        draft.analysis.tokenAnalyses.push({
          id: 'pt9:wa:bereshit:0',
          ...FIXTURE_STAMPS,
          surfaceText: 'bereshit',
          producer: 'pt9-import:word-analyses',
        });
        return draft;
      }

      /** Serves back whatever the test's own writes last stored at each key. */
      function readBackWrites(): void {
        __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
          const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
          if (!written) throw enoentError();
          return written[2];
        });
      }

      it('round-trips an unlinked analysis through a save and reload', async () => {
        await saveDraft(token, 'src-proj', makeDraftWithBareWord());
        readBackWrites();

        const loaded = await getDraft(token, 'src-proj');

        expect(loaded.analysis.tokenAnalyses.map((a) => a.id)).toEqual([
          'analysis-GEN',
          'pt9:wa:bereshit:0',
        ]);
      });

      it('stores the unlinked payload in its own shard, named by the manifest', async () => {
        await saveDraft(token, 'src-proj', makeDraftWithBareWord());

        expect(writtenKeys()).toContain('draft:src-proj:analysis:no book');
        const envelope = __mockWriteUserData.mock.calls.findLast(([, k]) => k === 'draft:src-proj');
        const [, , json] = envelope ?? [];
        expect(typeof json === 'string' && JSON.parse(json).analysisBooks).toEqual([
          'GEN',
          'no book',
        ]);
      });

      it('wipes the bookless shard once the draft carries no unlinked payload', async () => {
        await saveDraft(token, 'src-proj', makeDraftWithBareWord());
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:no book');
      });
    });
  });

  describe('Paratext 9 import projects', () => {
    const PT9_PROVENANCE = {
      fileHashes: { 'Lexicon.xml': 'aaaa1111' },
      importedAt: '2026-08-01T00:00:00.000Z',
    };
    const importedProject = {
      ...makeStubProject('import-id'),
      name: 'stale name',
      description: 'stale description',
      pt9Import: PT9_PROVENANCE,
    };
    const SAVE_TIME = '2026-08-21T12:00:00.000Z';

    /** Serves each record as the stored JSON for its key; any other key reads as never written. */
    function mockStore(records: Record<string, unknown>): void {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
        if (typeof key === 'string' && key in records)
          return Promise.resolve(JSON.stringify(records[key]));
        return Promise.reject(enoentError());
      });
    }

    describe('freeze guard', () => {
      it('rejects updateAnalysis without writing', async () => {
        mockStore({ 'project:import-id': importedProject });

        await expect(updateAnalysis(token, 'import-id', emptyAnalysis())).rejects.toThrow(
          'Paratext 9 import and is read-only',
        );
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });

      it('rejects updateProjectMetadata without writing', async () => {
        mockStore({ 'project:import-id': importedProject });

        await expect(
          updateProjectMetadata(token, 'import-id', 'new name', undefined, ['en']),
        ).rejects.toThrow('Paratext 9 import and is read-only');
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });

      it('still allows deleteProject', async () => {
        mockStore({ 'project:import-id': importedProject, projectIds: ['import-id'] });

        await deleteProject(token, 'import-id');

        expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:import-id');
      });
    });

    describe('getPt9ImportForSource', () => {
      it('returns the import among the source projects', async () => {
        mockStore({
          projectIds: ['plain-id', 'import-id'],
          'project:plain-id': makeStubProject('plain-id'),
          'project:import-id': importedProject,
        });

        const result = await getPt9ImportForSource(token, 'src-project');

        expect(result?.id).toBe('import-id');
      });

      it('returns undefined when no source project carries pt9Import', async () => {
        mockStore({
          projectIds: ['plain-id'],
          'project:plain-id': makeStubProject('plain-id'),
        });

        await expect(getPt9ImportForSource(token, 'src-project')).resolves.toBeUndefined();
      });
    });

    describe('savePt9Import', () => {
      const newAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'pt9:ta:GEN 1:1:0:0', surfaceText: 'hello' }],
      };
      const NEW_PROVENANCE = {
        fileHashes: { 'Lexicon.xml': 'bbbb2222' },
        importedAt: SAVE_TIME,
      };

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date(SAVE_TIME));
      });

      it('creates the import and indexes it when the source has none', async () => {
        mockStore({ projectIds: [] });

        const project = await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en', 'fr'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        expect(project).toMatchObject({
          id: '00000000-0000-0000-0000-000000000001',
          createdAt: SAVE_TIME,
          updatedAt: SAVE_TIME,
          name: 'Paratext 9 Interlinear',
          description: 'Imported from Paratext 9.',
          sourceProjectId: 'src-project',
          analysisLanguages: ['en', 'fr'],
          analysis: newAnalysis,
          pt9Import: NEW_PROVENANCE,
        });
        expect(__mockWriteUserData).toHaveBeenCalledWith(
          token,
          'projectIds',
          JSON.stringify(['00000000-0000-0000-0000-000000000001']),
        );
      });

      it('replaces the existing import wholesale, keeping only id and createdAt', async () => {
        mockStore({
          projectIds: ['import-id'],
          'project:import-id': { ...importedProject, targetProjectId: 'stray-target' },
        });

        const project = await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        expect(project.id).toBe('import-id');
        expect(__mockWriteUserData).toHaveBeenCalledTimes(1);
        expect(__mockWriteUserData).toHaveBeenCalledWith(
          token,
          'project:import-id',
          JSON.stringify({
            id: 'import-id',
            modelVersion: CURRENT_MODEL_VERSION,
            createdAt: importedProject.createdAt,
            updatedAt: SAVE_TIME,
            name: 'Paratext 9 Interlinear',
            description: 'Imported from Paratext 9.',
            sourceProjectId: 'src-project',
            analysisLanguages: ['en'],
            analysis: newAnalysis,
            pt9Import: NEW_PROVENANCE,
          }),
        );
      });

      it('creates a fresh record when the import is deleted between lookup and write', async () => {
        let importReads = 0;
        __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
          if (key === 'projectIds') return Promise.resolve(JSON.stringify(['import-id']));
          if (key === 'project:import-id') {
            importReads += 1;
            if (importReads === 1) return Promise.resolve(JSON.stringify(importedProject));
          }
          return Promise.reject(enoentError());
        });

        const project = await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        expect(project.id).toBe('00000000-0000-0000-0000-000000000001');
        expect(__mockWriteUserData).toHaveBeenCalledWith(
          token,
          'project:00000000-0000-0000-0000-000000000001',
          expect.stringContaining('"pt9Import"'),
        );
      });
    });

    describe('createEditableCopy', () => {
      it('creates an editable project carrying the analysis and no pt9Import', async () => {
        mockStore({
          projectIds: ['import-id'],
          'project:import-id': importedProject,
        });

        const copy = await createEditableCopy(token, 'import-id', 'My Copy', 'my description');

        expect(copy).toMatchObject({
          id: '00000000-0000-0000-0000-000000000001',
          name: 'My Copy',
          description: 'my description',
          sourceProjectId: importedProject.sourceProjectId,
          analysisLanguages: importedProject.analysisLanguages,
          analysis: importedProject.analysis,
        });
        expect(copy).not.toHaveProperty('pt9Import');
        expect(__mockWriteUserData).toHaveBeenCalledWith(
          token,
          'projectIds',
          JSON.stringify(['import-id', '00000000-0000-0000-0000-000000000001']),
        );
      });

      it('omits the description when none is given', async () => {
        mockStore({ projectIds: ['import-id'], 'project:import-id': importedProject });

        const copy = await createEditableCopy(token, 'import-id', 'My Copy');

        expect(copy).not.toHaveProperty('description');
      });

      it('throws when the project does not exist', async () => {
        mockStore({});

        await expect(createEditableCopy(token, 'missing', 'My Copy')).rejects.toThrow(
          'does not exist',
        );
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });

      it('throws when the project is not a Paratext 9 import', async () => {
        mockStore({ 'project:plain-id': makeStubProject('plain-id') });

        await expect(createEditableCopy(token, 'plain-id', 'My Copy')).rejects.toThrow(
          'not a Paratext 9 import',
        );
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });
    });
  });
});
