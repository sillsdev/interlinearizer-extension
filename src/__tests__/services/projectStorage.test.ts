/// <reference types="jest" />

import papiBackendMock from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { DraftProject, InterlinearProject, TextAnalysis } from 'interlinearizer';
import {
  createEditableCopy,
  createProject,
  deleteProject,
  getProject,
  getProjectSummariesForSource,
  getProjectSummary,
  getPt9ImportForSource,
  getRememberedActiveProject,
  hasDraft,
  openDraftRepository,
  openPt9ImportRepository,
  rememberActiveProject,
  releaseDraftRepository,
  resetQueuesForTesting,
  retagProjectGlosses,
  saveDraftAsNewProject,
  saveDraftToProject,
  savePt9Import,
  startDraftOver,
  sweepPendingCleanup,
  updateAnalysis,
  updateProjectMetadata,
} from '../../services/projectStorage';
import { summarizeProject } from '../../services/projectSummaries';
import type { AnalysisRepository, ChangeSet } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { UnreadableBooksError } from '../../types/analysis-repository';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import {
  createTestActivationContext,
  enoentError,
  FIXTURE_STAMPS,
  makeStubProject,
  seedRepository,
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

/** The changes that put `bookCode`'s analysis and link from {@link makeDraftSpanningBooks}. */
function bookPuts(bookCode: string): ChangeSet {
  const { analysis } = makeDraftSpanningBooks('src-proj', bookCode);
  return {
    intent: 'edit',
    tokenAnalyses: { puts: analysis.tokenAnalyses, deletes: [] },
    tokenAnalysisLinks: { puts: analysis.tokenAnalysisLinks, deletes: [] },
  };
}

/** Applies `changes` to the source's stored draft, as a session edit does. */
function applyToDraft(changes: ChangeSet) {
  return openDraftRepository(token, 'src-proj').apply(changes);
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

/** Stores `draft` as the source's draft, as starting the draft over stores it. */
function storeDraft(executionToken: ExecutionToken, sourceProjectId: string, draft: DraftProject) {
  return startDraftOver(executionToken, sourceProjectId, draft);
}

/** Reads the source's stored draft through its repository. */
function readStoredDraft(executionToken: ExecutionToken, sourceProjectId: string) {
  return openDraftRepository(executionToken, sourceProjectId).exportAll();
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
        expect.objectContaining({ id: 'proj-id', analysisCount: 1, updatedAt: UPDATE_TIME }),
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

  describe('retagProjectGlosses', () => {
    const MOVE_TIME = '2026-03-01T12:00:00.000Z';

    /** A stored project holding one analysis glossed `gloss`. */
    function glossedProject(gloss: Record<string, string>): InterlinearProject {
      const project = makeStubProject('proj-id');
      return {
        ...project,
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'fish', gloss }],
        },
      };
    }

    /** The project record the last write of it held. */
    function writtenProject(): InterlinearProject {
      const writes = __mockWriteUserData.mock.calls.filter(([, key]) => key === 'project:proj-id');
      const json: unknown = writes[writes.length - 1]?.[2];
      if (typeof json !== 'string') throw new Error('Expected a write of the project');
      return JSON.parse(json);
    }

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date(MOVE_TIME));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('writes the project with its glosses moved, and returns what moved', async () => {
      mockListedProject(glossedProject({ fr: 'poisson' }));

      const counts = await retagProjectGlosses(token, 'proj-id', 'fr', 'es');

      expect(counts).toStrictEqual({ words: 1, morphemes: 0, freeTranslations: 0, skipped: 0 });
      expect(writtenProject()).toMatchObject({
        updatedAt: MOVE_TIME,
        analysis: { tokenAnalyses: [{ gloss: { es: 'poisson' } }] },
      });
    });

    it('writes the project when only a free translation moved', async () => {
      const project = makeStubProject('proj-id');
      mockListedProject({
        ...project,
        analysis: {
          ...emptyAnalysis(),
          segmentAnalyses: [
            { ...FIXTURE_STAMPS, id: 'sa-1', surfaceText: 'Fish.', freeTranslation: { fr: 'Un.' } },
          ],
        },
      });

      const counts = await retagProjectGlosses(token, 'proj-id', 'fr', 'es');

      expect(counts).toStrictEqual({ words: 0, morphemes: 0, freeTranslations: 1, skipped: 0 });
      expect(writtenProject()).toMatchObject({
        analysis: { segmentAnalyses: [{ freeTranslation: { es: 'Un.' } }] },
      });
    });

    it("brings the project's listed summary up to date", async () => {
      mockListedProject(glossedProject({ fr: 'poisson' }));

      await retagProjectGlosses(token, 'proj-id', 'fr', 'es');

      expect(writtenSummaries()).toContainEqual(
        expect.objectContaining({ id: 'proj-id', updatedAt: MOVE_TIME }),
      );
    });

    it('writes nothing when no gloss moved', async () => {
      mockListedProject(glossedProject({ fr: 'poisson', es: 'pez' }));

      const counts = await retagProjectGlosses(token, 'proj-id', 'fr', 'es');

      expect(counts).toStrictEqual({ words: 0, morphemes: 0, freeTranslations: 0, skipped: 1 });
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('keeps a save queued before the move', async () => {
      const project = glossedProject({ fr: 'poisson' });
      writeThroughStore({
        'project:proj-id': JSON.stringify(project),
        projectSummaries: storedSummaries(project),
      });
      const saved = updateAnalysis(
        token,
        'proj-id',
        glossedProject({ fr: 'poisson', de: 'Fisch' }).analysis,
      );

      const moved = retagProjectGlosses(token, 'proj-id', 'fr', 'es');
      await saved;
      await moved;

      expect(writtenProject().analysis.tokenAnalyses).toMatchObject([
        { gloss: { es: 'poisson', de: 'Fisch' } },
      ]);
    });

    it('returns undefined when the project does not exist', async () => {
      mockStore({});

      expect(await retagProjectGlosses(token, 'missing', 'fr', 'es')).toBeUndefined();
      expect(__mockWriteUserData).not.toHaveBeenCalled();
    });

    it('refuses a Paratext 9 import', async () => {
      mockListedProject({
        ...glossedProject({ fr: 'poisson' }),
        pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
      });

      await expect(retagProjectGlosses(token, 'proj-id', 'fr', 'es')).rejects.toThrow(
        'is a Paratext 9 import and is read-only',
      );
      expect(__mockWriteUserData).not.toHaveBeenCalled();
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

  describe('getProjectSummary', () => {
    it('returns the summary of the listed project with the id, reading no project record', async () => {
      const project = makeStubProject('id-2');
      mockStore({
        projectSummaries: storedSummaries(makeStubProject('id-1'), project),
        'project:id-2': JSON.stringify(project),
      });

      await expect(getProjectSummary(token, 'id-2')).resolves.toMatchObject({ id: 'id-2' });
      expect(__mockReadUserData.mock.calls.map(([, key]) => key)).toEqual(['projectSummaries']);
    });

    it('returns undefined for a project that is not listed', async () => {
      mockStore({ projectSummaries: storedSummaries(makeStubProject('id-1')) });

      await expect(getProjectSummary(token, 'id-2')).resolves.toBeUndefined();
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

  describe('remembering the active project', () => {
    it('answers the summary of the project remembered for the source', async () => {
      const project = makeStubProject('abc');
      writeThroughStore({ projectSummaries: storedSummaries(project) });

      await rememberActiveProject(token, 'src-project', 'abc');

      await expect(getRememberedActiveProject(token, 'src-project')).resolves.toEqual(
        summarizeProject(project),
      );
    });

    it('answers undefined when nothing is remembered for the source', async () => {
      writeThroughStore({ projectSummaries: storedSummaries(makeStubProject('abc')) });

      await expect(getRememberedActiveProject(token, 'src-project')).resolves.toBeUndefined();
    });

    it('answers undefined when the project remembered is no longer listed for the source', async () => {
      writeThroughStore({
        'activeProject:src-project': 'deleted',
        projectSummaries: storedSummaries(makeStubProject('abc')),
      });

      await expect(getRememberedActiveProject(token, 'src-project')).resolves.toBeUndefined();
    });

    it('forgets the project remembered', async () => {
      await rememberActiveProject(token, 'src-project', undefined);

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'activeProject:src-project');
    });

    it('lands remembers for one source in the order they were made', async () => {
      const landed: (string | undefined)[] = [];
      let releaseFirst = () => {};
      __mockWriteUserData.mockImplementationOnce(
        (_t: unknown, _key: unknown, id: string) =>
          new Promise<void>((resolve) => {
            releaseFirst = () => {
              landed.push(id);
              resolve();
            };
          }),
      );
      __mockDeleteUserData.mockImplementation(async () => {
        landed.push(undefined);
      });

      const first = rememberActiveProject(token, 'src-project', 'abc');
      const second = rememberActiveProject(token, 'src-project', undefined);
      await Promise.resolve();
      releaseFirst();
      await Promise.all([first, second]);

      expect(landed).toEqual(['abc', undefined]);
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
        await storeDraft(token, 'src-proj', draft);

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
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect(storedProject(stored, 'proj-id')).not.toHaveProperty('segmentation');
      });

      it("sets the draft's analysis languages and the target in the same write when config is given", async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          analysisLanguages: ['sw', 'fr'],
        });

        await saveDraftToProject(token, 'src-proj', 'proj-id', { targetProjectId: 'tgt-9' });

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
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          analysisLanguages: ['en'],
        });

        await saveDraftToProject(token, 'src-proj', 'proj-id', {});

        expect(storedProject(stored, 'proj-id')).not.toHaveProperty('targetProjectId');
      });

      it('leaves the configuration unchanged when the draft has no languages', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, {
          ...makeStubProject('proj-id'),
          analysisLanguages: ['de'],
          targetProjectId: 'tgt-old',
        });
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          analysisLanguages: [],
        });

        await saveDraftToProject(token, 'src-proj', 'proj-id', { targetProjectId: 'tgt-9' });

        expect(storedProject(stored, 'proj-id')).toMatchObject({
          analysisLanguages: ['de'],
          targetProjectId: 'tgt-old',
        });
      });

      it('leaves the configuration unchanged when no config is given', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, {
          ...makeStubProject('proj-id'),
          analysisLanguages: ['de'],
          targetProjectId: 'tgt-old',
        });
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

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

        // Neither call is awaited before the next starts, as when a draft write and a Save cross the
        // bus back to back.
        const write = storeDraft(token, 'src-proj', draft);
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
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');
        const { draft: loaded } = await readStoredDraft(token, 'src-proj');
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
        const { stored, project } = await damagedJhn();
        await applyToDraft({
          intent: 'discardAll',
          tokenAnalyses: { puts: [], deletes: ['analysis-GEN'] },
          tokenAnalysisLinks: { puts: [], deletes: ['link-GEN'] },
        });

        await expect(saveDraftToProject(token, 'src-proj', 'proj-id')).rejects.toThrow(
          UnreadableBooksError,
        );
        expect(storedProject(stored, 'proj-id')).toEqual(project);
      });

      it('refuses an edit in the damaged book, keeping the book as stored', async () => {
        const { stored } = await damagedJhn();

        await expect(applyToDraft(bookPuts('JHN'))).rejects.toThrow('refuses changes there');

        expect(stored.get('draft:src-proj:analysis:JHN')).toBe('{not json');
      });

      it('saves again once the draft is started over from the project', async () => {
        const { project } = await damagedJhn();
        await storeDraft(token, 'src-proj', {
          ...emptyDraft('src-proj'),
          analysis: project.analysis,
        });

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

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('marks the stored draft clean once the project holds it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftToProject(token, 'src-proj', 'proj-id');

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('leaves the stored draft dirty when a draft write was sent after the copy read it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });
        const later = { ...makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'), dirty: true };

        // The later write is sent while the copy is in flight, behind its read.
        const save = saveDraftToProject(token, 'src-proj', 'proj-id');
        const write = storeDraft(token, 'src-proj', later);
        await Promise.all([save, write]);

        expect((await readStoredDraft(token, 'src-proj')).draft).toMatchObject({
          dirty: true,
          analysis: later.analysis,
        });
      });

      it('leaves the stored draft dirty when it was started over after the copy read it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });
        const started = { ...emptyDraft('src-proj'), dirty: true };

        const save = saveDraftToProject(token, 'src-proj', 'proj-id');
        const write = startDraftOver(token, 'src-proj', started);
        await Promise.all([save, write]);

        expect((await readStoredDraft(token, 'src-proj')).draft).toMatchObject({ dirty: true });
      });

      it('leaves the stored draft dirty when changes were applied after the copy read it', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        const save = saveDraftToProject(token, 'src-proj', 'proj-id');
        const apply = openDraftRepository(token, 'src-proj').apply({
          intent: 'deleteLink',
          tokenAnalysisLinks: { puts: [], deletes: ['link-GEN'] },
        });
        await Promise.all([save, apply]);

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });

      it('does not mark the draft clean when the project is gone', async () => {
        backStorageWithMap();
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftToProject(token, 'src-proj', 'missing');

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });

      it('logs a failure to mark the draft clean and still reports the save', async () => {
        const stored = backStorageWithMap();
        storeListedProject(stored, makeStubProject('proj-id'));
        await storeDraft(token, 'src-proj', {
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
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        const result = await saveDraftToProject(token, 'src-proj', 'missing');

        expect(result).toBeUndefined();
        expect(stored.has('project:missing')).toBe(false);
      });
    });

    describe('saveDraftAsNewProject', () => {
      it("creates an indexed project holding the stored draft's analysis and boundaries", async () => {
        const stored = backStorageWithMap();
        const draft = { ...makeDraftSpanningBooks('src-proj', 'GEN'), segmentation: SEGMENTATION };
        await storeDraft(token, 'src-proj', draft);

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
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

        const { project } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(project).not.toHaveProperty('segmentation');
      });

      it('leaves out a book the draft cannot read, and names it', async () => {
        const stored = backStorageWithMap();
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');

        const { project, omittedBooks } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(omittedBooks).toEqual(['JHN']);
        expect(project.analysis.tokenAnalysisLinks.map(({ id }) => id)).toEqual(['link-GEN']);
      });

      it('keeps the edits elsewhere of a draft that also carries edits for a book it cannot read', async () => {
        const stored = backStorageWithMap();
        await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
        stored.set('draft:src-proj:analysis:JHN', '{not json');
        await applyToDraft(bookPuts('MRK'));

        const { project, omittedBooks } = await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect(omittedBooks).toEqual(['JHN']);
        expect(project.analysis.tokenAnalysisLinks.map(({ id }) => id).sort()).toEqual([
          'link-GEN',
          'link-MRK',
        ]);
      });

      it('leaves out the boundaries of a book the draft cannot read', async () => {
        const stored = backStorageWithMap();
        await storeDraft(token, 'src-proj', {
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
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN'),
          dirty: true,
        });

        await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(false);
      });

      it('leaves the stored draft dirty when a book was left out', async () => {
        const stored = backStorageWithMap();
        await storeDraft(token, 'src-proj', {
          ...makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'),
          dirty: true,
        });
        stored.set('draft:src-proj:analysis:JHN', '{not json');

        await saveDraftAsNewProject(token, 'src-proj', ['en']);

        expect((await readStoredDraft(token, 'src-proj')).draft.dirty).toBe(true);
      });
    });
  });

  describe('startDraftOver', () => {
    it('lands the started draft though deleting a dropped book fails', async () => {
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
      __mockDeleteUserData.mockRejectedValue(new Error('locked'));

      await expect(
        startDraftOver(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN')),
      ).resolves.toBeUndefined();
    });

    it('wipes a book the started draft drops, though its shard is already gone', async () => {
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
      __mockDeleteUserData.mockRejectedValue(enoentError());

      await expect(
        startDraftOver(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN')),
      ).resolves.toBeUndefined();

      expect(__mockDeleteUserData).toHaveBeenCalledWith(token, 'draft:src-proj:analysis:JHN');
    });

    it("rewrites an unreadable book's shard with what the started draft carries for it", async () => {
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        if (key === 'draft:src-proj:analysis:JHN') return '{not json';
        const written = __mockWriteUserData.mock.calls.findLast(([, k]) => k === key);
        if (!written) throw enoentError();
        return written[2];
      });
      const { draft: loaded } = await readStoredDraft(token, 'src-proj');
      __mockWriteUserData.mockClear();

      await startDraftOver(token, 'src-proj', {
        ...loaded,
        analysis: makeDraftSpanningBooks('src-proj', 'JHN').analysis,
      });

      expect(writtenKeys()).toContain('draft:src-proj:analysis:JHN');
    });

    it('lets a later edit reach a book that was unreadable before the draft started over', async () => {
      const started = makeDraftSpanningBooks('src-proj', 'JHN');
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN', 'JHN'));
      const firstRewrite = __mockWriteUserData.mock.calls.length;
      __mockReadUserData.mockImplementation(async (_t: unknown, key: unknown) => {
        const written = __mockWriteUserData.mock.calls.findLastIndex(([, k]) => k === key);
        if (key === 'draft:src-proj:analysis:JHN' && written < firstRewrite) return '{not json';
        if (written < 0) throw enoentError();
        return __mockWriteUserData.mock.calls[written][2];
      });
      const { draft: loaded } = await readStoredDraft(token, 'src-proj');
      await startDraftOver(token, 'src-proj', { ...loaded, analysis: started.analysis });
      const added = {
        ...started.analysis.tokenAnalysisLinks[0],
        id: 'link-JHN-2',
        token: { tokenRef: 'JHN 1:2!0', surfaceText: 'word-JHN' },
      };

      await openDraftRepository(token, 'src-proj').apply({
        intent: 'putLink',
        tokenAnalysisLinks: { puts: [added], deletes: [] },
      });

      await expect(readStoredDraft(token, 'src-proj')).resolves.toMatchObject({
        draft: {
          analysis: { tokenAnalysisLinks: [started.analysis.tokenAnalysisLinks[0], added] },
        },
        unreadableBooks: [],
      });
    });
  });

  describe('openDraftRepository', () => {
    beforeEach(() => writeThroughStore());

    it('is writable', () => {
      expect(openDraftRepository(token, 'src-proj').capabilities.readOnly).toBe(false);
    });

    it('loads the draft that starting it over stores', async () => {
      const repository = openDraftRepository(token, 'src-proj');
      const saved = makeDraftSpanningBooks('src-proj', 'GEN');

      await storeDraft(token, 'src-proj', saved);

      await expect(repository.exportAll()).resolves.toEqual({ draft: saved, unreadableBooks: [] });
    });

    it('loads the draft for copying and marks it clean', async () => {
      const repository = openDraftRepository(token, 'src-proj');
      const saved = { ...makeDraftSpanningBooks('src-proj', 'GEN'), dirty: true };
      await seedRepository(repository, saved);

      await expect(repository.exportForCopy()).resolves.toEqual({
        draft: saved,
        unreadableBooks: [],
      });
      await repository.markClean();
      await expect(repository.exportAll()).resolves.toMatchObject({ draft: { dirty: false } });
    });

    it('shares what the stored draft knows of storage, rewriting only the edited book', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await storeDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockClear();

      draft.analysis.tokenAnalysisLinks[0].token.surfaceText = 'edited';
      await storeDraft(token, 'src-proj', draft);

      expect(writtenKeys()).toContain('draft:src-proj:analysis:GEN');
      expect(writtenKeys()).not.toContain('draft:src-proj:analysis:JHN');
    });

    it('applies changes to the stored draft', async () => {
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

      await openDraftRepository(token, 'src-proj').apply({
        intent: 'deleteLink',
        tokenAnalysisLinks: { puts: [], deletes: ['link-GEN'] },
      });

      const {
        draft: { analysis },
      } = await readStoredDraft(token, 'src-proj');
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
      ['findLinkedBooks', (r: AnalysisRepository) => r.findLinkedBooks(), 1],
      [
        'findTokenAnalysesByForm',
        (r: AnalysisRepository) => r.findTokenAnalysesByForm(['word-gen']),
        1,
      ],
      ['findPhraseAnalysesByForm', (r: AnalysisRepository) => r.findPhraseAnalysesByForm(['x']), 0],
      [
        'countApprovals',
        (r: AnalysisRepository) => r.countApprovals(['analysis-GEN']).then(Object.keys),
        1,
      ],
      ['checkIndexes', (r: AnalysisRepository) => r.checkIndexes(), 0],
      [
        'getWholeDraft',
        (r: AnalysisRepository) => r.getWholeDraft().then(({ analysis }) => analysis.tokenAnalyses),
        1,
      ],
      [
        'getScope',
        (r: AnalysisRepository) => r.getScope().then(({ analysisLanguages }) => analysisLanguages),
        0,
      ],
    ])('answers %s from the stored draft', async (_name, lookup, count) => {
      await storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));

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
      const saving = storeDraft(token, 'src-proj', makeDraftSpanningBooks('src-proj', 'GEN'));
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
      await readStoredDraft(token, 'src-proj');

      await releaseDraftRepository('src-proj');
      await applyToDraft(bookPuts('EXO'));

      expect(__mockDeleteUserData).not.toHaveBeenCalledWith(token, 'draft:src-proj:analysis:GEN');
    });

    it('lets a draft call already made finish on the repository it releases', async () => {
      const draft = makeDraftSpanningBooks('src-proj', 'GEN', 'JHN');
      await storeDraft(token, 'src-proj', draft);
      __mockWriteUserData.mockClear();

      draft.analysis.tokenAnalysisLinks[0].token.surfaceText = 'edited';
      await Promise.all([storeDraft(token, 'src-proj', draft), releaseDraftRepository('src-proj')]);

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
            analysisCount: 1,
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

        await storeDraft(token, 'src-project', {
          ...emptyDraft('src-project'),
          analysis: opened?.analysis ?? emptyAnalysis(),
        });

        expect((await readStoredDraft(token, 'src-project')).draft.analysis).toEqual(IMPORTED);
      });
    });
  });
});
