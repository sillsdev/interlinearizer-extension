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
          { id: 'ta-land', ...FIXTURE_STAMPS, surfaceText: 'earth', gloss: { en: 'land' } },
        ],
        tokenAnalysisLinks: [
          makeTokenLink('ta-land', ref('earth'), { surfaceText: 'earth', id: 'tl-land' }),
        ],
      },
    };
    const getProject = jest.fn(async () => saved);
    const { edits, sessionId, sessions } = await handlersOver({ getProject });
    await saveToProject(sessions, sessionId);

    await edits['interlinearizer.discardAll']({ sessionId });

    expect(getProject).toHaveBeenCalledWith('proj-1');
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toStrictEqual([{ en: 'land' }]);
  });

  it('refuses a discard when the project that the draft saves to is not stored', async () => {
    const { edits, sessionId, sessions } = await handlersOver();
    await saveToProject(sessions, sessionId);

    await expect(edits['interlinearizer.discardAll']({ sessionId })).rejects.toThrow(
      'interlinear project proj-1 is not stored',
    );
  });

  it("restores the project's analysis languages when every change is discarded, undoably", async () => {
    const { edits, sessionId, sessions } = await handlersOver({
      getProject: async () => ({ ...makeStubProject('proj-1'), analysisLanguages: ['de'] }),
    });
    await saveToProject(sessions, sessionId);
    await edits['interlinearizer.changeAnalysisLanguages']({
      sessionId,
      analysisLanguages: ['fr'],
    });
    const wholeDraft = () =>
      sessions.run(sessionId, (session) => session.repository.getWholeDraft());

    await edits['interlinearizer.discardAll']({ sessionId });

    expect(await wholeDraft()).toMatchObject({ analysisLanguages: ['de'], dirty: false });

    await sessions.undo(sessionId);

    expect(await wholeDraft()).toMatchObject({ analysisLanguages: ['fr'], dirty: true });
  });

  it("changes the draft's languages alone as a step that marks the draft unsaved", async () => {
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
    expect(draft.dirty).toBe(true);
  });

  it("moves a tag's glosses with the languages as one step that marks the draft unsaved", async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    const reply = JSON.parse(
      await edits['interlinearizer.changeAnalysisLanguages']({
        sessionId,
        analysisLanguages: ['es'],
        retag: { from: 'en', to: 'es' },
      }),
    );

    const moved = {
      words: 1,
      morphemes: 0,
      freeTranslations: 0,
      skipped: { glosses: 0, freeTranslations: 0 },
    };
    expect(reply.glossRetag).toStrictEqual(moved);
    expect(reply.step).toStrictEqual({
      summary: {
        kind: 'retagGlosses',
        from: 'en',
        to: 'es',
        words: 1,
        morphemes: 0,
        freeTranslations: 0,
      },
    });
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['es']);
    expect(draft.analysis.tokenAnalyses.map((ta) => ta.gloss)).toStrictEqual([{ es: 'God' }]);
    expect(draft.dirty).toBe(true);
  });

  it("deletes a tag's glosses with the languages as one step that marks the draft unsaved", async () => {
    const { edits, sessionId, sessions } = await handlersOver();

    const reply = JSON.parse(
      await edits['interlinearizer.changeAnalysisLanguages']({
        sessionId,
        analysisLanguages: ['es'],
        deleteTextOf: 'en',
      }),
    );

    expect(reply.deletedText).toStrictEqual({ glosses: 1, freeTranslations: 0 });
    expect(reply.step).toStrictEqual({
      summary: { kind: 'deleteLanguageText', tag: 'en', glosses: 1, freeTranslations: 0 },
    });
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['es']);
    expect(draft.analysis.tokenAnalyses).toStrictEqual([]);
    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([]);
    expect(draft.dirty).toBe(true);
  });

  it.each([
    ['no languages', { analysisLanguages: [] }, 'needs an analysis language'],
    [
      'a move onto the same tag',
      { analysisLanguages: ['en'], retag: { from: 'en', to: 'en' } },
      'cannot move from en to itself',
    ],
    [
      'both a move and a deletion',
      { analysisLanguages: ['es'], retag: { from: 'en', to: 'es' }, deleteTextOf: 'fr' },
      'either moves text or deletes it',
    ],
  ])('refuses a change of languages with %s', async (_case, args, message) => {
    const { edits, sessionId } = await handlersOver();

    await expect(
      edits['interlinearizer.changeAnalysisLanguages']({ sessionId, ...args }),
    ).rejects.toThrow(message);
  });

  it('logs a refused change of languages with the error it rejects with', async () => {
    const { edits, sessionId, host } = await handlersOver();
    const change = edits['interlinearizer.changeAnalysisLanguages']({
      sessionId,
      analysisLanguages: [],
    });

    await expect(change).rejects.toThrow('needs an analysis language');
    expect(host.logger.error).toHaveBeenCalledWith(
      `Interlinearizer: failed to changeAnalysisLanguages in session ${sessionId}`,
      await change.catch((e: unknown) => e),
    );
  });

  it.each([
    ['a move', { retag: { from: 'en', to: 'es' } }],
    ['a deletion', { deleteTextOf: 'en' }],
  ])('refuses %s of language text while a book cannot be read', async (_case, change) => {
    const { edits, sessionId, sessions } = await handlersOver();
    const { repository } = await sessions.run(sessionId, async (session) => session);
    const read = repository.getDraftState.bind(repository);
    jest
      .spyOn(repository, 'getDraftState')
      .mockImplementation(async () => ({ ...(await read()), unreadableBooks: ['GEN'] }));

    await expect(
      edits['interlinearizer.changeAnalysisLanguages']({
        sessionId,
        analysisLanguages: ['es'],
        ...change,
      }),
    ).rejects.toThrow('while GEN cannot be read');
    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['en']);
  });

  it('changes the language list alone while a book cannot be read', async () => {
    const { edits, sessionId, sessions } = await handlersOver();
    const { repository } = await sessions.run(sessionId, async (session) => session);
    const read = repository.getDraftState.bind(repository);
    jest
      .spyOn(repository, 'getDraftState')
      .mockImplementation(async () => ({ ...(await read()), unreadableBooks: ['GEN'] }));

    await edits['interlinearizer.changeAnalysisLanguages']({
      sessionId,
      analysisLanguages: ['es', 'en'],
    });

    const draft = await sessions.run(sessionId, (session) => session.repository.getWholeDraft());
    expect(draft.analysisLanguages).toStrictEqual(['es', 'en']);
  });

  it("counts the draft's text under each tag that has any", async () => {
    const { edits, sessionId } = await handlersOver();

    const counts = JSON.parse(await edits['interlinearizer.countLanguageText']({ sessionId }));

    expect(counts).toStrictEqual({ en: { glosses: 1, freeTranslations: 0 } });
  });

  it('logs and rethrows a count for a session that is not open', async () => {
    const { edits, host } = await handlersOver();

    await expect(
      edits['interlinearizer.countLanguageText']({ sessionId: 'no-such-session' }),
    ).rejects.toThrow();
    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to count language text in session no-such-session',
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

  describe("a catalog edit's outcome", () => {
    const laterAnd = BOOK.segments[2].tokens.find((token) => token.surfaceText === 'And')?.ref;
    /** `ta-and` glossed "and" at the first And, and `ta-then` glossed "then" at the later one. */
    const TWO_ANDS: Partial<TextAnalysis> = {
      tokenAnalyses: [
        { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'And', gloss: { en: 'and' } },
        { id: 'ta-then', ...FIXTURE_STAMPS, surfaceText: 'And', gloss: { en: 'then' } },
      ],
      tokenAnalysisLinks: [
        makeTokenLink('ta-and', ref('And'), { surfaceText: 'And', id: 'tl-and' }),
        makeTokenLink('ta-then', laterAnd ?? '', { surfaceText: 'And', id: 'tl-then' }),
      ],
    };

    it('is an edit in place when the record stands', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_ANDS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-then',
          value: 'so',
        }),
      );

      expect(reply.outcome).toStrictEqual({ kind: 'edited' });
    });

    it("is a merge, with the survivor's gloss and uses, when the record collapses into a sibling", async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_ANDS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-then',
          value: 'and',
        }),
      );

      expect(reply.outcome).toStrictEqual({
        kind: 'merged',
        survivingAnalysisId: 'ta-and',
        survivingGloss: 'and',
        survivingUsageCount: 2,
      });
    });

    it('is a removal when the edit empties the record', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, TWO_ANDS);

      const reply = JSON.parse(
        await edits['interlinearizer.writeAnalysisGloss']({
          sessionId,
          analysisId: 'ta-then',
          value: '',
        }),
      );

      expect(reply.outcome).toStrictEqual({ kind: 'removed' });
    });

    it('is a removal when unlinking the sense empties the record', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        ...TWO_ANDS,
        tokenAnalyses: [
          { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'And', gloss: { en: 'and' } },
          {
            id: 'ta-then',
            ...FIXTURE_STAMPS,
            surfaceText: 'And',
            glossSenseRef: { authority: 'x-test', senseId: 'sense-then' },
          },
        ],
      });

      const reply = JSON.parse(
        await edits['interlinearizer.unlinkAnalysisSense']({ sessionId, analysisId: 'ta-then' }),
      );

      expect(reply.outcome).toStrictEqual({ kind: 'removed' });
    });
  });

  describe('previewBreakdownEdit', () => {
    const laterAnd = BOOK.segments[2].tokens.find((token) => token.surfaceText === 'And')?.ref;
    const MORPHEMES = [{ id: 'm-1', form: 'And', writingSystem: 'en', gloss: { en: 'and' } }];

    it('says that a token alone holding a glossed breakdown would lose it on a reset', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        tokenAnalyses: [
          { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'And', morphemes: MORPHEMES },
        ],
        tokenAnalysisLinks: [makeTokenLink('ta-and', ref('And'), { surfaceText: 'And' })],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('And'),
      });

      expect(JSON.parse(preview)).toStrictEqual({ solelyOwned: true, resetLosesAnnotation: true });
    });

    it('says that a token sharing its payload loses nothing, its edit forking the payload', async () => {
      const { edits, sessionId } = await handlersOver({}, BOOK, {
        tokenAnalyses: [
          { id: 'ta-and', ...FIXTURE_STAMPS, surfaceText: 'And', morphemes: MORPHEMES },
        ],
        tokenAnalysisLinks: [
          makeTokenLink('ta-and', ref('And'), { surfaceText: 'And', id: 'tl-1' }),
          makeTokenLink('ta-and', laterAnd ?? '', { surfaceText: 'And', id: 'tl-2' }),
        ],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('And'),
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
            id: 'ta-and',
            ...FIXTURE_STAMPS,
            surfaceText: 'And',
            morphemes: [{ id: 'm-1', form: 'And', writingSystem: 'en' }],
          },
        ],
        tokenAnalysisLinks: [makeTokenLink('ta-and', ref('And'), { surfaceText: 'And' })],
      });

      const preview = await edits['interlinearizer.previewBreakdownEdit']({
        sessionId,
        tokenRef: ref('And'),
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
