/// <reference types="jest" />

import type {
  Book,
  DraftProject,
  InterlinearProject,
  SegmentationDelta,
  TextAnalysis,
} from 'interlinearizer';
import {
  AnalysisSessions,
  type ReportedChange,
  type SessionHost,
  UNDETERMINED_LANGUAGE,
} from '../../services/analysisSessions';
import { ApprovalRuleError } from '../../services/commands/approvalRule';
import type { ChangeBuffer } from '../../services/commands/changeBuffer';
import { DraftRepository } from '../../services/draftRepository';
import type { EditOptions } from '../../services/editHistory';
import { Pt9ImportRepository } from '../../services/pt9ImportRepository';
import { draftKey } from '../../services/storageKeys';
import { ReadOnlyAnalysisError } from '../../types/read-only-analysis-error';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { toProjectSummary } from '../../types/interlinear-project-summary';
import { CURRENT_MODEL_VERSION } from '../../types/model-version';
import {
  FIXTURE_STAMPS,
  makeStubProject,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

const SOURCE = 'src-project';
const OTHER_SOURCE = 'other-project';

const FREE_TRANSLATED: TextAnalysis = {
  ...emptyAnalysis(),
  segmentAnalyses: [
    {
      id: 'sa-1',
      ...FIXTURE_STAMPS,
      surfaceText: 'In the beginning',
      freeTranslation: { en: 'At first' },
    },
  ],
};

function makeImport(overrides: Partial<InterlinearProject> = {}): InterlinearProject {
  return {
    ...makeStubProject('import-id'),
    pt9Import: { fileHashes: {}, importedAt: '2026-02-01T00:00:00.000Z' },
    ...overrides,
  };
}

/** Sessions over drafts in memory and over `projects`, with the host they reach them through. */
function makeSessions(projects: InterlinearProject[] = []) {
  const { storage } = memoryStorage();
  const logger = silentLogger();
  const host = {
    findProject: jest.fn(async (sourceProjectId: string, interlinearProjectId: string) => {
      const project = projects.find(
        ({ id, sourceProjectId: source }) =>
          id === interlinearProjectId && source === sourceProjectId,
      );
      return project && toProjectSummary(project);
    }),
    openDraftRepository: jest.fn(
      (sourceProjectId: string) => new DraftRepository(storage, sourceProjectId, logger),
    ),
    releaseDraftRepository: jest.fn<Promise<void>, [string]>(async () => {}),
    openPt9ImportRepository: jest.fn(
      (interlinearProjectId: string) =>
        new Pt9ImportRepository(
          interlinearProjectId,
          async () => {
            const project = projects.find(({ id }) => id === interlinearProjectId);
            return project && JSON.parse(JSON.stringify(project));
          },
          () => 0,
        ),
    ),
    getInterfaceLanguages: jest.fn(async (): Promise<string[]> => []),
    startTextRead: jest.fn<Promise<void>, [string]>(async () => {}),
    stopTextRead: jest.fn<Promise<void>, [string]>(async () => {}),
    heldBook: jest.fn<Book | undefined, [string, string, SegmentationDelta | undefined]>(
      () => undefined,
    ),
    reportChange: jest.fn<void, [ReportedChange]>(),
  } satisfies SessionHost;
  const saveDraft = (draft: DraftProject) =>
    new DraftRepository(storage, draft.sourceProjectId, logger).replaceAll(draft);
  return { host, sessions: new AnalysisSessions(host), saveDraft, storage };
}

/** A promise a test settles when it chooses. */
function deferred() {
  let settle: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle() };
}

/** Lets every already-settled promise's callbacks run. */
const flushPromises = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('AnalysisSessions', () => {
  describe('open', () => {
    it('opens an editable session on a draft', async () => {
      const { host, sessions, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'] });

      const opened = await sessions.open(SOURCE);

      expect(opened).toStrictEqual({
        sessionId: expect.any(String),
        readOnly: false,
        hasFreeTranslations: false,
      });
      expect(host.openDraftRepository).toHaveBeenCalledWith(SOURCE);
      await expect(sessions.run(opened.sessionId, async ({ scope }) => scope)).resolves.toEqual({
        kind: 'draft',
        sourceProjectId: SOURCE,
      });
    });

    it("builds the repository's indexes once it opens, without waiting for a command", async () => {
      const { host, sessions } = makeSessions();
      const getScope = jest.spyOn(DraftRepository.prototype, 'getScope');

      await sessions.open(SOURCE);
      await flushPromises();

      expect(getScope).toHaveBeenCalledTimes(1);
      expect(host.openDraftRepository).toHaveBeenCalledTimes(1);
    });

    it('opens when building the indexes fails, and the first command meets the failure', async () => {
      const { sessions } = makeSessions();
      jest
        .spyOn(DraftRepository.prototype, 'getScope')
        .mockRejectedValue(new Error('storage is gone'));

      const { sessionId } = await sessions.open(SOURCE);

      await expect(
        sessions.run(sessionId, ({ repository }) => repository.getScope()),
      ).rejects.toThrow('storage is gone');
    });

    it('reports a free translation in the draft', async () => {
      const { sessions, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysis: FREE_TRANSLATED });

      await expect(sessions.open(SOURCE)).resolves.toMatchObject({ hasFreeTranslations: true });
    });

    it('opens a draft with the interlinear project it saves to, reading the draft', async () => {
      const { sessions } = makeSessions([{ ...makeStubProject(), analysis: FREE_TRANSLATED }]);

      const opened = await sessions.open(SOURCE, 'proj-id');

      expect(opened).toMatchObject({ readOnly: false, hasFreeTranslations: false });
      await expect(sessions.run(opened.sessionId, async ({ scope }) => scope)).resolves.toEqual({
        kind: 'draft',
        sourceProjectId: SOURCE,
        interlinearProjectId: 'proj-id',
      });
    });

    it('opens a Paratext 9 import read-only, reading its analysis', async () => {
      const { host, sessions } = makeSessions([makeImport({ analysis: FREE_TRANSLATED })]);

      const opened = await sessions.open(SOURCE, 'import-id');

      expect(opened).toMatchObject({ readOnly: true, hasFreeTranslations: true });
      expect(host.openDraftRepository).not.toHaveBeenCalled();
      await expect(sessions.run(opened.sessionId, async ({ scope }) => scope)).resolves.toEqual({
        kind: 'pt9Import',
        sourceProjectId: SOURCE,
        interlinearProjectId: 'import-id',
      });
    });

    it('refuses an interlinear project the source project does not have', async () => {
      const { sessions } = makeSessions([{ ...makeStubProject(), sourceProjectId: OTHER_SOURCE }]);

      await expect(sessions.open(SOURCE, 'proj-id')).rejects.toThrow(
        'source project src-project has no interlinear project proj-id',
      );
      await expect(sessions.open(SOURCE)).resolves.toMatchObject({ readOnly: false });
    });

    it('starts on the first analysis language its draft lists', async () => {
      const { host, sessions, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['fr', 'en'] });

      const { sessionId } = await sessions.open(SOURCE);

      await expect(
        sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
      ).resolves.toBe('fr');
      expect(host.getInterfaceLanguages).not.toHaveBeenCalled();
    });

    it('starts on the first interface language when its draft lists none', async () => {
      const { host, sessions } = makeSessions();
      host.getInterfaceLanguages.mockResolvedValue(['de', 'en']);

      const { sessionId } = await sessions.open(SOURCE);

      await expect(
        sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
      ).resolves.toBe('de');
    });

    it('starts on the undetermined language when neither its draft nor the platform lists one', async () => {
      const { sessions } = makeSessions();

      const { sessionId } = await sessions.open(SOURCE);

      await expect(
        sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
      ).resolves.toBe(UNDETERMINED_LANGUAGE);
    });

    it("closes the source's earlier session, releasing its draft before reopening it", async () => {
      const { host, sessions } = makeSessions();
      const earlier = await sessions.open(SOURCE);

      const later = await sessions.open(SOURCE);

      await expect(sessions.run(earlier.sessionId, async () => {})).rejects.toThrow(
        `no session ${earlier.sessionId} is open`,
      );
      await expect(sessions.run(later.sessionId, async () => 'ran')).resolves.toBe('ran');
      expect(host.releaseDraftRepository).toHaveBeenCalledTimes(1);
      expect(host.releaseDraftRepository.mock.invocationCallOrder[0]).toBeLessThan(
        host.openDraftRepository.mock.invocationCallOrder[1],
      );
    });

    it('reopens a source on what storage holds', async () => {
      const { sessions, saveDraft } = makeSessions();
      await sessions.open(SOURCE);
      await saveDraft({ ...emptyDraft(SOURCE), analysis: FREE_TRANSLATED });

      await expect(sessions.open(SOURCE)).resolves.toMatchObject({ hasFreeTranslations: true });
    });

    it("waits for the earlier session's commands before reopening the source", async () => {
      const { host, sessions } = makeSessions();
      const earlier = await sessions.open(SOURCE);
      const command = deferred();
      const running = sessions.run(earlier.sessionId, () => command.promise);

      const reopening = sessions.open(SOURCE);
      await flushPromises();

      expect(host.openDraftRepository).toHaveBeenCalledTimes(1);
      command.resolve();
      await running;
      await expect(reopening).resolves.toMatchObject({ readOnly: false });
      expect(host.openDraftRepository).toHaveBeenCalledTimes(2);
    });

    it('leaves the source with no session when the replacing open fails', async () => {
      const { sessions, storage } = makeSessions();
      const earlier = await sessions.open(SOURCE);
      await storage.write(
        draftKey(SOURCE),
        JSON.stringify({ ...emptyDraft(SOURCE), modelVersion: CURRENT_MODEL_VERSION + 1 }),
      );

      await expect(sessions.open(SOURCE)).rejects.toThrow('newer than this build supports');
      await expect(sessions.run(earlier.sessionId, async () => {})).rejects.toThrow(
        `no session ${earlier.sessionId} is open`,
      );
    });

    it('keeps the sessions of different source projects open together', async () => {
      const { host, sessions } = makeSessions();

      const first = await sessions.open(SOURCE);
      const second = await sessions.open(OTHER_SOURCE);

      await expect(sessions.run(first.sessionId, async () => 'first')).resolves.toBe('first');
      await expect(sessions.run(second.sessionId, async () => 'second')).resolves.toBe('second');
      expect(host.releaseDraftRepository).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('refuses every command sent after it', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const closing = sessions.close(sessionId);

      await expect(sessions.run(sessionId, async () => {})).rejects.toThrow(
        `no session ${sessionId} is open`,
      );
      await closing;
    });

    it('releases the draft once the commands sent before it settle', async () => {
      const { host, sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = deferred();
      const running = sessions.run(sessionId, () => command.promise);

      const closing = sessions.close(sessionId);
      await flushPromises();

      expect(host.releaseDraftRepository).not.toHaveBeenCalled();
      command.resolve();
      await running;
      await closing;
      expect(host.releaseDraftRepository).toHaveBeenCalledWith(SOURCE);
    });

    it("releases no draft for a Paratext 9 import's session", async () => {
      const { host, sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');

      await sessions.close(sessionId);

      expect(host.releaseDraftRepository).not.toHaveBeenCalled();
    });

    it('does nothing for a session that is not open', async () => {
      const { host, sessions } = makeSessions();

      await sessions.close('not-a-session');

      expect(host.releaseDraftRepository).not.toHaveBeenCalled();
    });

    it('releases once when sent twice', async () => {
      const { host, sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      await Promise.all([sessions.close(sessionId), sessions.close(sessionId)]);

      expect(host.releaseDraftRepository).toHaveBeenCalledTimes(1);
    });

    it('releases once when sent before a replacing open takes its turn', async () => {
      const { host, sessions } = makeSessions();
      const earlier = await sessions.open(SOURCE);

      const reopening = sessions.open(SOURCE);
      const closing = sessions.close(earlier.sessionId);
      const later = await reopening;
      await closing;

      expect(host.releaseDraftRepository).toHaveBeenCalledTimes(1);
      await expect(sessions.run(later.sessionId, async () => 'ran')).resolves.toBe('ran');
    });
  });

  describe('closeAll', () => {
    it('closes every open session', async () => {
      const { host, sessions } = makeSessions();
      const first = await sessions.open(SOURCE);
      const second = await sessions.open(OTHER_SOURCE);

      await sessions.closeAll();

      await expect(sessions.run(first.sessionId, async () => {})).rejects.toThrow();
      await expect(sessions.run(second.sessionId, async () => {})).rejects.toThrow();
      expect(host.releaseDraftRepository).toHaveBeenCalledWith(SOURCE);
      expect(host.releaseDraftRepository).toHaveBeenCalledWith(OTHER_SOURCE);
    });

    it('closes a session whose open is still underway', async () => {
      const { host, sessions } = makeSessions();
      const languages = deferred();
      host.getInterfaceLanguages.mockImplementation(async () => {
        await languages.promise;
        return [];
      });
      const opening = sessions.open(SOURCE);
      await flushPromises();

      const closing = sessions.closeAll();
      languages.resolve();
      const { sessionId } = await opening;
      await closing;

      await expect(sessions.run(sessionId, async () => {})).rejects.toThrow(
        `no session ${sessionId} is open`,
      );
      expect(host.releaseDraftRepository).toHaveBeenCalledWith(SOURCE);
    });
  });

  describe('run', () => {
    it('runs commands one at a time, in the order they were sent', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const steps: string[] = [];
      const first = deferred();

      const running = Promise.all([
        sessions.run(sessionId, async () => {
          steps.push('first started');
          await first.promise;
          steps.push('first ended');
        }),
        sessions.run(sessionId, async () => {
          steps.push('second ran');
        }),
      ]);
      await flushPromises();
      first.resolve();
      await running;

      expect(steps).toStrictEqual(['first started', 'first ended', 'second ran']);
    });

    it('runs later commands after one fails', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const failing = sessions.run(sessionId, async () => {
        throw new Error('command failed');
      });
      const later = sessions.run(sessionId, async () => 'ran');

      await expect(failing).rejects.toThrow('command failed');
      await expect(later).resolves.toBe('ran');
    });

    it('refuses a session that is not open', async () => {
      const { sessions } = makeSessions();

      await expect(sessions.run('not-a-session', async () => {})).rejects.toThrow(
        'no session not-a-session is open',
      );
    });
  });

  describe('runEdit', () => {
    it("refuses an edit on a Paratext 9 import's session without running it", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');
      const edit = jest.fn(async () => {});

      await expect(sessions.runEdit(sessionId, edit)).rejects.toThrow(ReadOnlyAnalysisError);
      expect(edit).not.toHaveBeenCalled();
    });

    it("runs an edit on a draft's session", async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      await expect(sessions.runEdit(sessionId, async () => 'edited')).resolves.toBe('edited');
    });

    it('refuses a session that is not open', async () => {
      const { sessions } = makeSessions();

      await expect(sessions.runEdit('not-a-session', async () => {})).rejects.toThrow(
        'no session not-a-session is open',
      );
    });
  });

  describe('undo and redo', () => {
    const putting = (id: string) => ({
      intent: `put ${id}`,
      tokenAnalyses: { puts: [{ id, ...FIXTURE_STAMPS, surfaceText: id }], deletes: [] },
    });

    /** The ids of the token payloads the source project's stored draft holds. */
    async function storedIds(storage: ReturnType<typeof makeSessions>['storage']) {
      const { draft } = await new DraftRepository(storage, SOURCE, silentLogger()).exportAll();
      return draft.analysis.tokenAnalyses.map(({ id }) => id);
    }

    it("undoes and redoes an edit applied through the session's history", async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.runEdit(sessionId, (session) => session.history.apply(putting('a')));

      await expect(sessions.undo(sessionId)).resolves.toMatchObject({
        changes: { intent: 'put a', tokenAnalyses: { puts: [], deletes: ['a'] } },
      });
      await expect(storedIds(storage)).resolves.toStrictEqual([]);
      await expect(sessions.redo(sessionId)).resolves.toMatchObject({ changes: putting('a') });
      await expect(storedIds(storage)).resolves.toStrictEqual(['a']);
    });

    it('starts a reopened source with nothing to undo', async () => {
      const { sessions } = makeSessions();
      const earlier = await sessions.open(SOURCE);
      await sessions.runEdit(earlier.sessionId, (session) => session.history.apply(putting('a')));

      const { sessionId } = await sessions.open(SOURCE);

      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
    });

    it("refuses an undo on a Paratext 9 import's session", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');

      await expect(sessions.undo(sessionId)).rejects.toThrow(ReadOnlyAnalysisError);
    });

    it("refuses a redo on a Paratext 9 import's session", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');

      await expect(sessions.redo(sessionId)).rejects.toThrow(ReadOnlyAnalysisError);
    });
  });

  describe('edit', () => {
    const payload = (id: string) => ({ id, ...FIXTURE_STAMPS, surfaceText: id });
    const approvedLink = (id: string) => ({
      id,
      analysisId: 'a',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      token: { tokenRef: 'GEN 1:1:0', surfaceText: 'a' },
    });

    /** The source project's draft as stored. */
    const stored = async (storage: ReturnType<typeof makeSessions>['storage']) =>
      (await new DraftRepository(storage, SOURCE, silentLogger()).exportAll()).draft;

    it('applies what the command stages as one undo step, marking the draft dirty', async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const { changes } = await sessions.edit(sessionId, 'add', async (buffer) => {
        buffer.create('tokenAnalyses', payload('a'));
        buffer.create('tokenAnalyses', payload('b'));
      });

      expect(changes).toMatchObject({ intent: 'add' });
      await expect(stored(storage)).resolves.toMatchObject({
        dirty: true,
        analysis: { tokenAnalyses: [payload('a'), payload('b')] },
      });
      await sessions.undo(sessionId);
      await expect(stored(storage)).resolves.toMatchObject({ analysis: { tokenAnalyses: [] } });
    });

    it("lists the session's analysis language on a draft listing none, undoing it with the edit", async () => {
      const { host, sessions, storage } = makeSessions();
      host.getInterfaceLanguages.mockResolvedValue(['de']);
      const { sessionId } = await sessions.open(SOURCE);

      await sessions.edit(sessionId, 'add', async (buffer) => {
        buffer.create('tokenAnalyses', payload('a'));
      });

      await expect(stored(storage)).resolves.toMatchObject({ analysisLanguages: ['de'] });
      await sessions.undo(sessionId);
      await expect(stored(storage)).resolves.toMatchObject({ analysisLanguages: [] });
    });

    it("keeps the scope the command staged when listing the session's analysis language", async () => {
      const { host, sessions, storage } = makeSessions();
      host.getInterfaceLanguages.mockResolvedValue(['de']);
      const { sessionId } = await sessions.open(SOURCE);
      const segmentation = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

      await sessions.edit(sessionId, 'merge', async (buffer) => {
        buffer.putScope({ ...(await buffer.getScope()), segmentation });
      });

      await expect(stored(storage)).resolves.toMatchObject({
        analysisLanguages: ['de'],
        segmentation,
      });
      await sessions.undo(sessionId);
      await expect(stored(storage)).resolves.not.toHaveProperty('segmentation');
    });

    it('leaves the analysis languages of a draft listing some', async () => {
      const { sessions, storage, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['fr', 'en'] });
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.setAnalysisLanguage(sessionId, 'de');

      const { changes } = await sessions.edit(sessionId, 'add', async (buffer) => {
        buffer.create('tokenAnalyses', payload('a'));
      });

      expect(changes.scope).toBeUndefined();
      await expect(stored(storage)).resolves.toMatchObject({ analysisLanguages: ['fr', 'en'] });
    });

    it('applies nothing, and records no undo step, for a command staging nothing', async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      await expect(sessions.edit(sessionId, 'nothing', async () => {})).resolves.toStrictEqual({
        changeId: expect.any(String),
        changes: { intent: 'nothing' },
        poolBuckets: {},
        poolAnalyses: [],
      });

      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
      await expect(stored(storage)).resolves.toMatchObject({ dirty: false });
    });

    it('gives the command the session it runs on', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.setAnalysisLanguage(sessionId, 'fr');

      await sessions.edit(sessionId, 'read', async (_buffer, session) => {
        expect(session.analysisLanguage).toBe('fr');
      });
    });

    it('refuses changes that would approve a second analysis for a token, applying nothing', async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      await expect(
        sessions.edit(sessionId, 'approveTwice', async (buffer) => {
          buffer.create('tokenAnalysisLinks', approvedLink('l-1'));
          buffer.create('tokenAnalysisLinks', approvedLink('l-2'));
        }),
      ).rejects.toThrow(ApprovalRuleError);

      await expect(stored(storage)).resolves.toMatchObject({
        analysis: { tokenAnalysisLinks: [] },
      });
    });

    it("refuses an edit on a Paratext 9 import's session without running it", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');
      const command = jest.fn(async () => {});

      await expect(sessions.edit(sessionId, 'add', command)).rejects.toThrow(ReadOnlyAnalysisError);
      expect(command).not.toHaveBeenCalled();
    });
    it.each([
      ['an unsaved', true],
      ['a saved', false],
    ])('leaves %s draft as it was when the edit keeps the unsaved mark', async (_case, dirty) => {
      const { sessions, storage, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'], dirty });
      const { sessionId } = await sessions.open(SOURCE);

      await sessions.edit(
        sessionId,
        'add',
        async (buffer) => buffer.create('tokenAnalyses', payload('a')),
        { unsavedMark: 'keep' },
      );

      await expect(stored(storage)).resolves.toMatchObject({
        dirty,
        analysis: { tokenAnalyses: [payload('a')] },
      });
    });

    it('marks the draft saved when the edit clears the mark', async () => {
      const { sessions, storage, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'], dirty: true });
      const { sessionId } = await sessions.open(SOURCE);

      await sessions.edit(
        sessionId,
        'add',
        async (buffer) => buffer.create('tokenAnalyses', payload('a')),
        { unsavedMark: 'clear' },
      );

      await expect(stored(storage)).resolves.toMatchObject({
        dirty: false,
        analysis: { tokenAnalyses: [payload('a')] },
      });
    });

    it('marks the draft saved when an edit clearing the mark stages nothing', async () => {
      const { sessions, storage, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'], dirty: true });
      const { sessionId } = await sessions.open(SOURCE);

      await sessions.edit(sessionId, 'nothing', async () => {}, { unsavedMark: 'clear' });

      await expect(stored(storage)).resolves.toMatchObject({ dirty: false });
      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
    });

    it('reads an unsaved mark given as a function from the session in the edit turn', async () => {
      const { sessions, storage, saveDraft } = makeSessions();
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'], dirty: true });
      const { sessionId } = await sessions.open(SOURCE);
      const readMark = jest.fn((): EditOptions['unsavedMark'] => 'clear');

      await sessions.edit(
        sessionId,
        'add',
        async (buffer) => buffer.create('tokenAnalyses', payload('a')),
        { unsavedMark: readMark },
      );

      expect(readMark).toHaveBeenCalledWith(
        expect.objectContaining({ scope: expect.objectContaining({ sourceProjectId: SOURCE }) }),
      );
      await expect(stored(storage)).resolves.toMatchObject({ dirty: false });
    });
  });

  describe('replies', () => {
    const payload = (id: string) => ({ id, ...FIXTURE_STAMPS, surfaceText: id });
    const linking = (buffer: ChangeBuffer, tokenRef: string) => {
      buffer.create('tokenAnalyses', payload('a'));
      buffer.create('tokenAnalysisLinks', makeTokenLink('a', tokenRef));
    };

    it('carries the pool buckets of the forms an edit touched', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const reply = await sessions.edit(sessionId, 'link', async (buffer) =>
        linking(buffer, 'GEN 1:1:0'),
      );

      expect(reply.poolBuckets).toStrictEqual({ a: [{ analysisId: 'a', frequency: 1 }] });
      expect(reply.poolAnalyses).toStrictEqual([payload('a')]);
    });

    it('carries the change id the edit was sent with', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const reply = await sessions.edit(sessionId, 'nothing', async () => {}, {
        changeId: 'change-1',
      });

      expect(reply.changeId).toBe('change-1');
    });

    it('gives each edit sent without a change id a fresh one', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const first = await sessions.edit(sessionId, 'nothing', async () => {});
      const second = await sessions.edit(sessionId, 'nothing', async () => {});

      expect(first.changeId).not.toBe(second.changeId);
    });

    it('answers an edit sent again under its change id with the first reply, applying it once', async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = jest.fn(async (buffer: ChangeBuffer) => linking(buffer, 'GEN 1:1:0'));

      const first = await sessions.edit(sessionId, 'link', command, { changeId: 'change-1' });
      const again = await sessions.edit(sessionId, 'link', command, { changeId: 'change-1' });

      expect(again).toBe(first);
      expect(command).toHaveBeenCalledTimes(1);
      await sessions.undo(sessionId);
      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
      const { draft } = await new DraftRepository(storage, SOURCE, silentLogger()).exportAll();
      expect(draft.analysis.tokenAnalyses).toStrictEqual([]);
    });

    it('runs an edit sent again under the change id of an attempt that failed', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = jest
        .fn<Promise<void>, [ChangeBuffer]>()
        .mockRejectedValueOnce(new Error('first attempt'))
        .mockImplementationOnce(async (buffer) => linking(buffer, 'GEN 1:1:0'));

      await expect(
        sessions.edit(sessionId, 'link', command, { changeId: 'change-1' }),
      ).rejects.toThrow('first attempt');
      const again = await sessions.edit(sessionId, 'link', command, { changeId: 'change-1' });

      expect(again.changes.tokenAnalyses?.puts).toStrictEqual([payload('a')]);
    });

    it('applies again an edit sent under a change id it has since forgotten', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = jest.fn(async () => {});
      await sessions.edit(sessionId, 'first', command, { changeId: 'change-0' });
      await Promise.all(
        Array.from({ length: 16 }, (_unused, i) =>
          sessions.edit(sessionId, 'later', async () => {}, { changeId: `change-${i + 1}` }),
        ),
      );

      await sessions.edit(sessionId, 'first', command, { changeId: 'change-0' });

      expect(command).toHaveBeenCalledTimes(2);
    });

    it('undoes once for an undo sent again under its change id', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.edit(sessionId, 'link', async (buffer) => linking(buffer, 'GEN 1:1:0'));
      await sessions.edit(sessionId, 'link b', async (buffer) => {
        buffer.create('tokenAnalyses', payload('b'));
      });

      const first = await sessions.undo(sessionId, 'undo-1');
      const again = await sessions.undo(sessionId, 'undo-1');

      expect(again).toBe(first);
      expect(first?.changes.intent).toBe('link b');
      await expect(sessions.undo(sessionId)).resolves.toMatchObject({
        changes: { intent: 'link' },
      });
    });

    it('hands back with an undo and its redo the step the edit was made as', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.edit(sessionId, 'link', async (buffer) => linking(buffer, 'GEN 1:1:0'), {
        step: { location: 'GEN 1:1:0' },
      });

      await expect(sessions.undo(sessionId)).resolves.toMatchObject({
        step: { location: 'GEN 1:1:0' },
      });
      await expect(sessions.redo(sessionId)).resolves.toMatchObject({
        step: { location: 'GEN 1:1:0' },
      });
    });

    it('reads the step from the changes the edit applies when told how', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.edit(sessionId, 'link', async (buffer) => linking(buffer, 'GEN 1:1:0'), {
        step: (changes) => ({ location: changes.tokenAnalysisLinks?.puts[0].token.tokenRef }),
      });

      await expect(sessions.undo(sessionId)).resolves.toMatchObject({
        step: { location: 'GEN 1:1:0' },
      });
    });

    it('hands back no step with an undo of an edit made as none', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.edit(sessionId, 'link', async (buffer) => linking(buffer, 'GEN 1:1:0'));

      await expect(sessions.undo(sessionId)).resolves.not.toHaveProperty('step');
    });

    it('carries the pool buckets an undo and a redo touched, and their change ids', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      await sessions.edit(sessionId, 'link', async (buffer) => linking(buffer, 'GEN 1:1:0'));

      const undone = await sessions.undo(sessionId, 'undo-1');
      const redone = await sessions.redo(sessionId, 'redo-1');

      expect(undone).toMatchObject({ changeId: 'undo-1', poolBuckets: { a: [] } });
      expect(redone).toMatchObject({
        changeId: 'redo-1',
        poolBuckets: { a: [{ analysisId: 'a', frequency: 1 }] },
      });
    });
  });

  describe('reported changes', () => {
    const book = makeVerseBook([
      { sid: 'GEN 1:1', text: 'alpha beta' },
      { sid: 'GEN 1:2', text: 'gamma' },
    ]);
    const gamma = tokenRefOf(book, 'gamma');
    const payload = (id: string) => ({ id, ...FIXTURE_STAMPS, surfaceText: id });

    async function sessionHolding() {
      const made = makeSessions();
      made.host.heldBook.mockImplementation((_source, bookId) =>
        bookId === 'GEN' ? book : undefined,
      );
      const { sessionId } = await made.sessions.open(SOURCE);
      return { ...made, sessionId };
    }

    it('reports what an edit touched under its change id', async () => {
      const { host, sessions, sessionId } = await sessionHolding();

      await sessions.edit(
        sessionId,
        'link',
        async (buffer) => {
          buffer.create('tokenAnalyses', payload('ta'));
          buffer.create('tokenAnalysisLinks', makeTokenLink('ta', gamma));
        },
        { changeId: 'change-1' },
      );

      expect(host.reportChange).toHaveBeenCalledWith({
        sessionId,
        changeId: 'change-1',
        books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
        analysisIds: ['ta'],
        queries: ['getCatalogRows', 'getConcordance'],
      });
    });

    it('names whole a book whose boundaries the edit moved', async () => {
      const { host, sessions, sessionId } = await sessionHolding();
      const segmentation = {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: tokenRefOf(book, 'beta'), surfaceText: 'beta' }],
      };

      await sessions.edit(sessionId, 'split', async (buffer) => {
        buffer.putScope({ ...(await buffer.getScope()), segmentation });
        buffer.create('tokenAnalysisLinks', makeTokenLink('ta', 'EXO 1:1:0'));
      });

      expect(host.heldBook).toHaveBeenCalledWith(SOURCE, 'EXO', undefined);
      expect(host.reportChange).toHaveBeenCalledWith(
        expect.objectContaining({ books: [{ bookId: 'GEN' }, { bookId: 'EXO' }] }),
      );
    });

    it('passes the boundaries the change leaves in the book it reads', async () => {
      const { host, sessions, sessionId, saveDraft } = await sessionHolding();
      const segmentation = {
        removedVerseStarts: [gamma],
        addedStarts: [],
      };
      await saveDraft({ ...emptyDraft(SOURCE), analysisLanguages: ['en'], segmentation });
      await sessions.close(sessionId);
      const reopened = await sessions.open(SOURCE);

      await sessions.edit(reopened.sessionId, 'link', async (buffer) => {
        buffer.create('tokenAnalysisLinks', makeTokenLink('ta', gamma));
      });

      expect(host.heldBook).toHaveBeenCalledWith(SOURCE, 'GEN', segmentation);
    });

    it('reports nothing for a change touching no analysis and no boundaries', async () => {
      const { host, sessions, sessionId } = await sessionHolding();

      await sessions.edit(sessionId, 'language', async (buffer) => {
        buffer.putScope({ ...(await buffer.getScope()), analysisLanguages: ['fr'] });
      });

      expect(host.reportChange).not.toHaveBeenCalled();
    });

    it('reports nothing for an edit staging nothing', async () => {
      const { host, sessions, sessionId } = await sessionHolding();

      await sessions.edit(sessionId, 'nothing', async () => {});

      expect(host.reportChange).not.toHaveBeenCalled();
    });

    it('reports what an undo touched under its change id', async () => {
      const { host, sessions, sessionId } = await sessionHolding();
      await sessions.edit(sessionId, 'link', async (buffer) => {
        buffer.create('tokenAnalysisLinks', makeTokenLink('ta', gamma));
      });

      await sessions.undo(sessionId, 'undo-1');

      expect(host.reportChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          changeId: 'undo-1',
          books: [{ bookId: 'GEN', ranges: [{ start: 1, end: 2 }] }],
        }),
      );
    });

    it('reports what a re-anchor pass changed', async () => {
      const before = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha beta' }]);
      const after = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha and beta' }]);
      const made = makeSessions();
      made.host.heldBook.mockReturnValue(after);
      await made.saveDraft({
        ...emptyDraft(SOURCE),
        analysis: {
          ...emptyAnalysis(),
          tokenAnalysisLinks: [
            makeTokenLink('ta', tokenRefOf(before, 'beta'), { id: 'tl', surfaceText: 'beta' }),
          ],
        },
      });
      const { sessionId } = await made.sessions.open(SOURCE);

      await made.sessions.reanchorBook(SOURCE, after);

      expect(made.host.reportChange).toHaveBeenCalledWith({
        sessionId,
        changeId: expect.any(String),
        books: [{ bookId: 'GEN', ranges: [{ start: 0, end: 1 }] }],
        analysisIds: ['ta'],
        queries: ['getCatalogRows', 'getConcordance'],
      });
    });

    it('reports nothing for a re-anchor pass that changed nothing', async () => {
      const { host, sessions } = await sessionHolding();

      await sessions.reanchorBook(SOURCE, book);

      expect(host.reportChange).not.toHaveBeenCalled();
    });
  });

  describe('sessionIdFor', () => {
    it("names the source project's open session", async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      expect(sessions.sessionIdFor(SOURCE)).toBe(sessionId);
      expect(sessions.sessionIdFor(OTHER_SOURCE)).toBeUndefined();
    });
  });

  describe('preview', () => {
    const payload = (id: string) => ({ id, ...FIXTURE_STAMPS, surfaceText: id });

    it('reports what the command stages, applying nothing', async () => {
      const { sessions, storage } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      const changes = await sessions.preview(sessionId, 'add', async (buffer) => {
        buffer.create('tokenAnalyses', payload('a'));
      });

      expect(changes).toStrictEqual({
        intent: 'add',
        tokenAnalyses: { puts: [payload('a')], deletes: [] },
      });
      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
      await expect(
        new DraftRepository(storage, SOURCE, silentLogger()).exportAll(),
      ).resolves.toMatchObject({ draft: { analysis: { tokenAnalyses: [] } } });
    });

    it("answers on a Paratext 9 import's session", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');

      await expect(sessions.preview(sessionId, 'nothing', async () => {})).resolves.toStrictEqual({
        intent: 'nothing',
      });
    });

    it('refuses a session that is not open', async () => {
      const { sessions } = makeSessions();

      await expect(sessions.preview('no-session', 'nothing', async () => {})).rejects.toThrow(
        'no session no-session is open',
      );
    });
  });

  describe('the whole-text read', () => {
    it("starts reading the source's whole text afresh when a session opens", async () => {
      const { host, sessions } = makeSessions();

      await sessions.open(SOURCE);

      expect(host.startTextRead).toHaveBeenCalledWith(SOURCE);
    });

    it('ends the read once the commands sent before the close settle', async () => {
      const { host, sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = deferred();
      const running = sessions.run(sessionId, () => command.promise);

      const closing = sessions.close(sessionId);
      await flushPromises();
      expect(host.stopTextRead).not.toHaveBeenCalled();
      command.resolve();
      await Promise.all([running, closing]);

      expect(host.stopTextRead).toHaveBeenCalledWith(SOURCE);
    });

    it("reads a reopened source's text again", async () => {
      const { host, sessions } = makeSessions();
      await sessions.open(SOURCE);

      await sessions.open(SOURCE);

      expect(host.stopTextRead).toHaveBeenCalledTimes(1);
      expect(host.startTextRead).toHaveBeenCalledTimes(2);
    });
  });

  describe('re-anchoring', () => {
    /** Genesis 1:1 reading `text`, versioned by its text as a book's content hash would be. */
    function genesis(text: string): Book {
      return { ...makeVerseBook([{ sid: 'GEN 1:1', text }]), textVersion: text };
    }

    /** A link to the payload `analysisId` on "beta" where `book` has it. */
    function betaLink(book: Book, analysisId: string) {
      return makeTokenLink(analysisId, tokenRefOf(book, 'beta'), {
        surfaceText: 'beta',
        id: 'tl-beta',
      });
    }

    const BEFORE = genesis('alpha beta');
    const AFTER = genesis('alpha and beta');

    /** The stored link on "beta". */
    async function storedLink(storage: ReturnType<typeof makeSessions>['storage']) {
      const { draft } = await new DraftRepository(storage, SOURCE, silentLogger()).exportAll();
      return draft.analysis.tokenAnalysisLinks[0];
    }

    /** A session over a draft glossing "beta" as `BEFORE` reads it. */
    async function sessionGlossingBeta() {
      const made = makeSessions();
      await made.saveDraft({
        ...emptyDraft(SOURCE),
        analysis: {
          ...emptyAnalysis(),
          tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'beta' }],
          tokenAnalysisLinks: [betaLink(BEFORE, 'ta-1')],
        },
      });
      const { sessionId } = await made.sessions.open(SOURCE);
      return { ...made, sessionId };
    }

    it("re-anchors the session's draft to a book's current text", async () => {
      const { sessions, storage } = await sessionGlossingBeta();

      await sessions.reanchorBook(SOURCE, AFTER);

      expect((await storedLink(storage)).token.tokenRef).toBe(tokenRefOf(AFTER, 'beta'));
    });

    it('adds no undo step', async () => {
      const { sessions, sessionId } = await sessionGlossingBeta();

      await sessions.reanchorBook(SOURCE, AFTER);

      await expect(sessions.undo(sessionId)).resolves.toBeUndefined();
    });

    /** A session over a draft that links into no book, and splits Genesis 1:1 at "beta". */
    async function sessionSplittingBeta() {
      const made = makeSessions();
      await made.saveDraft({
        ...emptyDraft(SOURCE),
        segmentation: {
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: tokenRefOf(BEFORE, 'beta'), surfaceText: 'beta' }],
        },
      });
      const { sessionId } = await made.sessions.open(SOURCE);
      return { ...made, sessionId };
    }

    it('moves the splits of a book the draft does not link into', async () => {
      const { sessions, storage } = await sessionSplittingBeta();

      await sessions.reanchorBook(SOURCE, AFTER);

      const { draft } = await new DraftRepository(storage, SOURCE, silentLogger()).exportAll();
      expect(draft.segmentation?.addedStarts).toEqual([
        { tokenRef: tokenRefOf(AFTER, 'beta'), surfaceText: 'beta' },
      ]);
    });

    it('records the pass over a book the draft only splits', async () => {
      const { sessions, sessionId } = await sessionSplittingBeta();
      const recordPass = await sessions.run(sessionId, async (session) =>
        jest.spyOn(session.history, 'recordPass'),
      );

      await sessions.reanchorBook(SOURCE, AFTER);

      expect(recordPass).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['records', 'it links into', AFTER, 1],
      ['records no', 'it holds no analysis in', makeVerseBook([{ sid: 'EXO 1:1', text: 'x' }]), 0],
    ])('%s the pass over a book %s', async (_records, _holds, book, recorded) => {
      const { sessions, sessionId } = await sessionGlossingBeta();
      const recordPass = await sessions.run(sessionId, async (session) =>
        jest.spyOn(session.history, 'recordPass'),
      );

      await sessions.reanchorBook(SOURCE, book);

      expect(recordPass).toHaveBeenCalledTimes(recorded);
    });

    it('undoes and redoes edits re-anchored to the current text', async () => {
      const { sessions, sessionId, storage } = await sessionGlossingBeta();
      const relinking = (analysisId: string) => ({
        intent: `link ${analysisId}`,
        tokenAnalysisLinks: { puts: [betaLink(BEFORE, analysisId)], deletes: [] },
      });
      await sessions.runEdit(sessionId, (session) => session.history.apply(relinking('ta-2')));
      await sessions.reanchorBook(SOURCE, AFTER);

      await sessions.undo(sessionId);
      expect(await storedLink(storage)).toEqual(
        expect.objectContaining({ analysisId: 'ta-1', token: betaLink(AFTER, 'ta-1').token }),
      );
      await sessions.redo(sessionId);
      expect(await storedLink(storage)).toEqual(
        expect.objectContaining({ analysisId: 'ta-2', token: betaLink(AFTER, 'ta-2').token }),
      );
    });

    it("re-anchors an edit to the books its command returns, in the edit's undo step", async () => {
      const { sessions, sessionId, storage } = await sessionGlossingBeta();

      const { changes } = await sessions.edit(sessionId, 'relink', async (buffer) => {
        buffer.put('tokenAnalysisLinks', betaLink(BEFORE, 'ta-2'));
        return [AFTER];
      });

      expect(changes.tokenAnalysisLinks?.puts).toEqual([
        expect.objectContaining({ analysisId: 'ta-2', token: betaLink(AFTER, 'ta-2').token }),
      ]);
      expect(await storedLink(storage)).toEqual(
        expect.objectContaining({ analysisId: 'ta-2', token: betaLink(AFTER, 'ta-2').token }),
      );
      await sessions.undo(sessionId);
      expect(await storedLink(storage)).toEqual(betaLink(BEFORE, 'ta-1'));
    });

    it.each([
      ['no books', []],
      ['books it needs no re-anchoring to', [BEFORE]],
    ])('applies an edit as staged when its command returns %s', async (_case, books) => {
      const { sessions, sessionId, storage } = await sessionGlossingBeta();

      await sessions.edit(sessionId, 'relink', async (buffer) => {
        buffer.put('tokenAnalysisLinks', betaLink(BEFORE, 'ta-2'));
        return books;
      });

      expect(await storedLink(storage)).toEqual(betaLink(BEFORE, 'ta-2'));
    });

    it('stales the links into the books the text lacks', async () => {
      const { sessions, storage } = await sessionGlossingBeta();

      await sessions.reanchorMissingBooks(SOURCE, ['EXO']);

      expect((await storedLink(storage)).status).toBe('stale');
    });

    it('leaves the links into the books holding text', async () => {
      const { sessions, storage } = await sessionGlossingBeta();

      await sessions.reanchorMissingBooks(SOURCE, ['GEN']);

      expect((await storedLink(storage)).status).toBe('approved');
    });

    it('re-anchors in the session turn, after the commands sent before', async () => {
      const { sessions, sessionId, storage } = await sessionGlossingBeta();
      const command = deferred();
      const running = sessions.run(sessionId, () => command.promise);

      const reanchoring = sessions.reanchorBook(SOURCE, AFTER);
      await flushPromises();
      expect((await storedLink(storage)).token.tokenRef).toBe(tokenRefOf(BEFORE, 'beta'));
      command.resolve();
      await Promise.all([running, reanchoring]);

      expect((await storedLink(storage)).token.tokenRef).toBe(tokenRefOf(AFTER, 'beta'));
    });

    it('does nothing for a source with no session open', async () => {
      const { sessions, saveDraft, storage } = makeSessions();
      await saveDraft({
        ...emptyDraft(SOURCE),
        analysis: { ...emptyAnalysis(), tokenAnalysisLinks: [betaLink(BEFORE, 'ta-1')] },
      });

      await sessions.reanchorBook(SOURCE, AFTER);
      await sessions.reanchorMissingBooks(SOURCE, []);

      expect(await storedLink(storage)).toEqual(betaLink(BEFORE, 'ta-1'));
    });

    it("does nothing for a Paratext 9 import's session", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');
      const applied = jest.fn();
      await sessions.run(sessionId, async (session) => {
        jest.spyOn(session.repository, 'apply').mockImplementation(applied);
      });

      await sessions.reanchorBook(SOURCE, AFTER);
      await sessions.reanchorMissingBooks(SOURCE, []);

      expect(applied).not.toHaveBeenCalled();
    });
  });

  describe('settled', () => {
    it("settles once the source's session has run what was sent before", async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      const command = deferred();
      sessions.run(sessionId, () => command.promise);
      let isSettled = false;

      const settling = sessions.settled(SOURCE).then(() => {
        isSettled = true;
        return isSettled;
      });
      await flushPromises();
      expect(isSettled).toBe(false);
      command.resolve();
      await settling;

      expect(isSettled).toBe(true);
    });

    it('settles even when a command sent before fails', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);
      sessions
        .run(sessionId, async () => {
          throw new Error('failed');
        })
        .catch(() => {});

      await expect(sessions.settled(SOURCE)).resolves.toBeUndefined();
    });

    it('settles at once for a source with no session open', async () => {
      await expect(makeSessions().sessions.settled(SOURCE)).resolves.toBeUndefined();
    });
  });

  describe('setAnalysisLanguage', () => {
    it('sets the language the commands sent after it read', async () => {
      const { sessions } = makeSessions();
      const { sessionId } = await sessions.open(SOURCE);

      await sessions.setAnalysisLanguage(sessionId, 'fr');

      await expect(
        sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
      ).resolves.toBe('fr');
    });

    it("sets the language of a Paratext 9 import's session", async () => {
      const { sessions } = makeSessions([makeImport()]);
      const { sessionId } = await sessions.open(SOURCE, 'import-id');

      await sessions.setAnalysisLanguage(sessionId, 'fr');

      await expect(
        sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
      ).resolves.toBe('fr');
    });

    it('refuses a session that is not open', async () => {
      const { sessions } = makeSessions();

      await expect(sessions.setAnalysisLanguage('not-a-session', 'fr')).rejects.toThrow(
        'no session not-a-session is open',
      );
    });
  });
});
