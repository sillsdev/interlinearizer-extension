/// <reference types="jest" />

import { AnalysisSessions } from '../../services/analysisSessions';
import { DraftRepository } from '../../services/draftRepository';
import reducer, { selectAnalysisLanguage, setAnalysisLanguage } from '../../store/analysisSlice';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { memoryStorage, silentLogger } from '../test-helpers';

const SOURCE = 'src-project';

describe('setAnalysisLanguage parity with the reducer', () => {
  it.each([
    ['a language its draft lists after the first', 'en'],
    ['the language it is already on', 'fr'],
    ['a language its draft does not list', 'de'],
  ])('sets %s as the reducer does, storing nothing', async (_case, tag) => {
    const { storage, writes } = memoryStorage();
    const logger = silentLogger();
    const draft = { ...emptyDraft(SOURCE), analysisLanguages: ['fr', 'en'] };
    await new DraftRepository(storage, SOURCE, logger).replaceAll(draft);
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
    });
    const { sessionId } = await sessions.open(SOURCE);

    const state = reducer(
      { analysis: emptyAnalysis(), analysisLanguage: 'fr' },
      setAnalysisLanguage(tag),
    );
    await sessions.setAnalysisLanguage(sessionId, tag);

    await expect(
      sessions.run(sessionId, async ({ analysisLanguage }) => analysisLanguage),
    ).resolves.toBe(selectAnalysisLanguage(state));
    expect(writes).toHaveLength(savedWrites);
  });
});
