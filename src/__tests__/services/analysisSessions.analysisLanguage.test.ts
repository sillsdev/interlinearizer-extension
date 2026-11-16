/// <reference types="jest" />

import { AnalysisSessions } from '../../services/analysisSessions';
import { DraftRepository } from '../../services/draftRepository';
import { emptyDraft } from '../../types/empty-factories';
import { memoryStorage, silentLogger } from '../test-helpers';

const SOURCE = 'src-project';

describe('AnalysisSessions.setAnalysisLanguage', () => {
  it.each([
    ['a language its draft lists after the first', 'en'],
    ['the language it is already on', 'fr'],
    ['a language its draft does not list', 'de'],
  ])('sets %s, storing nothing', async (_case, tag) => {
    const { storage, writes } = memoryStorage();
    const logger = silentLogger();
    const draft = { ...emptyDraft(SOURCE), analysisLanguages: ['fr', 'en'] };
    await new DraftRepository(storage, SOURCE, logger).startOver(draft);
    const savedWrites = writes.length;
    const sessions = new AnalysisSessions({
      findProject: async () => undefined,
      openDraftRepository: (sourceProjectId) =>
        new DraftRepository(storage, sourceProjectId, logger),
      releaseDraftRepository: async () => {},
      openPt9ImportRepository: () => {
        throw new Error('no import in this test');
      },
      getInterfaceLanguages: async () => [],
      startTextRead: async () => {},
      stopTextRead: async () => {},
      heldBook: () => undefined,
      getOpenVerseBook: async () => undefined,
      reportChange: () => {},
    });
    const { sessionId } = await sessions.open(SOURCE);

    await sessions.setAnalysisLanguage(sessionId, tag);

    await expect(
      sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
    ).resolves.toBe(tag);
    expect(writes).toHaveLength(savedWrites);
  });

  /** Opens a session over a draft listing French then English, reporting its changes to `reported`. */
  async function openReporting(reported: unknown[]) {
    const { storage } = memoryStorage();
    const logger = silentLogger();
    const draft = { ...emptyDraft(SOURCE), analysisLanguages: ['fr', 'en'] };
    await new DraftRepository(storage, SOURCE, logger).startOver(draft);
    const sessions = new AnalysisSessions({
      findProject: async () => undefined,
      openDraftRepository: (sourceProjectId) =>
        new DraftRepository(storage, sourceProjectId, logger),
      releaseDraftRepository: async () => {},
      openPt9ImportRepository: () => {
        throw new Error('no import in this test');
      },
      getInterfaceLanguages: async () => [],
      startTextRead: async () => {},
      stopTextRead: async () => {},
      heldBook: () => undefined,
      getOpenVerseBook: async () => undefined,
      reportChange: (change) => reported.push(change),
    });
    const { sessionId } = await sessions.open(SOURCE);
    return { sessions, sessionId };
  }

  it('reports a new language as a change naming the catalog and the concordance', async () => {
    const reported: unknown[] = [];
    const { sessions, sessionId } = await openReporting(reported);

    await sessions.setAnalysisLanguage(sessionId, 'en');

    expect(reported).toStrictEqual([
      expect.objectContaining({
        sessionId,
        books: [],
        queries: ['getCatalogRows', 'getConcordance'],
      }),
    ]);
  });

  it('reports nothing for the language the session is already on', async () => {
    const reported: unknown[] = [];
    const { sessions, sessionId } = await openReporting(reported);

    await sessions.setAnalysisLanguage(sessionId, 'fr');

    expect(reported).toStrictEqual([]);
  });
});
