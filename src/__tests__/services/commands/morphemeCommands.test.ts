/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  deleteMorphemes,
  writeMorphemeGloss,
  writeMorphemes,
} from '../../../services/commands/morphemeCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';
const STAMP = { analysisId: 'new-analysis', linkId: 'new-link', now: NOW };

const shared: TokenAnalysis = {
  id: 'ta-cats',
  ...FIXTURE_STAMPS,
  surfaceText: 'cats',
  morphemes: [
    { id: 'm-cat', form: 'cat', writingSystem: 'en' },
    { id: 'm-s', form: '-s', writingSystem: 'en' },
  ],
};

function link(id: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId: 'ta-cats',
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'cats' },
  };
}

async function bufferOver(analysis: Partial<TextAnalysis>): Promise<ChangeBuffer> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return new ChangeBuffer(repository);
}

describe('writeMorphemes', () => {
  it('stages only the link when a re-split leaves a shared breakdown unchanged', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0'), link('tl-2', 'GEN 1:2:0')],
    });

    await writeMorphemes(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      surfaceText: 'cats',
      writingSystem: 'en',
      morphemes: [
        { id: 'new-m-0', form: 'cat' },
        { id: 'new-m-1', form: '-s' },
      ],
    });

    expect(buffer.toChangeSet('writeMorphemes')).toStrictEqual({
      intent: 'writeMorphemes',
      tokenAnalysisLinks: {
        puts: [{ ...link('tl-1', 'GEN 1:1:0'), updatedAt: NOW }],
        deletes: [],
      },
    });
  });
});

describe('writeMorphemeGloss', () => {
  it('stages nothing for a token with no approved analysis', async () => {
    const buffer = await bufferOver({ tokenAnalyses: [shared] });

    await writeMorphemeGloss(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      morphemeId: 'm-cat',
      value: 'feline',
      analysisLanguage: 'en',
    });

    expect(buffer.toChangeSet('writeMorphemeGloss')).toStrictEqual({
      intent: 'writeMorphemeGloss',
    });
  });

  it('stages only the link when a gloss leaves a shared breakdown unchanged', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0'), link('tl-2', 'GEN 1:2:0')],
    });

    await writeMorphemeGloss(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      morphemeId: 'm-cat',
      value: '',
      analysisLanguage: 'en',
    });

    expect(buffer.toChangeSet('writeMorphemeGloss')).toStrictEqual({
      intent: 'writeMorphemeGloss',
      tokenAnalysisLinks: {
        puts: [{ ...link('tl-1', 'GEN 1:1:0'), updatedAt: NOW }],
        deletes: [],
      },
    });
  });

  it('stages nothing for a morpheme the breakdown lacks', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0')],
    });

    await writeMorphemeGloss(buffer, {
      ...STAMP,
      tokenRef: 'GEN 1:1:0',
      morphemeId: 'm-missing',
      value: 'feline',
      analysisLanguage: 'en',
    });

    expect(buffer.toChangeSet('writeMorphemeGloss')).toStrictEqual({
      intent: 'writeMorphemeGloss',
    });
  });
});

describe('deleteMorphemes', () => {
  it("stages only the link's removal when stripping a shared payload empties it", async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [shared],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0'), link('tl-2', 'GEN 1:2:0')],
    });

    await deleteMorphemes(buffer, { ...STAMP, tokenRef: 'GEN 1:1:0' });

    expect(buffer.toChangeSet('deleteMorphemes')).toStrictEqual({
      intent: 'deleteMorphemes',
      tokenAnalysisLinks: { puts: [], deletes: ['tl-1'] },
    });
  });

  it('stages nothing for a payload with no breakdown', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [{ ...shared, morphemes: undefined, gloss: { en: 'cats' } }],
      tokenAnalysisLinks: [link('tl-1', 'GEN 1:1:0')],
    });

    await deleteMorphemes(buffer, { ...STAMP, tokenRef: 'GEN 1:1:0' });

    expect(buffer.toChangeSet('deleteMorphemes')).toStrictEqual({ intent: 'deleteMorphemes' });
  });
});
