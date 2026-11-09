import type { Book } from 'interlinearizer';
import { sessionEditHandlers, type SessionEditHost } from '../../services/sessionEditHandlers';
import { BOOK, GLOSSED, ref, sessionOver } from '../cache/session-source';

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
