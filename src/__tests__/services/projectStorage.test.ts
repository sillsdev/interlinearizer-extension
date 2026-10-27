/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { DraftProject, InterlinearProject, TextAnalysis } from 'interlinearizer';
import {
  createEditableCopy,
  createProject,
  deleteProject,
  getDraft,
  getProject,
  getProjectSummariesForSource,
  getPt9ImportForSource,
  hasDraft,
  openDraftRepository,
  openPt9ImportRepository,
  releaseDraftRepository,
  resetQueuesForTesting,
  saveDraft,
  saveDraftAsNewProject,
  saveDraftToProject,
  savePt9Import,
  sweepPendingCleanup,
  updateAnalysis,
  updateProjectMetadata,
} from '../../services/projectStorage';
import { summarizeProject } from '../../services/projectSummaries';
import type { AnalysisRepository } from '../../types/analysis-repository';
import { ReadOnlyAnalysisError } from '../../types/read-only-analysis-error';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { removeBookFromAnalysis } from '../../utils/analysis-book';
import { UnreadableBooksError } from '../../types/analysis-repository';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import {
  createTestActivationContext,
  enoentError,
  FIXTURE_STAMPS,
  makePhraseLink,
  makeStubProject,
  storedSummaries,
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
      id: `link-${book}`,
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

/** Serves each record as the stored JSON for its key; any other key reads as never written. */
function mockStore(records: Record<string, string>): void {
  __mockReadUserData.mockImplementation((_t: unknown, key: unknown) => {
    if (typeof key === 'string' && key in records) return Promise.resolve(records[key]);
    return Promise.reject(enoentError());
  });
}

/** Serves `records`, keeping every write and serving it back to later reads. */
function writeThroughStore(records: Record<string, string> = {}): void {
  const stored = new Map(Object.entries(records));
  __mockWriteUserData.mockImplementation(async (_t: unknown, key: string, value: string) => {
    stored.set(key, value);
  });
  __mockReadUserData.mockImplementation(async (_t: unknown, key: string) => {
    const value = stored.get(key);
    if (value === undefined) throw enoentError();
    return value;
  });
}

/** Stores `project` as its record, and lists it. */
function mockListedProject(project: InterlinearProject): void {
  mockStore({
    [`project:${project.id}`]: JSON.stringify(project),
    projectSummaries: storedSummaries(project),
  });
}

/** The project summaries the last write of them held. */
function writtenSummaries(): { id: string }[] {
  const writes = __mockWriteUserData.mock.calls.filter(([, key]) => key === 'projectSummaries');
  const json: unknown = writes[writes.length - 1]?.[2];
  if (typeof json !== 'string') throw new Error('Expected a write of the project summaries');
  return JSON.parse(json).summaries;
}

/** The ids the last write of the project summaries listed. */
function writtenSummaryIds(): string[] {
  return writtenSummaries().map(({ id }) => id);
}

/** Total characters of JSON handed to storage across every write of the current test. */
function bytesWritten(): number {
  return __mockWriteUserData.mock.calls.reduce(
    (sum, [, , json]) => sum + (typeof json === 'string' ? json.length : 0),
    0,
  );
}

/** An analysis whose one token link names a payload that is not there — the simplest violation. */
function analysisWithDanglingLink(): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalysisLinks: [
      {
        id: 'tl-2',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-missing',
        status: 'approved',
        token: { tokenRef: 'GEN 1:1:0', surfaceText: 'word' },
      },
    ],
  };
}

/** `analysis` as stored before links carried ids. */
function withoutLinkIds(analysis: TextAnalysis): unknown {
  const stripped = <L extends { id: string }>(link: L): Partial<L> => {
    const copy: Partial<L> = { ...link };
    delete copy.id;
    return copy;
  };
  return {
    ...analysis,
    tokenAnalysisLinks: analysis.tokenAnalysisLinks.map(stripped),
    segmentAnalysisLinks: analysis.segmentAnalysisLinks.map(stripped),
  };
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

    it('lists the project when no summaries are stored', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());

      await createProject(token, 'src-proj', ['en']);

      expect(writtenSummaryIds()).toEqual(['00000000-0000-0000-0000-000000000001']);
    });

    it('lists the project after those already listed', async () => {
      mockStore({ projectSummaries: storedSummaries(makeStubProject('existing-id')) });

      await createProject(token, 'src-proj', ['en']);

      expect(writtenSummaryIds()).toEqual(['existing-id', '00000000-0000-0000-0000-000000000001']);
    });

    it('rolls back the project write and rethrows when listing the project fails', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails

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
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockLogger.error).toHaveBeenCalled();
    });

    it('records the orphaned project for cleanup when rollback fails', async () => {
      // Summaries read and the later pendingCleanup read both miss.
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['00000000-0000-0000-0000-000000000001']),
      );
    });

    it('logs and swallows a failure to record the orphan so the listing error still surfaces', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      // project write ok; summaries write fails; pendingCleanup write also fails.
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
      // Summaries read misses; pendingCleanup read → already contains this orphan.
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'pendingCleanup'
          ? Promise.resolve(JSON.stringify([orphanId]))
          : Promise.reject(enoentError()),
      );
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails
      __mockDeleteUserData.mockRejectedValue(new Error('rollback failed'));

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(__mockWriteUserData).not.toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        expect.anything(),
      );
    });

    it('unlists a project whose listing persisted though its write failed', async () => {
      const created = makeStubProject('00000000-0000-0000-0000-000000000001');
      mockStore({ projectSummaries: storedSummaries(created) });
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk full');

      expect(writtenSummaryIds()).toEqual([]);
    });

    it('keeps the record when the rollback cannot unlist the project', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk unreadable'));
      __mockWriteUserData.mockResolvedValueOnce(undefined); // project write succeeds

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk unreadable');

      expect(__mockDeleteUserData).not.toHaveBeenCalled();
    });

    it('records the project for cleanup when the rollback cannot unlist it', async () => {
      __mockReadUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'projectSummaries'
          ? Promise.reject(new Error('disk unreadable'))
          : Promise.reject(enoentError()),
      );

      await expect(createProject(token, 'src-proj', ['en'])).rejects.toThrow('disk unreadable');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['00000000-0000-0000-0000-000000000001']),
      );
    });

    it('does not record the orphan when the rollback delete succeeds', async () => {
      __mockReadUserData.mockRejectedValue(enoentError());
      __mockWriteUserData
        .mockResolvedValueOnce(undefined) // project write succeeds
        .mockRejectedValueOnce(new Error('disk full')); // summaries write fails
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

    it('reports a stored analysis held as null rather than passing over it', async () => {
      const raw: Record<string, unknown> = JSON.parse(JSON.stringify(makeStubProject('abc')));
      // eslint-disable-next-line no-null/no-null -- the corrupt stored shape under test
      raw.analysis = null;
      __mockReadUserData.mockResolvedValue(JSON.stringify(raw));

      await getProject(token, 'abc');

      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: project abc on load has a structurally invalid analysis',
      );
    });

    it('reports an invariant violation the stored analysis carries', async () => {
      const stored = { ...makeStubProject('abc'), analysis: analysisWithDanglingLink() };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await getProject(token, 'abc');

      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: project abc on load has 1 token-layer danglingLink violation(s): GEN 1:1:0',
      );
    });

    it('returns a project whose analysis is structurally invalid rather than faulting', async () => {
      const raw: Record<string, unknown> = JSON.parse(JSON.stringify(makeStubProject('abc')));
      const analysis: Record<string, unknown> = JSON.parse(JSON.stringify(emptyAnalysis()));
      delete analysis.segmentAnalyses;
      raw.analysis = analysis;
      __mockReadUserData.mockResolvedValue(JSON.stringify(raw));

      const result = await getProject(token, 'abc');

      expect(result?.id).toBe('abc');
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: project abc on load has a structurally invalid analysis',
      );
    });

    it('reports nothing for a stored analysis whose collections agree', async () => {
      __mockReadUserData.mockResolvedValue(JSON.stringify(makeStubProject('abc')));

      await getProject(token, 'abc');

      expect(__mockLogger.warn).not.toHaveBeenCalled();
    });

    it('loads a project holding a link with no id with an empty analysis, and logs it', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      const stored = { ...makeStubProject('abc'), analysis: withoutLinkIds(draft.analysis) };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const result = await getProject(token, 'abc');

      expect(result?.analysis).toEqual(emptyAnalysis());
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: project abc has links without ids; loading it empty',
      );
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
      mockListedProject(storedProject);

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result).toMatchObject({ id: 'proj-id', name: 'My Name', description: 'My Desc' });
    });

    it('writes the updated project to storage', async () => {
      mockListedProject(storedProject);

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
      mockListedProject(storedProject);

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result?.updatedAt).toBe(UPDATE_TIME);
    });

    it("brings the project's listed summary up to date", async () => {
      mockListedProject(storedProject);

      await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(writtenSummaries()).toEqual([
        expect.objectContaining({ id: 'proj-id', name: 'My Name', updatedAt: UPDATE_TIME }),
      ]);
    });

    it('resolves with the written project when its summary fails to refresh', async () => {
      mockListedProject(storedProject);
      __mockWriteUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'projectSummaries' ? Promise.reject(new Error('disk full')) : Promise.resolve(),
      );

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result).toMatchObject({ id: 'proj-id', name: 'My Name' });
    });

    it('returns undefined for an unlisted project whose record remains', async () => {
      mockStore({ 'project:proj-id': JSON.stringify(storedProject) });

      const result = await updateProjectMetadata(token, 'proj-id', 'My Name', 'My Desc', ['en']);

      expect(result).toBeUndefined();
    });

    it('stamps the current model version over an older one', async () => {
      mockListedProject({ ...storedProject, modelVersion: 0 });

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
      mockListedProject(withMeta);

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
      mockListedProject(storedProject);

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
      mockListedProject(storedProject);

      const result = await updateProjectMetadata(token, 'proj-id', 'Name', 'Desc', ['en']);

      expect(result?.analysisLanguages).toEqual(['en']);
    });

    it('sets targetProjectId when a value is provided', async () => {
      mockListedProject(storedProject);

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
      mockListedProject(withTarget);

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
    const listed = storedSummaries(makeStubProject('to-delete'), makeStubProject('other'));

    it('deletes the project key from storage', async () => {
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'to-delete');

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:to-delete');
    });

    it('unlists the project', async () => {
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'to-delete');

      expect(writtenSummaryIds()).toEqual(['other']);
    });

    it('writes no summaries when the project is not listed', async () => {
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'nonexistent');

      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('makes a repository already opened over a deleted import refuse lookups', async () => {
      const imported: InterlinearProject = {
        ...makeStubProject('import-id'),
        pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
      };
      mockListedProject(imported);
      const repository = openPt9ImportRepository(token, 'import-id');
      await repository.getTokenAnalyses(['ta-1']);
      mockStore({ projectSummaries: storedSummaries(imported) });

      await deleteProject(token, 'import-id');

      await expect(repository.getTokenAnalyses(['ta-1'])).rejects.toThrow(
        'no Paratext 9 import is stored as project import-id',
      );
    });

    it('keeps no import a repository read while the import was being deleted', async () => {
      const imported: InterlinearProject = {
        ...makeStubProject('import-id'),
        pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
      };
      mockListedProject(imported);
      let markDeletionStarted = () => {};
      const deletionStarted = new Promise<void>((resolve) => {
        markDeletionStarted = resolve;
      });
      let finishDeletion = () => {};
      __mockDeleteUserData.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            markDeletionStarted();
            finishDeletion = resolve;
          }),
      );
      const repository = openPt9ImportRepository(token, 'import-id');

      const deletion = deleteProject(token, 'import-id');
      await deletionStarted;
      await repository.getTokenAnalyses(['ta-1']);
      mockStore({});
      finishDeletion();
      await deletion;

      await expect(repository.getTokenAnalyses(['ta-1'])).rejects.toThrow(
        'no Paratext 9 import is stored as project import-id',
      );
    });

    it('unlists the project when its record is already missing', async () => {
      __mockDeleteUserData.mockRejectedValue(enoentError());
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'to-delete');

      expect(writtenSummaryIds()).toEqual(['other']);
    });

    it('resolves when the unlisted record fails to delete', async () => {
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));
      mockStore({ projectSummaries: listed });

      await expect(deleteProject(token, 'to-delete')).resolves.toBeUndefined();
    });

    it('logs a failure to delete the unlisted record', async () => {
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'to-delete');

      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('unlisted project to-delete'),
        expect.any(Error),
      );
    });

    it('keeps the record when unlisting fails', async () => {
      __mockWriteUserData.mockRejectedValue(new Error('disk full'));
      mockStore({ projectSummaries: listed });

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('disk full');

      expect(__mockDeleteUserData).not.toHaveBeenCalled();
    });

    it('records the project for cleanup when unlisting fails', async () => {
      __mockWriteUserData.mockRejectedValueOnce(new Error('disk full'));
      mockStore({ projectSummaries: listed });

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('disk full');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['to-delete']),
      );
    });

    it('records the unlisted project for cleanup when its deletion fails', async () => {
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));
      mockStore({ projectSummaries: listed });

      await deleteProject(token, 'to-delete');

      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'pendingCleanup',
        JSON.stringify(['to-delete']),
      );
    });

    it('logs and swallows a failure to record the undeleted project so the unlisting error still surfaces', async () => {
      __mockWriteUserData
        .mockRejectedValueOnce(new Error('disk full'))
        .mockRejectedValueOnce(new Error('cleanup write failed'));
      mockStore({ projectSummaries: listed });

      await expect(deleteProject(token, 'to-delete')).rejects.toThrow('disk full');

      expect(__mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('record undeleted project'),
        expect.any(Error),
      );
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

    it('never deletes the record of an id still listed', async () => {
      // 'live' is both recorded for cleanup and still listed (e.g. a summaries write that
      // persisted but reported failure). Its backing record must not be deleted.
      mockStore({
        pendingCleanup: JSON.stringify(['live', 'orphan']),
        projectSummaries: storedSummaries(makeStubProject('live')),
      });

      const cleaned = await sweepPendingCleanup(token);

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'project:live');
      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:orphan');
      // 'live' is only a real orphan record when deleted; it was skipped, so it is not counted.
      expect(cleaned).toBe(1);
    });

    it('drops a live id from the set without counting or deleting it', async () => {
      mockStore({
        pendingCleanup: JSON.stringify(['live']),
        projectSummaries: storedSummaries(makeStubProject('live')),
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
      mockListedProject(storedProject);

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toMatchObject({ id: 'proj-id', analysis: newAnalysis });
    });

    it('reports an invariant violation the incoming analysis carries', async () => {
      mockListedProject(storedProject);

      await updateAnalysis(token, 'proj-id', analysisWithDanglingLink());

      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: project proj-id on save has 1 token-layer danglingLink violation(s): GEN 1:1:0',
      );
    });

    it('writes an analysis that violates an invariant rather than refusing it', async () => {
      mockListedProject(storedProject);

      const result = await updateAnalysis(token, 'proj-id', analysisWithDanglingLink());

      expect(result).toMatchObject({ analysis: analysisWithDanglingLink() });
      expect(__mockWriteUserData).toHaveBeenCalled();
    });

    it('writes the updated project to storage', async () => {
      mockListedProject(storedProject);

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
      mockListedProject(storedProject);

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result?.updatedAt).toBe(UPDATE_TIME);
    });

    it("brings the project's listed summary up to date", async () => {
      mockListedProject(storedProject);

      await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(writtenSummaries()).toEqual([
        expect.objectContaining({ id: 'proj-id', tokenAnalysisCount: 1, updatedAt: UPDATE_TIME }),
      ]);
    });

    it('resolves with the written project when its summary fails to refresh', async () => {
      mockListedProject(storedProject);
      __mockWriteUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'projectSummaries' ? Promise.reject(new Error('disk full')) : Promise.resolve(),
      );

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toMatchObject({ id: 'proj-id', analysis: newAnalysis });
      expect(writtenKeys()).toEqual(['project:proj-id', 'projectSummaries']);
    });

    it('logs a failure to refresh the summary', async () => {
      mockListedProject(storedProject);
      __mockWriteUserData.mockImplementation((_t: unknown, key: unknown) =>
        key === 'projectSummaries' ? Promise.reject(new Error('disk full')) : Promise.resolve(),
      );

      await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(__mockLogger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to refresh the listed summary of project proj-id:',
        expect.any(Error),
      );
    });

    it('returns undefined for an unlisted project whose record remains', async () => {
      mockStore({ 'project:proj-id': JSON.stringify(storedProject) });

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toBeUndefined();
    });

    it('stamps the current model version over an older one', async () => {
      mockListedProject({ ...storedProject, modelVersion: 0 });

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
      mockListedProject(storedProject);
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
      mockListedProject(projectWithBoundaries);

      // eslint-disable-next-line no-null/no-null -- explicit "clear boundaries" sentinel under test
      const result = await updateAnalysis(token, 'proj-id', newAnalysis, null);

      expect(result && 'segmentation' in result).toBe(false);
    });

    it('leaves existing boundaries unchanged when segmentation is undefined', async () => {
      const projectWithBoundaries = {
        ...storedProject,
        segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      };
      mockListedProject(projectWithBoundaries);

      const result = await updateAnalysis(token, 'proj-id', newAnalysis);

      expect(result).toMatchObject({ segmentation: projectWithBoundaries.segmentation });
    });
  });

  describe('getProjectSummariesForSource', () => {
    const inSource = (id: string, sourceProjectId: string) => ({
      ...makeStubProject(id),
      sourceProjectId,
    });

    it("returns only the source's projects", async () => {
      mockStore({
        projectSummaries: storedSummaries(
          inSource('id-1', 'src-a'),
          inSource('id-2', 'src-b'),
          inSource('id-3', 'src-a'),
        ),
      });

      const result = await getProjectSummariesForSource(token, 'src-a');

      expect(result.map(({ id }) => id)).toEqual(['id-1', 'id-3']);
    });

    it('reads no project record', async () => {
      mockStore({
        projectSummaries: storedSummaries(inSource('id-1', 'src-a')),
        'project:id-1': JSON.stringify(inSource('id-1', 'src-a')),
      });

      await getProjectSummariesForSource(token, 'src-a');

      expect(__mockReadUserData.mock.calls.map(([, key]) => key)).toEqual(['projectSummaries']);
    });

    it('returns an empty array when no projects match the source', async () => {
      mockStore({ projectSummaries: storedSummaries(inSource('id-1', 'src-b')) });

      await expect(getProjectSummariesForSource(token, 'src-a')).resolves.toEqual([]);
    });

    it('propagates corrupt summaries rather than listing nothing', async () => {
      mockStore({ projectSummaries: JSON.stringify([]) });

      await expect(getProjectSummariesForSource(token, 'src-a')).rejects.toThrow('is corrupt');
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
        return Promise.resolve(storedSummaries());
      });
      __mockWriteUserData.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_t: unknown, key: unknown, _v: unknown): Promise<void> => {
          if (key === 'projectSummaries') ops.push('write:index');
          return Promise.resolve();
        },
      );

      jest
        .spyOn(crypto, 'randomUUID')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000002');

      const p1 = createProject(token, 'src', ['en']);
      const p2 = createProject(token, 'src', ['en']);

      resolveFirstIndexRead(storedSummaries());

      await Promise.all([p1, p2]);

      expect(ops).toEqual(['read:1', 'write:index', 'read:2', 'write:index']);
    });
  });

  describe('error propagation', () => {
    it('propagates non-ENOENT errors from reading the summaries', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(createProject(token, 'src', ['en'])).rejects.toThrow('disk full');
    });

    it('propagates non-ENOENT errors from getProject', async () => {
      __mockReadUserData.mockRejectedValue(new Error('disk full'));

      await expect(getProject(token, 'abc')).rejects.toThrow('disk full');
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

  describe('saving the draft into a project', () => {
    const SAVE_TIME = '2026-03-01T12:00:00.000Z';
    const SEGMENTATION = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

    /** Backs storage with a map, so a draft saved here can be read back by the copy. */
    function backStorageWithMap(): Map<string, string> {
      const stored = new Map<string, string>();
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key !== 'string' || !stored.has(key)) throw enoentError();
        return stored.get(key);
      });
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key === 'string') stored.delete(key);
      });
      return stored;
    }

    /** Stores `project`'s record in `stored` and lists it, as creating it would. */
    function storeListedProject(stored: Map<string, string>, project: InterlinearProject): void {
      stored.set(`project:${project.id}`, JSON.stringify(project));
      stored.set('projectSummaries', storedSummaries(project));
    }

    /** Reads project `id` back from `stored`. */
    function storedProject(stored: Map<string, string>, id: string): unknown {
      const raw = stored.get(`project:${id}`);
      return raw === undefined ? undefined : JSON.parse(raw);
    }

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date(SAVE_TIME));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('saveDraftToProject', () => {
      it("copies the stored draft's analysis and boundaries into the project, keeping its metadata", async () => {
        const stored = backStorageWithMap();
        const project = {
          ...makeStubProject('proj-id'),
          name: 'Kept',
          sourceProjectId: 'src-proj',
        };
        storeListedProject(stored, project);
        const draft = { ...makeDraftSpanningBooks('src-proj', 'GEN'), segmentation: SEGMENTATION };
        await saveDraft(token, 'src-proj', draft);

        const result = await saveDraftToProject(token, 'src-proj', 'proj-id');

        const expected = {
          ...project,
          analysis: draft.analysis,
          segmentation: SEGMENTATION,
          updatedAt: SAVE_TIME,
        };
        expect(result).toEqual(expected);
        expect(storedProject(stored, 'proj-id')).toEqual(expected);
      });

      it('clears the boundaries the project stored when the draft has none', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, { ...makeStubProject('proj-id'), segmentation: SEGMENTATION });
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect(storedProject(stored, 'proj-id')).not.toHaveProperty('segmentation');
      });

      it('sets the analysis languages and target in the same write when config is given', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        await saveDraftToProject(token, 'src-proj', 'proj-id', {
          analysisLanguages: ['sw', 'fr'],
          targetProjectId: 'tgt-9',
        });

        expect(
          __mockWriteUserData.mock.calls.filter(([, key]) => key === 'project:proj-id'),
        ).toHaveLength(1);
        expect(storedProject(stored, 'proj-id')).toMatchObject({
          analysisLanguages: ['sw', 'fr'],
          targetProjectId: 'tgt-9',
        });
      });

      it('clears the target when the config given has none', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, { ...makeStubProject('proj-id'), targetProjectId: 'tgt-old' });
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        await saveDraftToProject(token, 'src-proj', 'proj-id', { analysisLanguages: ['en'] });

        expect(storedProject(stored, 'proj-id')).not.toHaveProperty('targetProjectId');
      });

      it('leaves the configuration unchanged when no config is given', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, {
          ...makeStubProject('proj-id'),
          analysisLanguages: ['de'],
          targetProjectId: 'tgt-old',
        });
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect(storedProject(stored, 'proj-id')).toMatchObject({
          analysisLanguages: ['de'],
          targetProjectId: 'tgt-old',
        });
      });

      it('copies a draft write queued before it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');

        // Neither call is awaited before the next starts, as when a WebView's last autosave and its
        // Save cross the bus back to back.
        const write = saveDraft(token, 'src-proj', draft);
        const result = await saveDraftToProject(token, 'src-proj', 'proj-id');
        await write;

        expect(result?.analysis).toEqual(draft.analysis);
      });

      /** Storage holding project `proj-id` with GEN and JHN, and a draft whose JHN is damaged. */
      async function damagedJhn() {
        const stored = backStorageWithMap();
        const project = {
          ...makeStubProject('proj-id'),
          analysis: makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis,
        };
        storeListedProject(stored, project);
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');
        const { draft: loaded } = await getDraft(token, 'src-proj');
        return { stored, project, loaded };
      }

      it('refuses the copy while a book of the draft cannot be read, leaving the project untouched', async () => {
        const { stored, project } = await damagedJhn();

        const refusal = saveDraftToProject(token, 'src-proj', 'proj-id');

        await expect(refusal).rejects.toThrow(UnreadableBooksError);
        await expect(refusal).rejects.toMatchObject({ books: ['JHN'] });
        expect(storedProject(stored, 'proj-id')).toEqual(project);
      });

      it('keeps refusing after discarding all changes, since the damaged book is still stored', async () => {
        const { stored, project, loaded } = await damagedJhn();
        await saveDraft(token, 'src-proj', { ...loaded, analysis: emptyAnalysis() });

        await expect(saveDraftToProject(token, 'src-proj', 'proj-id')).rejects.toThrow(
          UnreadableBooksError,
        );
        expect(storedProject(stored, 'proj-id')).toEqual(project);
      });

      it('leaves the damaged book out of a draft write carrying analysis for it', async () => {
        const { stored, loaded } = await damagedJhn();

        await expect(
          saveDraft(token, 'src-proj', {
            ...loaded,
            analysis: makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis,
          }),
        ).resolves.toEqual(['JHN']);
        expect(stored.get('draft:src-proj:analysis:JHN')).toBe('{not json');
      });

      it('keeps refusing the copy after an edit in the damaged book, so the edit cannot hide it', async () => {
        const { stored, project, loaded } = await damagedJhn();
        await saveDraft(token, 'src-proj', {
          ...loaded,
          analysis: makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis,
        });

        await expect(saveDraftToProject(token, 'src-proj', 'proj-id')).rejects.toThrow(
          UnreadableBooksError,
        );
        expect(storedProject(stored, 'proj-id')).toEqual(project);
      });

      it('saves again once the draft is started over from the project', async () => {
        const { project } = await damagedJhn();
        await saveDraft(
          token,
          'src-proj',
          { ...emptyDraft('src-proj'), analysis: project.analysis },
          { discardUnreadable: true },
        );

        const result = await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect(result?.analysis).toEqual(project.analysis);
      });

      it('rejects, writing no project, when the stored draft itself is unreadable', async () => {
        const stored = backStorageWithMap();
        const project = makeStubProject('proj-id');
        storeListedProject(stored, project);
        stored.set('draft:src-proj', JSON.stringify({ nope: true }));

        await expect(saveDraftToProject(token, 'src-proj', 'proj-id')).rejects.toThrow(
          'failed validation',
        );
        expect(storedProject(stored, 'proj-id')).toEqual(project);
      });

      it('marks a draft left from an earlier session clean once the project holds it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        stored.set(
          'draft:src-proj',
          JSON.stringify({ ...makeDraftSpanningBooks('src-proj', 'GEN'), dirty: true }),
        );

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('marks the stored draft clean once the project holds it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('leaves the stored draft dirty when a draft write was sent after the copy read it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });
        const later = { ...makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'), dirty: true };

        // The later write is sent while the copy is in flight, behind its read.
        const save = saveDraftToProject(token, 'src-proj', 'proj-id');
        const write = saveDraft(token, 'src-proj', later);
        await Promise.all([save, write]);

        expect((await getDraft(token, 'src-proj')).draft).toMatchObject({
          dirty: true,
          analysis: later.analysis,
        });
      });

      it('leaves the stored draft dirty when changes were applied after the copy read it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        const save = saveDraftToProject(token, 'src-proj', 'proj-id');
        const apply = openDraftRepository(token, 'src-proj').apply({
          intent: 'deleteLink',
          tokenAnalysisLinks: { puts: [], deletes: ['link-GEN'] },
        });
        await Promise.all([save, apply]);

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });

      it('does not mark the draft clean when the project is gone', async () => {
        backStorageWithMap();
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftToProject(token, 'src-proj', 'missing');

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });

      it('logs a failure to mark the draft clean and still reports the save', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });
        const failure = new Error('disk full');
        __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
          if (key === 'draft:src-proj') throw failure;
          if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
        });

        const result = await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect(result?.id).toBe('proj-id');
        expect(__mockLogger.warn).toHaveBeenCalledWith(
          'Interlinearizer: could not mark the draft of src-proj clean after saving it:',
          failure,
        );
      });

      it('returns undefined and writes no project when the project does not exist', async () => {
        const stored = backStorageWithMap();
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        const result = await saveDraftToProject(token, 'src-proj', 'missing');

        expect(result).toBeUndefined();
        expect(stored.has('project:missing')).toBe(false);
      });
    });

    describe('saveDraftAsNewProject', () => {
      it("creates an indexed project holding the stored draft's analysis and boundaries", async () => {
        const stored = backStorageWithMap();
        const draft = { ...makeDraftSpanningBooks('src-proj', 'GEN'), segmentation: SEGMENTATION };
        await saveDraft(token, 'src-proj', draft);

        const result = await saveDraftAsNewProject(
          token,
          'src-proj',
          ['fr'],
          'tgt-proj',
          'Name',
          'Desc',
        );

        const expected = {
          id: '00000000-0000-0000-0000-000000000001',
          modelVersion: CURRENT_MODEL_VERSION,
          createdAt: SAVE_TIME,
          updatedAt: SAVE_TIME,
          name: 'Name',
          description: 'Desc',
          sourceProjectId: 'src-proj',
          targetProjectId: 'tgt-proj',
          analysisLanguages: ['fr'],
          analysis: draft.analysis,
          segmentation: SEGMENTATION,
          links: [],
        };
        expect(result).toEqual({ project: expected, omittedBooks: [] });
        expect(storedProject(stored, expected.id)).toEqual(expected);
        expect(JSON.parse(stored.get('projectSummaries') ?? '{}').summaries).toEqual([
          summarizeProject(expected),
        ]);
      });

      it('stores no boundaries when the draft has none', async () => {
        backStorageWithMap();
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        const { project } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(project).not.toHaveProperty('segmentation');
      });

      it('leaves out a book the draft cannot read, and names it', async () => {
        const stored = backStorageWithMap();
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');

        const { project, omittedBooks } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(omittedBooks).toEqual(['JHN']);
        expect(project.analysis.tokenAnalysisLinks.map(({ id }) => id)).toEqual(['link-GEN']);
      });

      it('keeps the edits elsewhere of a draft that also carries edits for a book it cannot read', async () => {
        const stored = backStorageWithMap();
        await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');
        const { draft: loaded } = await getDraft(token, 'src-proj');
        await saveDraft(token, 'src-proj', {
          ...loaded,
          analysis: makeDraftSpanningBooks('src-proj', 'GEN', 'JHN', 'MRK').analysis,
        });

        const { project, omittedBooks } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(omittedBooks).toEqual(['JHN']);
        expect(project.analysis.tokenAnalysisLinks.map(({ id }) => id).sort()).toEqual([
          'link-GEN',
          'link-MRK',
        ]);
      });

      it('leaves out the boundaries of a book the draft cannot read', async () => {
        const stored = backStorageWithMap();
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'),
          segmentation: { removedVerseStarts: ['GEN 1:2:0', 'JHN 1:2:0'], addedStarts: [] },
        });
        stored.set('draft:src-proj:analysis:JHN', '{not json');

        const { project } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(project.segmentation).toEqual({
          removedVerseStarts: ['GEN 1:2:0'],
          addedStarts: [],
        });
      });

      it('marks the stored draft clean once the project is created', async () => {
        backStorageWithMap();
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('leaves the stored draft dirty when a book was left out', async () => {
        const stored = backStorageWithMap();
        await saveDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'),
          dirty: true,
        });
        stored.set('draft:src-proj:analysis:JHN', '{not json');

        await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect((await getDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });

      it('reports an invariant violation the stored draft carries', async () => {
        backStorageWithMap();
        await saveDraft(token, 'src-proj', {
          ...emptyDraft('src-proj'),
          analysis: analysisWithDanglingLink(),
        });

        await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(__mockLogger.warn).toHaveBeenCalledWith(
          'Interlinearizer: draft of src-proj on save as has 1 token-layer danglingLink violation(s): GEN 1:1:0',
        );
      });
    });
  });

  describe('getDraft', () => {
    it('returns the parsed stored draft read from the draft key', async () => {
      const stored = { ...emptyDraft('src-proj'), analysisLanguages: ['fr'], dirty: true };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const { draft: result } = await getDraft(token, 'src-proj');

      expect(result).toEqual(stored);
      expect(__mockReadUserData).toHaveBeenCalledWith(token, 'draft:src-proj');
    });

    it('reports an invariant violation the stored draft analysis carries', async () => {
      const stored = { ...emptyDraft('src-proj'), analysis: analysisWithDanglingLink() };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      await getDraft(token, 'src-proj');

      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: draft for source project src-proj on load has 1 token-layer danglingLink violation(s): GEN 1:1:0',
      );
    });

    it('returns a draft that violates an invariant rather than resetting it', async () => {
      const stored = { ...emptyDraft('src-proj'), analysis: analysisWithDanglingLink() };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const { draft: result } = await getDraft(token, 'src-proj');

      expect(result).toEqual(stored);
    });

    it('discards a stored draft that carries no model version', async () => {
      const unversioned: Record<string, unknown> = { ...emptyDraft('src-proj') };
      delete unversioned.modelVersion;
      __mockReadUserData.mockResolvedValue(JSON.stringify(unversioned));

      const { draft: result } = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: stored draft failed validation; resetting to empty draft',
      );
    });

    it('discards a stored draft whose model version is not a number', async () => {
      const stored = { ...emptyDraft('src-proj'), modelVersion: 'one' };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const { draft: result } = await getDraft(token, 'src-proj');

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

      expect((await getDraft(token, 'src-proj')).draft).toEqual(legacy);
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

      const { draft: loaded } = await getDraft(token, 'src-proj');

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

      const { draft: loaded } = await getDraft(token, 'src-proj');

      expect(loaded.analysis.tokenAnalysisLinks).toHaveLength(1);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: analysis shard draft:src-proj:analysis:JHN is not valid JSON; treating as empty',
      );
    });

    it('loads a book whose shard holds a link with no id as empty, and logs it', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      const [, jhn] = draft.analysis.tokenAnalysisLinks;
      const oldShard = withoutLinkIds({ ...emptyAnalysis(), tokenAnalysisLinks: [jhn] });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return JSON.stringify(oldShard);
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      const { draft: loaded } = await getDraft(token, 'src-proj');

      expect(loaded.analysis.tokenAnalysisLinks.map((l) => l.token.tokenRef)).toEqual([
        'GEN 1:1!0',
      ]);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: analysis shard draft:src-proj:analysis:JHN has links without ids; treating as empty',
      );
    });

    it('loads a draft whose inline analysis holds a link with no id as empty, and logs it', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      const stored = { ...draft, dirty: true, analysis: withoutLinkIds(draft.analysis) };
      __mockReadUserData.mockResolvedValue(JSON.stringify(stored));

      const { draft: result } = await getDraft(token, 'src-proj');

      expect(result).toEqual(emptyDraft('src-proj'));
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: draft for source project src-proj has links without ids; loading it empty',
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

      const { draft: loaded } = await getDraft(token, 'src-proj');

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

      expect((await getDraft(token, 'src-proj')).draft).toEqual(legacy);
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

      const { draft: result } = await getDraft(token, 'src-proj');

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

      const { draft: result } = await getDraft(token, 'src-proj');

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

      expect((await getDraft(token, 'src-proj')).draft).toEqual(draft);
    });

    it('keeps a stored phrase whose tokens lie within one book', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'EXO');
      draft.analysis.phraseAnalyses.push({
        id: 'phrase-1',
        ...FIXTURE_STAMPS,
        surfaceText: 'in the',
        gloss: { en: 'within' },
      });
      draft.analysis.phraseAnalysisLinks.push(
        makePhraseLink('phrase-1', ['GEN 1:1!0', 'GEN 1:1!3']),
      );

      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });

      expect((await getDraft(token, 'src-proj')).draft).toEqual(draft);
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
          id: `tl-${book}`,
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

      const { draft: loaded } = await getDraft(token, 'src-proj');
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

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
    });

    it('saves past a shard delete failure that is not a missing key, logging it', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      const failure = new Error('permission denied');
      __mockDeleteUserData.mockRejectedValue(failure);

      draft.analysis = removeBookFromAnalysis(draft.analysis, 'JHN');

      // The draft landed, so the save is no failure: a caller taking it for one would resend the
      // same draft for nothing.
      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not delete the orphaned analysis shards JHN of src-proj; a later save retries:',
        failure,
      );
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
      const { draft: reopened } = await getDraft(token, 'src-proj');
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

      const { draft: reopened } = await getDraft(token, 'src-proj');
      expect(reopened.analysis.tokenAnalyses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'analysis-JHN', gloss: { en: 'gloss-JHN' } }),
        ]),
      );
    });

    it('keeps naming a journaled book whose stranded shard landed unusable, across a restart', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      await saveDraft(token, 'src-proj', draft);
      const stored = new Map<string, string>();
      __mockWriteUserData.mock.calls.forEach(([, key, json]) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key !== 'string' || !stored.has(key)) throw enoentError();
        return stored.get(key);
      });
      // JHN's shard lands torn rather than whole, so the envelope that would have named it fails
      // after the only record of the shard is the journal.
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (key === 'draft:src-proj') throw new Error('envelope write failed');
        if (key === 'draft:src-proj:analysis:JHN') stored.set(key, '{not json');
        else if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });

      draft.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('envelope write failed');

      // Stands in for an extension-host restart, leaving the journal as the shard's only name.
      resetQueuesForTesting();
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });

      // The reopened draft has lost JHN's unreadable content, so an ordinary save no longer carries
      // the book; only the manifest can keep its shard reachable.
      await saveDraft(token, 'src-proj', (await getDraft(token, 'src-proj')).draft);

      expect(JSON.parse(stored.get('draft:src-proj') ?? '{}').analysisBooks).toEqual(
        expect.arrayContaining(['GEN', 'JHN']),
      );
      expect(stored.has('draft:src-proj:analysis:JHN')).toBe(true);
    });

    it('deletes a journaled shard a later save drops, across a restart', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      await saveDraft(token, 'src-proj', draft);
      const stored = new Map<string, string>();
      __mockWriteUserData.mock.calls.forEach(([, key, json]) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key !== 'string' || !stored.has(key)) throw enoentError();
        return stored.get(key);
      });
      __mockDeleteUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (typeof key === 'string') stored.delete(key);
      });
      // JHN's shard lands, then the envelope that would have named it fails, leaving the journal as
      // the shard's only name.
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (key === 'draft:src-proj') throw new Error('envelope write failed');
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });

      draft.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await expect(saveDraft(token, 'src-proj', draft)).rejects.toThrow('envelope write failed');
      expect(stored.has('draft:src-proj:analysis:JHN')).toBe(true);

      // Stands in for an extension-host restart. This save never loads the draft, so nothing but the
      // journal can name JHN before the save replaces it.
      resetQueuesForTesting();
      __mockWriteUserData.mockImplementation(async (_t: unknown, key: unknown, json: unknown) => {
        if (typeof key === 'string' && typeof json === 'string') stored.set(key, json);
      });

      await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

      expect(stored.has('draft:src-proj:analysis:JHN')).toBe(false);
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
      await saveDraft(token, 'src-proj', draft);
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

    it('logs the shard deletion failure and a journal cleanup that also failed, and saves', async () => {
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

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not delete the orphaned analysis shards JHN of src-proj; a later save retries:',
        expect.any(Error),
      );
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not update the shard journal for src-proj:',
        expect.any(Error),
      );
    });

    it('saves past a journal cleanup failure once the content has landed, logging it', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN');
      __mockReadUserData.mockRejectedValue(enoentError());
      const failure = new Error('journal delete failed');
      __mockDeleteUserData.mockRejectedValue(failure);

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
      expect(__mockWriteUserData).toHaveBeenCalledWith(
        token,
        'draft:src-proj',
        expect.stringContaining('"analysisBooks":["GEN"]'),
      );
      expect(__mockLogger.warn).toHaveBeenCalledWith(
        'Interlinearizer: could not update the shard journal for src-proj:',
        failure,
      );
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

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
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

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
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

      await expect(saveDraft(token, 'src-proj', draft)).resolves.toEqual([]);
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

      await saveDraft(token, 'src-proj', (await getDraft(token, 'src-proj')).draft);

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

      await saveDraft(token, 'src-proj', (await getDraft(token, 'src-proj')).draft);

      const [, , json] = __mockWriteUserData.mock.calls.findLast(([, k]) => k === 'draft:src-proj');
      expect(typeof json === 'string' && JSON.parse(json).analysisBooks).toEqual(
        expect.arrayContaining(['GEN', 'JHN']),
      );
    });

    it("rewrites an unreadable book's shard once a started-over draft has analyses for it", async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const { draft: loaded } = await getDraft(token, 'src-proj');
      __mockWriteUserData.mockClear();

      loaded.analysis = makeDraftSpanningBooks('src-proj', 'JHN').analysis;
      await saveDraft(token, 'src-proj', loaded, { discardUnreadable: true });

      expect(writtenKeys()).toContain('draft:src-proj:analysis:JHN');
    });

    it('wipes a book that a started-over draft restored from an unreadable shard', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const { draft: loaded } = await getDraft(token, 'src-proj');
      loaded.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await saveDraft(token, 'src-proj', loaded, { discardUnreadable: true });

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
      const { draft: loaded } = await getDraft(token, 'src-proj');
      __mockDeleteUserData.mockRejectedValue(new Error('permission denied'));

      loaded.analysis = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN').analysis;
      await saveDraft(token, 'src-proj', loaded, { discardUnreadable: true });

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
      await saveDraft(token, 'src-proj', draft);

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

    it('never writes the project summaries', async () => {
      await saveDraft(token, 'src-proj', emptyDraft('src-proj'));

      expect(writtenKeys()).not.toContain('projectSummaries');
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

        const { draft: loaded } = await getDraft(token, 'src-proj');

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

  describe('openDraftRepository', () => {
    beforeEach(() => writeThroughStore());

    it('is writable', () => {
      expect(openDraftRepository(token, 'src-proj').capabilities.readOnly).toBe(false);
    });

    it('loads and saves the draft getDraft and saveDraft reach', async () => {
      const repository = openDraftRepository(token, 'src-proj');
      const saved = makeDraftSpanningBooks('src-proj', 'GEN');
      const savedElsewhere = makeDraftSpanningBooks('src-proj', 'JHN');

      await repository.replaceAll(saved);
      await expect(getDraft(token, 'src-proj')).resolves.toEqual({
        draft: saved,
        unreadableBooks: [],
      });
      await saveDraft(token, 'src-proj', savedElsewhere);
      await expect(repository.exportAll()).resolves.toEqual({
        draft: savedElsewhere,
        unreadableBooks: [],
      });
    });

    it('loads the draft for copying and marks it clean', async () => {
      const repository = openDraftRepository(token, 'src-proj');
      const saved = { ...makeDraftSpanningBooks('src-proj', 'GEN'), dirty: true };
      await repository.replaceAll(saved);

      await expect(repository.exportForCopy()).resolves.toEqual({
        draft: saved,
        unreadableBooks: [],
      });
      await repository.markClean();
      await expect(repository.exportAll()).resolves.toMatchObject({ draft: { dirty: false } });
    });

    it('shares what saveDraft knows of storage, rewriting only the edited book', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockClear();

      draft.analysis.tokenAnalysisLinks[0].token.surfaceText = 'edited';
      await openDraftRepository(token, 'src-proj').replaceAll(draft);

      expect(writtenKeys()).toContain('draft:src-proj:analysis:GEN');
      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:JHN');
    });

    it('applies changes to the draft saveDraft saved', async () => {
      await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

      await openDraftRepository(token, 'src-proj').apply({
        intent: 'deleteLink',
        tokenAnalysisLinks: { puts: [], deletes: ['link-GEN'] },
      });

      const {
        draft: { analysis },
      } = await getDraft(token, 'src-proj');
      expect(analysis.tokenAnalysisLinks).toStrictEqual([]);
    });

    it.each([
      ['getTokenAnalyses', (r: AnalysisRepository) => r.getTokenAnalyses(['analysis-GEN']), 1],
      ['getPhraseAnalyses', (r: AnalysisRepository) => r.getPhraseAnalyses(['p']), 0],
      ['getSegmentAnalyses', (r: AnalysisRepository) => r.getSegmentAnalyses(['s']), 0],
      ['getPhraseAnalysisLinks', (r: AnalysisRepository) => r.getPhraseAnalysisLinks(['p']), 0],
      ['findLinksBySegment', (r: AnalysisRepository) => r.findLinksBySegment(['GEN 1:1']), 0],
      [
        'findLinksByToken',
        (r: AnalysisRepository) =>
          r.findLinksByToken(['GEN 1:1!0']).then((l) => l.tokenAnalysisLinks),
        1,
      ],
      [
        'findLinksToAnalyses',
        (r: AnalysisRepository) =>
          r.findLinksToAnalyses(['analysis-GEN']).then((l) => l.tokenAnalysisLinks),
        1,
      ],
      [
        'findLinksInBooks',
        (r: AnalysisRepository) =>
          r.findLinksInBooks(['GEN'], ['approved']).then((l) => l.tokenAnalysisLinks),
        1,
      ],
      [
        'findTokenAnalysesByForm',
        (r: AnalysisRepository) => r.findTokenAnalysesByForm(['word-gen']),
        1,
      ],
      ['findPhraseAnalysesByForm', (r: AnalysisRepository) => r.findPhraseAnalysesByForm(['x']), 0],
      ['checkIndexes', (r: AnalysisRepository) => r.checkIndexes(), 0],
      [
        'getScope',
        (r: AnalysisRepository) => r.getScope().then(({ analysisLanguages }) => analysisLanguages),
        0,
      ],
    ])('answers %s from the draft saveDraft saved', async (_name, lookup, count) => {
      await saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

      await expect(lookup(openDraftRepository(token, 'src-proj'))).resolves.toHaveLength(count);
    });

    it('waits for a draft call already made before reading', async () => {
      let finishWrite: () => void = () => {};
      __mockWriteUserData.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      );
      const saving = saveDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      const draftReads = () =>
        __mockReadUserData.mock.calls.filter(([, key]) => key === 'draft:src-proj').length;
      const readsBefore = draftReads();

      const loading = openDraftRepository(token, 'src-proj').exportAll();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(draftReads()).toBe(readsBefore);
      finishWrite();
      await saving;
      await loading;
      expect(draftReads()).toBeGreaterThan(readsBefore);
    });
  });

  describe('releaseDraftRepository', () => {
    beforeEach(() => writeThroughStore());

    it("keeps a shard the released repository's load could not use", async () => {
      writeThroughStore({
        'draft:src-proj': JSON.stringify({
          ...emptyDraft('src-proj'),
          modelVersion: CURRENT_MODEL_VERSION,
          analysisBooks: ['GEN'],
        }),
        'draft:src-proj:analysis:GEN': 'not json',
      });
      const { draft } = await getDraft(token, 'src-proj');

      await releaseDraftRepository('src-proj');
      await saveDraft(token, 'src-proj', draft);

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'draft:src-proj:analysis:GEN');
    });

    it('lets a draft call already made finish on the repository it releases', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await saveDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockClear();

      draft.analysis.tokenAnalysisLinks[0].token.surfaceText = 'edited';
      await Promise.all([saveDraft(token, 'src-proj', draft), releaseDraftRepository('src-proj')]);

      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:JHN');
    });
  });

  describe('openPt9ImportRepository', () => {
    it("loads the stored import's analysis, refusing writes", async () => {
      const imported: InterlinearProject = {
        ...makeStubProject('import-id'),
        analysis: makeDraftSpanningBooks('src-project', 'GEN').analysis,
        pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
      };
      mockListedProject(imported);
      const repository = openPt9ImportRepository(token, 'import-id');

      expect(repository.capabilities.readOnly).toBe(true);
      await expect(repository.exportAll()).resolves.toMatchObject({
        draft: { sourceProjectId: 'src-project', analysis: imported.analysis },
      });
      await expect(repository.replaceAll(emptyDraft('src-project'))).rejects.toThrow(
        ReadOnlyAnalysisError,
      );
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

    describe('freeze guard', () => {
      it('rejects updateAnalysis without writing', async () => {
        mockStore({ 'project:import-id': JSON.stringify(importedProject) });

        await expect(updateAnalysis(token, 'import-id', emptyAnalysis())).rejects.toThrow(
          'Paratext 9 import and is read-only',
        );
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });

      it('rejects updateProjectMetadata without writing', async () => {
        mockStore({ 'project:import-id': JSON.stringify(importedProject) });

        await expect(
          updateProjectMetadata(token, 'import-id', 'new name', undefined, ['en']),
        ).rejects.toThrow('Paratext 9 import and is read-only');
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });

      it('still allows deleteProject', async () => {
        mockStore({
          'project:import-id': JSON.stringify(importedProject),
          projectSummaries: storedSummaries(importedProject),
        });

        await deleteProject(token, 'import-id');

        expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'project:import-id');
      });
    });

    describe('getPt9ImportForSource', () => {
      it('returns the import among the source projects', async () => {
        mockStore({
          projectSummaries: storedSummaries(makeStubProject('plain-id'), importedProject),
          'project:plain-id': JSON.stringify(makeStubProject('plain-id')),
          'project:import-id': JSON.stringify(importedProject),
        });

        const result = await getPt9ImportForSource(token, 'src-project');

        expect(result?.id).toBe('import-id');
      });

      it('returns undefined when no source project carries pt9Import', async () => {
        mockStore({
          projectSummaries: storedSummaries(makeStubProject('plain-id')),
          'project:plain-id': JSON.stringify(makeStubProject('plain-id')),
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

      it('creates the import and lists it when the source has none', async () => {
        mockStore({});

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
        expect(writtenSummaryIds()).toEqual(['00000000-0000-0000-0000-000000000001']);
      });

      it('reports an invariant violation the imported analysis carries', async () => {
        mockStore({});

        await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          analysisWithDanglingLink(),
          NEW_PROVENANCE,
        );

        expect(__mockLogger.warn).toHaveBeenCalledWith(
          'Interlinearizer: Paratext 9 import of src-project on save has 1 token-layer danglingLink violation(s): GEN 1:1:0',
        );
      });

      it('replaces the existing import wholesale, keeping only id and createdAt', async () => {
        mockStore({
          projectSummaries: storedSummaries(importedProject),
          'project:import-id': JSON.stringify({
            ...importedProject,
            targetProjectId: 'stray-target',
          }),
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
        expect(writtenKeys()).toEqual(['project:import-id', 'projectSummaries']);
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

      it('makes a repository already opened over the import answer from the new one', async () => {
        writeThroughStore({
          projectSummaries: storedSummaries(importedProject),
          'project:import-id': JSON.stringify(importedProject),
        });
        const repository = openPt9ImportRepository(token, 'import-id');
        await repository.getTokenAnalyses(['pt9:ta:GEN 1:1:0:0']);

        await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        await expect(repository.getTokenAnalyses(['pt9:ta:GEN 1:1:0:0'])).resolves.toStrictEqual(
          newAnalysis.tokenAnalyses,
        );
      });

      it("brings the import's listed summary up to date", async () => {
        mockStore({
          projectSummaries: storedSummaries(importedProject),
          'project:import-id': JSON.stringify(importedProject),
        });

        await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        expect(writtenSummaries()).toEqual([
          expect.objectContaining({
            id: 'import-id',
            name: 'Paratext 9 Interlinear',
            tokenAnalysisCount: 1,
            pt9Import: NEW_PROVENANCE,
          }),
        ]);
      });

      it('creates a fresh record when the import is deleted between lookup and write', async () => {
        // Still listed, but its record is gone by the time the replace reads it.
        mockStore({ projectSummaries: storedSummaries(importedProject) });

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

      it('unlists an import whose record is missing', async () => {
        writeThroughStore({ projectSummaries: storedSummaries(importedProject) });

        await savePt9Import(
          token,
          'src-project',
          'Paratext 9 Interlinear',
          'Imported from Paratext 9.',
          ['en'],
          newAnalysis,
          NEW_PROVENANCE,
        );

        expect(writtenSummaryIds()).toEqual(['00000000-0000-0000-0000-000000000001']);
      });

      it('replaces the import it created in place of one whose record was missing', async () => {
        writeThroughStore({ projectSummaries: storedSummaries(importedProject) });
        const sync = () =>
          savePt9Import(
            token,
            'src-project',
            'Paratext 9 Interlinear',
            'Imported from Paratext 9.',
            ['en'],
            newAnalysis,
            NEW_PROVENANCE,
          );

        const created = await sync();
        const replaced = await sync();

        expect(replaced.id).toBe(created.id);
        expect(writtenSummaryIds()).toEqual([created.id]);
      });

      it('creates a fresh import when the existing one is unlisted between lookup and write', async () => {
        // Listed at lookup only; its record outlives the deletion that unlisted it.
        const summaryReads = [storedSummaries(importedProject)];
        __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
          if (key === 'project:import-id') return JSON.stringify(importedProject);
          const listed = key === 'projectSummaries' ? summaryReads.shift() : undefined;
          if (listed === undefined) throw enoentError();
          return listed;
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
      });
    });

    describe('createEditableCopy', () => {
      it('creates an editable project carrying the analysis and no pt9Import', async () => {
        mockStore({
          projectSummaries: storedSummaries(importedProject),
          'project:import-id': JSON.stringify(importedProject),
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
        expect(writtenSummaryIds()).toEqual(['import-id', '00000000-0000-0000-0000-000000000001']);
      });

      it('omits the description when none is given', async () => {
        mockStore({
          projectSummaries: storedSummaries(importedProject),
          'project:import-id': JSON.stringify(importedProject),
        });

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
        mockStore({ 'project:plain-id': JSON.stringify(makeStubProject('plain-id')) });

        await expect(createEditableCopy(token, 'plain-id', 'My Copy')).rejects.toThrow(
          'not a Paratext 9 import',
        );
        expect(__mockWriteUserData).not.toHaveBeenCalled();
      });
    });

    describe('through save and reload', () => {
      const IMPORTED: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'pt9:ta:GEN 1:1:0:0', surfaceText: 'In', gloss: { en: 'in' } },
        ],
        tokenAnalysisLinks: [
          {
            ...FIXTURE_STAMPS,
            id: 'pt9:tl:GEN 1:1:0:0',
            analysisId: 'pt9:ta:GEN 1:1:0:0',
            status: 'approved',
            token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
          },
        ],
      };

      /** Imports {@link IMPORTED} and makes an editable copy of it. */
      async function importAndCopy() {
        writeThroughStore();
        jest
          .spyOn(crypto, 'randomUUID')
          .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
          .mockReturnValueOnce('00000000-0000-0000-0000-000000000002');
        const imported = await savePt9Import(
          token,
          'src-project',
          'Import',
          'Imported',
          ['en'],
          IMPORTED,
          PT9_PROVENANCE,
        );
        const copy = await createEditableCopy(token, imported.id, 'Copy');
        return { imported, copy };
      }

      it('reloads a new import with its analysis', async () => {
        const { imported } = await importAndCopy();

        expect((await getProject(token, imported.id))?.analysis).toEqual(IMPORTED);
      });

      it('reloads the editable copy with its analysis after a save', async () => {
        const { copy } = await importAndCopy();

        await updateAnalysis(token, copy.id, IMPORTED);

        expect((await getProject(token, copy.id))?.analysis).toEqual(IMPORTED);
      });

      it('reloads a draft opened from the editable copy with its analysis', async () => {
        const { copy } = await importAndCopy();
        const opened = await getProject(token, copy.id);

        await saveDraft(token, 'src-project', {
          ...emptyDraft('src-project'),
          analysis: opened?.analysis ?? emptyAnalysis(),
        });

        expect((await getDraft(token, 'src-project')).draft.analysis).toEqual(IMPORTED);
      });
    });
  });
});
