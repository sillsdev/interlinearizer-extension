import type { Book, TextAnalysis } from 'interlinearizer';
import { sessionEditHandlers, type SessionEditHost } from '../../services/sessionEditHandlers';
import { BOOK, GLOSSED, ref, sessionOver } from '../cache/session-source';
import { FIXTURE_STAMPS, makeStubProject, makeTokenLink } from '../test-helpers';

/** Handlers over a session on {@link GLOSSED}, reading `book` for GEN unless a test overrides it. */
async function handlersOver(
  overrides: Partial<SessionEditHost> = {},
  book: Book = BOOK,
  analysis: Partial<TextAnalysis> = GLOSSED,
) {
  const made = await sessionOver(analysis);
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

  describe("a catalog edit's outcome", () => {
    const laterGod = BOOK.segments[2].tokens.find((token) => token.surfaceText === 'God')?.ref;
    /** `ta-god` glossed "God" at the first God, and `ta-deity` glossed "Deity" at the later one. */
    const TWO_GODS: Partial<TextAnalysis> = {
      tokenAnalyses: [
        { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } },
        { id: 'ta-deity', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'Deity' } },
      ],
      tokenAnalysisLinks: [
        makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' }),
        makeTokenLink('ta-deity', laterGod ?? '', { surfaceText: 'God', id: 'tl-deity' }),
      ],
    };

    it('is an edit in place when the record stands', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_GODS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-deity',
          value: 'Lord',
        }),
      );

      expect(reply.outcome).toStrictEqual({ kind: 'edited' });
    });

    it("is a merge, with the survivor's gloss and uses, when the record collapses into a sibling", async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_GODS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-deity',
          value: 'God',
        }),
      );

      expect(reply.outcome).toStrictEqual({
        kind: 'merged',
        survivingAnalysisId: 'ta-god',
        survivingGloss: 'God',
        survivingUsageCount: 2,
      });
    });

    it('is a removal when the edit empties the record', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_GODS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-deity',
          value: '',
        }),
      );

      expect(reply.outcome).toStrictEqual({ kind: 'removed' });
    });
  });

  describe('previewBreakdownEdit', () => {
    const laterGod = BOOK.segments[2].tokens.find((token) => token.surfaceText === 'God')?.ref;
    const MORPHEMES = [{ id: 'm-1', form: 'God', writingSystem: 'en', gloss: { en: 'deity' } }];

    it('says that a token alone holding a glossed breakdown would lose it on a reset', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        tokenAnalyses: [
          { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', morphemes: MORPHEMES },
        ],
        tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God' })],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('God'),
      });

      expect(JSON.parse(preview)).toStrictEqual({ solelyOwned: true, resetLosesAnnotation: true });
    });

    it('says that a token sharing its payload loses nothing, its edit forking the payload', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        tokenAnalyses: [
          { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', morphemes: MORPHEMES },
        ],
        tokenAnalysisLinks: [
          makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-1' }),
          makeTokenLink('ta-god', laterGod ?? '', { surfaceText: 'God', id: 'tl-2' }),
        ],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('God'),
      });

      expect(JSON.parse(preview)).toStrictEqual({
        solelyOwned: false,
        resetLosesAnnotation: false,
      });
    });

    it('says that a token alone holding an unglossed breakdown loses nothing on a reset', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        tokenAnalyses: [
          {
            id: 'ta-god',
            ...FIXTURE_STAMPS,
            surfaceText: 'God',
            morphemes: [{ id: 'm-1', form: 'God', writingSystem: 'en' }],
          },
        ],
        tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God' })],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('God'),
      });

      expect(JSON.parse(preview)).toStrictEqual({ solelyOwned: true, resetLosesAnnotation: false });
    });

    it('says that a token with no approved analysis owns nothing', async () => {
      const { edits, sessionId } = await handlersOver();

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('earth'),
      });

      expect(JSON.parse(preview)).toStrictEqual({
        solelyOwned: false,
        resetLosesAnnotation: false,
      });
    });
  });

  describe('previewBreakdownEdit, further', () => {
    it('says that a token alone holding no breakdown loses nothing on a reset', async () => {
      const { edits, sessionId } = await handlersOver();

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('God'),
      });

      expect(JSON.parse(preview)).toStrictEqual({ solelyOwned: true, resetLosesAnnotation: false });
    });

    it('logs a preview in a session that is not open before rethrowing', async () => {
      const { edits, host } = await handlersOver();

      await expect(
        edits['interlinearizer.previewBreakdownEdit']({ sessionId: 'gone', tokenRef: ref('God') }),
      ).rejects.toThrow();
      expect(host.logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to preview a breakdown edit in session gone',
        expect.any(Error),
      );
    });
  });
});
