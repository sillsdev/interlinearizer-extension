import type { Book } from 'interlinearizer';
import { sessionEditHandlers, type SessionEditHost } from '../../services/sessionEditHandlers';
import { BOOK, GLOSSED, ref, sessionOver } from '../cache/session-source';
import { FIXTURE_STAMPS, makeStubProject, makeTokenLink } from '../test-helpers';

/** Handlers over a session on {@link GLOSSED}, reading `book` for GEN unless a test overrides it. */
async function handlersOver(overrides: Partial<SessionEditHost> = {}, book: Book = BOOK) {
  const made = await sessionOver(GLOSSED);
  const host: SessionEditHost = {
    sessions: made.sessions,
    logger: { error: jest.fn() },
    getSegmentedBook: async () => book,
    getVerseBook: async () => book,
    getProject: async () => undefined,
    ...overrides,
  };
  return { ...made, host, edits: sessionEditHandlers(host) };
}

/** Points the session's draft at saving to the interlinear project `proj-1`. */
async function saveToProject(
  sessions: Awaited<ReturnType<typeof handlersOver>>['sessions'],
  sessionId: string,
) {
  await sessions.run(sessionId, async (session) => {
    session.scope = { kind: 'draft', sourceProjectId: 'src', interlinearProjectId: 'proj-1' };
  });
}

describe('sessionEditHandlers', () => {
  it("writes a gloss in the session's analysis language", async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    await edits['interlinearizer.writeGloss']({
      sessionId,
      tokenRef: ref('earth'),
      surfaceText: 'earth',
      value: 'land',
    });

    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toContainEqual({ en: 'land' });
  });

  it("refuses a phrase whose tokens span the segments of the host's book", async () => {
    const { edits, sessionId } = await handlersOver();

    await expect(
      edits['interlinearizer.createPhrase']({
        sessionId,
        tokens: [
          { tokenRef: ref('God'), surfaceText: 'God' },
          { tokenRef: ref('And'), surfaceText: 'And' },
        ],
      }),
    ).rejects.toThrow('must lie within one segment');
  });

  it('refuses a phrase in a book the host has no text for', async () => {
    const { edits, sessionId } = await handlersOver({ getSegmentedBook: async () => undefined });

    await expect(
      edits['interlinearizer.createPhrase']({
        sessionId,
        tokens: [{ tokenRef: ref('God'), surfaceText: 'God' }],
      }),
    ).rejects.toThrow('project src has no text for book GEN');
  });

  it('refuses to split a phrase in a book the host has no text for', async () => {
    const { edits, sessionId } = await handlersOver({ getVerseBook: async () => undefined });

    await expect(
      edits['interlinearizer.splitPhrase']({
        sessionId,
        phraseId: 'pl-1',
        splitAfterTokenRef: ref('God'),
      }),
    ).rejects.toThrow('project src has no text for book GEN');
  });

  it('empties a draft that saves to no project when its changes are discarded', async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    await edits['interlinearizer.discardAll']({ sessionId });

    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysis.tokenAnalyses).toStrictEqual([]);
  });

  it('restores what the project that the draft saves to holds when its changes are discarded', async () => {
    const saved = {
      ...makeStubProject('proj-1'),
      analysis: {
        ...makeStubProject().analysis,
        tokenAnalyses: [
          { id: 'ta-deity', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'Deity' } },
        ],
        tokenAnalysisLinks: [
          makeTokenLink('ta-deity', ref('God'), { surfaceText: 'God', id: 'tl-deity' }),
        ],
      },
    };
    const getProject = jest.fn(async () => saved);
    const { edits, sessionId, sessions } = await handlersOver({ getProject });
    await saveToProject(sessions, sessionId);

    await edits['interlinearizer.discardAll']({ sessionId });

    expect(getProject).toHaveBeenCalledWith('proj-1');
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toStrictEqual([{ en: 'Deity' }]);
  });

  it('refuses a discard when the project that the draft saves to is not stored', async () => {
    const { edits, sessionId, sessions } = await handlersOver();
    await saveToProject(sessions, sessionId);

    await expect(edits['interlinearizer.discardAll']({ sessionId })).rejects.toThrow(
      'interlinear project proj-1 is not stored',
    );
  });

  it("changes the draft's languages alone as a step that leaves the unsaved mark as it was", async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    const reply = JSON.parse(
      await edits['interlinearizer.changeAnalysisLanguages']({
        sessionId,
        analysisLanguages: ['es', 'en'],
      }),
    );

    expect(reply.step).toStrictEqual({ summary: { kind: 'changeAnalysisLanguages' } });
    expect(reply.glossRetag).toBeUndefined();
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['es', 'en']);
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toStrictEqual([{ en: 'God' }]);
    expect(draft.dirty).toBe(false);
  });

  it("moves the old tag's glosses with the languages as one step that marks the draft unsaved", async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    const reply = JSON.parse(
      await edits['interlinearizer.changeAnalysisLanguages']({
        sessionId,
        analysisLanguages: ['es'],
        retagFrom: 'en',
      }),
    );

    const moved = { words: 1, morphemes: 0, skipped: 0 };
    expect(reply.glossRetag).toStrictEqual(moved);
    expect(reply.step).toStrictEqual({
      summary: { kind: 'retagGlosses', from: 'en', to: 'es', words: 1, morphemes: 0 },
    });
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['es']);
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toStrictEqual([{ es: 'God' }]);
    expect(draft.dirty).toBe(true);
  });

  it.each([
    ['no languages', { analysisLanguages: [] }, 'needs an analysis language'],
    [
      'a move onto the same tag',
      { analysisLanguages: ['en'], retagFrom: 'en' },
      'cannot move from en to itself',
    ],
  ])('refuses and logs a change of languages with %s', async (_case, args, message) => {
    const { edits, sessionId, host } = await handlersOver();

    await expect(
      edits['interlinearizer.changeAnalysisLanguages']({ sessionId, ...args }),
    ).rejects.toThrow(message);
    expect(host.logger.error).toHaveBeenCalledWith(
      `Interlinearizer: failed to changeAnalysisLanguages in session ${sessionId}`,
      expect.anything(),
    );
  });

  it('logs an edit that fails before rethrowing it', async () => {
    const { edits, host } = await handlersOver();

    await expect(
      edits['interlinearizer.deletePhrase']({ sessionId: 'no-such-session', phraseId: 'pl-1' }),
    ).rejects.toThrow();

    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to deletePhrase in session no-such-session',
      expect.anything(),
    );
  });
});
