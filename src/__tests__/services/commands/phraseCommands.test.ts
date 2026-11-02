/// <reference types="jest" />

import type { PhraseAnalysisLink, TextAnalysis } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { splitPhrase, writePhraseGloss } from '../../../services/commands/phraseCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, seedRepository, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

function link(id: string, verse: number): PhraseAnalysisLink {
  return {
    id,
    analysisId: 'pa-1',
    ...FIXTURE_STAMPS,
    status: 'approved',
    tokens: [
      { tokenRef: `GEN 1:${verse}:0`, surfaceText: 'In' },
      { tokenRef: `GEN 1:${verse}:1`, surfaceText: 'the' },
    ],
  };
}

async function bufferOver(analysis: Partial<TextAnalysis>): Promise<ChangeBuffer> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await seedRepository(repository, {
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return new ChangeBuffer(repository);
}

describe('writePhraseGloss', () => {
  it('stages nothing for a blank value when the language has no gloss', async () => {
    const buffer = await bufferOver({
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
      phraseAnalysisLinks: [link('pl-1', 1), link('pl-2', 2)],
    });

    await writePhraseGloss(buffer, {
      phraseId: 'pl-1',
      value: '',
      analysisLanguage: 'en',
      forkId: 'fork',
      now: NOW,
    });

    expect(buffer.toChangeSet('writePhraseGloss')).toStrictEqual({ intent: 'writePhraseGloss' });
  });
});

describe('splitPhrase', () => {
  it('stages nothing for an unknown occurrence', async () => {
    const buffer = await bufferOver({ phraseAnalysisLinks: [link('pl-1', 1)] });

    await splitPhrase(buffer, {
      phraseId: 'pl-unknown',
      splitAfterTokenRef: 'GEN 1:1:0',
      tokenDocOrder: new Map(),
      linkId: 'new-link',
      analysisId: 'new-analysis',
      forkId: 'fork',
      now: NOW,
    });

    expect(buffer.toChangeSet('splitPhrase')).toStrictEqual({ intent: 'splitPhrase' });
  });
});
