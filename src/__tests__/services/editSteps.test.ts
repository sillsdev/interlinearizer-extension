/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis } from 'interlinearizer';
import { ChangeBuffer } from '../../services/commands/changeBuffer';
import { DraftRepository } from '../../services/draftRepository';
import { catalogStepOf, deletionStepOf, phraseStartOf } from '../../services/editSteps';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  FIXTURE_STAMPS,
  makePhraseLink,
  makeTokenLink,
  memoryStorage,
  silentLogger,
} from '../test-helpers';

function payload(id: string, surfaceText = 'word'): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText };
}

async function bufferOver(analysis: Partial<TextAnalysis>) {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return { buffer: new ChangeBuffer(repository), repository };
}

describe('catalogStepOf', () => {
  const linked: Partial<TextAnalysis> = {
    tokenAnalyses: [payload('ta-a', 'Word'), payload('ta-b')],
    tokenAnalysisLinks: [makeTokenLink('ta-a', 'GEN 1:1:0', { id: 'tl-1' })],
  };

  it("names the row's form and the analysis left holding it", async () => {
    const { buffer } = await bufferOver(linked);
    const stepOf = await catalogStepOf(buffer, 'catalogMerge', 'ta-a');

    expect(stepOf('ta-b')).toStrictEqual({
      summary: {
        kind: 'catalogMerge',
        form: 'Word',
        analysisId: 'ta-a',
        survivingAnalysisId: 'ta-b',
      },
    });
  });

  it('names no surviving analysis when the edit leaves the row none', async () => {
    const { buffer } = await bufferOver(linked);
    const stepOf = await catalogStepOf(buffer, 'catalogEdit', 'ta-a');

    expect(stepOf(undefined)).toStrictEqual({
      summary: { kind: 'catalogEdit', form: 'Word', analysisId: 'ta-a' },
    });
  });
});

describe('deletionStepOf', () => {
  const approved: Partial<TextAnalysis> = {
    tokenAnalyses: [payload('ta-a', 'Word'), payload('ta-b'), payload('ta-unused', 'spare')],
    tokenAnalysisLinks: [
      makeTokenLink('ta-a', 'GEN 1:1:0'),
      makeTokenLink('ta-a', 'GEN 1:2:0'),
      makeTokenLink('ta-b', 'GEN 1:3:0'),
    ],
  };

  it('names the form and how many uses a deleted analysis had', async () => {
    const { buffer, repository } = await bufferOver(approved);

    await expect(deletionStepOf(buffer, repository, ['ta-a'])).resolves.toStrictEqual({
      summary: { kind: 'catalogDelete', form: 'Word', analysisId: 'ta-a', count: 2 },
    });
  });

  it('names a deleted analysis no token used as unused', async () => {
    const { buffer, repository } = await bufferOver(approved);

    await expect(deletionStepOf(buffer, repository, ['ta-unused'])).resolves.toStrictEqual({
      summary: { kind: 'catalogDeleteUnused', form: 'spare', analysisId: 'ta-unused' },
    });
  });

  it('counts the analyses deleted together and the uses they had between them', async () => {
    const { buffer, repository } = await bufferOver(approved);

    await expect(
      deletionStepOf(buffer, repository, ['ta-a', 'ta-b', 'ta-unused']),
    ).resolves.toStrictEqual({
      summary: { kind: 'catalogDeleteChecked', count: 3, usageCount: 3 },
    });
  });
});

describe('phraseStartOf', () => {
  it("places a phrase's step at its first token", async () => {
    const { buffer } = await bufferOver({
      phraseAnalysisLinks: [makePhraseLink('pl', ['GEN 1:1:4', 'GEN 1:1:0'])],
    });

    await expect(phraseStartOf(buffer, 'pl')).resolves.toStrictEqual({ location: 'GEN 1:1:4' });
  });

  it('places a step on a phrase that is not stored nowhere', async () => {
    const { buffer } = await bufferOver({});

    await expect(phraseStartOf(buffer, 'missing')).resolves.toStrictEqual({});
  });
});
