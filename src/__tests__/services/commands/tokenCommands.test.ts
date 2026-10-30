/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { approveAnalysisForToken, writeGloss } from '../../../services/commands/tokenCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, seedRepository, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';
const STAMP = { analysisId: 'new-analysis', linkId: 'new-link', now: NOW };

const shared: TokenAnalysis = {
  id: 'ta-in',
  ...FIXTURE_STAMPS,
  surfaceText: 'In',
  gloss: { en: 'at' },
};

function link(id: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId: 'ta-in',
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'In' },
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

describe('writeGloss', () => {
  it("stages only the link's removal when clearing a shared payload, never its fork", async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0'), link('tl-2', 'GEN 1:2:0')],
    });

    await writeGloss(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      surfaceText: 'In',
      value: '',
      analysisLanguage: 'en',
    });

    expect(buffer.toChangeSet('writeGloss')).toStrictEqual({
      intent: 'writeGloss',
      tokenAnalysisLinks: { puts: [], deletes: ['tl-1'] },
    });
  });

  it('stages nothing for a blank write to an unglossed token', async () => {
    const buffer = await bufferOver({ tokenAnalyses: [shared] });

    await writeGloss(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      surfaceText: 'In',
      value: ' ',
      analysisLanguage: 'en',
    });

    expect(buffer.toChangeSet('writeGloss')).toStrictEqual({ intent: 'writeGloss' });
  });
});

describe('approveAnalysisForToken', () => {
  it('stages nothing for a payload already approved for the token', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0')],
    });

    await approveAnalysisForToken(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      surfaceText: 'In',
      analysisId: 'ta-in',
    });

    expect(buffer.toChangeSet('approve')).toStrictEqual({ intent: 'approve' });
  });
});
