/** @file Unit tests for projectStorage.ts. */
/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectsForSource,
  listProjects,
  saveProjectAnalysis,
  updateProjectMetadata,
} from '../../services/projectStorage';
import { createTestActivationContext } from '../test-helpers';

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

/**
 * Type guard that narrows `m` to `StorageMock`.
 *
 * @param m - The value to test.
 * @returns `m is StorageMock` — `true` when `m` has all three mock storage properties and the mock
 *   logger.
 */
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

const EMPTY_ANALYSIS = { segmentAnalyses: [], tokenAnalyses: [], phrases: [] };

/**
 * Constructs an ENOENT Error that mirrors the error thrown by `papi.storage.readUserData` when a
 * storage key has never been written.
 *
 * @returns An `Error` with `code` set to `'ENOENT'`.
 */
function enoentError(): Error {
  return Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
}

describe('projectStorage', () => {
  beforeEach(() => {
    __mockWriteUserData.mockResolvedValue(undefined);
    __mockDeleteUserData.mockResolvedValue(undefined);
    jest.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
  });

  describe('createProject', () => {
    it('returns a project with the given fields and empty analysis/links', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project).toMatchObject({
        id: '00000000-0000-0000-0000-000000000001',
        sourceProjectId: 'src-proj',
        analysisLanguages: ['en'],
        analysis: EMPTY_ANALYSIS,
        links: [],
      });
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('stores multiple analysis languages when provided', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en', 'fr']);

      expect(project.analysisLanguages).toEqual(['en', 'fr']);
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

    it('stores targetProjectId when provided', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en'], 'tgt-proj');

      expect(project.targetProjectId).toBe('tgt-proj');
    });

    it('omits targetProjectId when not provided', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', ['en']);

      expect(project).not.toHaveProperty('targetProjectId');
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
  });

  describe('getProject', () => {
    it('returns the parsed project when the key exists', async () => {
      const stored = {
        id: 'abc',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceProjectId: 'src',
        analysisLanguages: ['fr'],
        analysis: EMPTY_ANALYSIS,
        links: [],
      };
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
  });

  describe('listProjects', () => {
    it('returns an empty array when no index exists', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await listProjects(token);

      expect(result).toEqual([]);
    });

    it('returns all projects listed in the index', async () => {
      const p1 = {
        id: 'id-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceProjectId: 'src',
        analysisLanguages: ['en'],
        analysis: EMPTY_ANALYSIS,
        links: [],
      };
      const p2 = { ...p1, id: 'id-2' };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1', 'id-2']))
        .mockResolvedValueOnce(JSON.stringify(p1))
        .mockResolvedValueOnce(JSON.stringify(p2));

      const result = await listProjects(token);

      expect(result).toEqual([p1, p2]);
    });

    it('omits projects whose storage keys are missing', async () => {
      const p1 = {
        id: 'id-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceProjectId: 'src',
        analysisLanguages: ['en'],
        analysis: EMPTY_ANALYSIS,
        links: [],
      };
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['id-1', 'id-missing']))
        .mockResolvedValueOnce(JSON.stringify(p1))
        .mockRejectedValueOnce(enoentError());

      const result = await listProjects(token);

      expect(result).toEqual([p1]);
    });
  });

  describe('updateProjectMetadata', () => {
    const storedProject = {
      id: 'proj-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src',
      analysisLanguages: ['en'],
      analysis: EMPTY_ANALYSIS,
      links: [],
    };

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
        JSON.stringify({ ...storedProject, name: 'My Name', description: 'My Desc' }),
      );
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

    it('updates analysisLanguages to the provided value', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['fr']);

      expect(result?.analysisLanguages).toEqual(['fr']);
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).toMatchObject({ analysisLanguages: ['fr'] });
      }
    });

    it('sets targetProjectId when provided', async () => {
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
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).toMatchObject({ targetProjectId: 'tgt-proj' });
      }
    });

    it('clears targetProjectId when omitted', async () => {
      const withTarget = { ...storedProject, targetProjectId: 'old-tgt' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(withTarget));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['en']);

      expect(result).not.toHaveProperty('targetProjectId');
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

    it('throws RangeError and does not write the index when the project is not in the index', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['other']));

      await expect(deleteProject(token, 'nonexistent')).rejects.toThrow(RangeError);
      expect(__mockWriteUserData).not.toHaveBeenCalled();
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

    it('deletes the project record and rethrows when the index write fails', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete']));
      __mockWriteUserData.mockRejectedValue(new Error('disk full'));

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('disk full');

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:to-delete');
    });

    it('propagates unexpected errors from deleteUserData', async () => {
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));
      __mockReadUserData.mockResolvedValue(JSON.stringify(['to-delete']));

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('permission denied');
    });

    it('propagates the error and does not write the index when the project index does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await expect(deleteProject(token, 'nonexistent-id')).rejects.toThrow('ENOENT');
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });
  });

  describe('getProjectsForSource', () => {
    const baseProject = {
      id: 'id-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-a',
      analysisLanguages: ['en'],
      analysis: EMPTY_ANALYSIS,
      links: [],
    };

    it('returns only projects whose sourceProjectId matches', async () => {
      const p1 = { ...baseProject, id: 'id-1', sourceProjectId: 'src-a' };
      const p2 = { ...baseProject, id: 'id-2', sourceProjectId: 'src-b' };
      const p3 = { ...baseProject, id: 'id-3', sourceProjectId: 'src-a' };
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

      // Serialized order: read1 → write1 → read2 → write2 (no interleaving)
      expect(ops).toEqual(['read:1', 'write:index', 'read:2', 'write:index']);
    });
  });
  describe('saveProjectAnalysis', () => {
    const storedProject = {
      id: 'proj-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src',
      analysisLanguages: ['en'],
      analysis: EMPTY_ANALYSIS,
      links: [],
    };

    const updatedAnalysis = {
      segmentAnalyses: [
        {
          id: 'sa-1',
          segmentId: 'seg-1',
          status: 'approved' as const,
        },
      ],
      tokenAnalyses: [],
      phrases: [],
    };

    const updatedLinks = [
      {
        id: 'link-1',
        sourceEndpoints: [{ tokenId: 'tok-1' }],
        targetEndpoints: [{ tokenId: 'tok-2' }],
        status: 'approved' as const,
      },
    ];

    it('returns the updated project with the new analysis and links', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await saveProjectAnalysis(token, 'proj-id', updatedAnalysis, updatedLinks);

      expect(result).toMatchObject({
        id: 'proj-id',
        analysis: updatedAnalysis,
        links: updatedLinks,
      });
    });

    it('preserves metadata fields unchanged', async () => {
      const withMeta = { ...storedProject, name: 'My Project', description: 'My desc' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(withMeta));

      const result = await saveProjectAnalysis(token, 'proj-id', updatedAnalysis, updatedLinks);

      expect(result?.name).toBe('My Project');
      expect(result?.description).toBe('My desc');
      expect(result?.analysisLanguages).toEqual(['en']);
    });

    it('writes the updated project to storage', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      await saveProjectAnalysis(token, 'proj-id', updatedAnalysis, updatedLinks);

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:proj-id',
        JSON.stringify({ ...storedProject, analysis: updatedAnalysis, links: updatedLinks }),
      );
    });

    it('returns undefined when the project does not exist', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const result = await saveProjectAnalysis(token, 'missing', updatedAnalysis, updatedLinks);

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
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
  });
});
