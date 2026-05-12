/** @file Unit tests for projectStorage.ts. */
/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectsForSource,
  listProjects,
  updateProjectMetadata,
} from '../../services/projectStorage';
import { createTestActivationContext } from '../test-helpers';

interface StorageMock {
  __mockReadUserData: jest.Mock;
  __mockWriteUserData: jest.Mock;
  __mockDeleteUserData: jest.Mock;
}

function isStorageMock(m: unknown): m is StorageMock {
  return (
    !!m &&
    typeof m === 'object' &&
    '__mockReadUserData' in m &&
    '__mockWriteUserData' in m &&
    '__mockDeleteUserData' in m
  );
}

if (!isStorageMock(papiBackendMock)) throw new Error('Expected mocked @papi/backend with storage');
const { __mockReadUserData, __mockWriteUserData, __mockDeleteUserData } = papiBackendMock;

const token = createTestActivationContext().executionToken;

const EMPTY_ANALYSIS = { segmentAnalyses: [], tokenAnalyses: [], phrases: [] };

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

      const project = await createProject(token, 'src-proj', 'en');

      expect(project).toMatchObject({
        id: '00000000-0000-0000-0000-000000000001',
        sourceProjectId: 'src-proj',
        analysisWritingSystem: 'en',
        sourceAnalysis: EMPTY_ANALYSIS,
        targetAnalysis: EMPTY_ANALYSIS,
        links: [],
      });
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('stores name and description when provided', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', 'en', 'My Name', 'My Desc');

      expect(project.name).toBe('My Name');
      expect(project.description).toBe('My Desc');
    });

    it('writes the project JSON under the project key', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      const project = await createProject(token, 'src-proj', 'en');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:00000000-0000-0000-0000-000000000001',
        JSON.stringify(project),
      );
    });

    it('creates a new index when none exists', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await createProject(token, 'src-proj', 'en');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['00000000-0000-0000-0000-000000000001']),
      );
    });

    it('appends to an existing index', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(['existing-id']));

      await createProject(token, 'src-proj', 'en');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'projectIds',
        JSON.stringify(['existing-id', '00000000-0000-0000-0000-000000000001']),
      );
    });
  });

  describe('getProject', () => {
    it('returns the parsed project when the key exists', async () => {
      const stored = {
        id: 'abc',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceProjectId: 'src',
        analysisWritingSystem: 'fr',
        sourceAnalysis: EMPTY_ANALYSIS,
        targetAnalysis: EMPTY_ANALYSIS,
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
        analysisWritingSystem: 'en',
        sourceAnalysis: EMPTY_ANALYSIS,
        targetAnalysis: EMPTY_ANALYSIS,
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
        analysisWritingSystem: 'en',
        sourceAnalysis: EMPTY_ANALYSIS,
        targetAnalysis: EMPTY_ANALYSIS,
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
      analysisWritingSystem: 'en',
      sourceAnalysis: EMPTY_ANALYSIS,
      targetAnalysis: EMPTY_ANALYSIS,
      links: [],
    };

    it('returns the updated project with the new name and description', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc');

      expect(result).toMatchObject({ id: 'proj-id', name: 'My Name', description: 'My Desc' });
    });

    it('writes the updated project to storage', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'project:proj-id',
        JSON.stringify({ ...storedProject, name: 'My Name', description: 'My Desc' }),
      );
    });

    it('removes name and description when called with undefined', async () => {
      const withMeta = { ...storedProject, name: 'Old', description: 'Old desc' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(withMeta));

      const result = await updateProjectMetadata(token, 'proj-id', undefined, undefined);

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

      const result = await updateProjectMetadata(token, 'missing', 'Name', 'Desc');

      expect(result).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('updates analysisWritingSystem when a non-empty value is provided', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', 'fr');

      expect(result?.analysisWritingSystem).toBe('fr');
      const writtenArg: unknown = __mockWriteUserData.mock.calls[0]?.[2];
      expect(typeof writtenArg).toBe('string');
      if (typeof writtenArg === 'string') {
        const parsed: unknown = JSON.parse(writtenArg);
        expect(parsed).toMatchObject({ analysisWritingSystem: 'fr' });
      }
    });

    it('does not update analysisWritingSystem when an empty string is provided', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', '');

      expect(result?.analysisWritingSystem).toBe('en');
    });

    it('does not update analysisWritingSystem when undefined is provided', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(storedProject));

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc');

      expect(result?.analysisWritingSystem).toBe('en');
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

  describe('getProjectsForSource', () => {
    const baseProject = {
      id: 'id-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceProjectId: 'src-a',
      analysisWritingSystem: 'en',
      sourceAnalysis: EMPTY_ANALYSIS,
      targetAnalysis: EMPTY_ANALYSIS,
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

  describe('error propagation', () => {
    it('propagates non-ENOENT errors from readIds', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(createProject(token, 'src', 'en')).rejects.toThrow('disk full');
    });

    it('propagates non-ENOENT errors from getProject', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(getProject(token, 'abc')).rejects.toThrow('disk full');
    });

    it('propagates a JSON parse error from readIds as a corrupt-index signal', async () => {
      __mockReadUserData.mockResolvedValue('not valid json');

      await expect(listProjects(token)).rejects.toThrow(SyntaxError);
    });

    it('propagates a JSON parse error from getProject as a corrupt-record signal', async () => {
      __mockReadUserData
        .mockResolvedValueOnce(JSON.stringify(['abc']))
        .mockResolvedValueOnce('not valid json');

      await expect(listProjects(token)).rejects.toThrow(SyntaxError);
    });
  });
});
