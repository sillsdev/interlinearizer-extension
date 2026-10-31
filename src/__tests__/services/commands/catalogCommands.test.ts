/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import {
  clearAnalysisGlosses,
  confirmAnalysisMorphemes,
  deleteAnalyses,
  mergeAnalysesInto,
  writeAnalysisGloss,
  writeAnalysisMorphemeGloss,
  writeAnalysisMorphemes,
} from '../../../services/commands/catalogCommands';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

const LINK: TokenAnalysisLink = {
  id: 'tl-in',
  analysisId: 'ta-in',
  ...FIXTURE_STAMPS,
  status: 'approved',
  token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
};

const glossed: Partial<TextAnalysis> = {
  tokenAnalyses: [{ id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
  tokenAnalysisLinks: [LINK],
};

async function bufferOver(analysis: Partial<TextAnalysis>): Promise<ChangeBuffer> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return new ChangeBuffer(repository);
}

describe('catalog commands over an analysis that is not stored', () => {
  const commands: [string, (buffer: ChangeBuffer) => Promise<unknown>][] = [
    [
      'writeAnalysisGloss',
      (buffer) =>
        writeAnalysisGloss(buffer, {
          analysisId: 'ta-missing',
          value: 'in',
          analysisLanguage: 'en',
          now: NOW,
        }),
    ],
    [
      'clearAnalysisGlosses',
      (buffer) =>
        clearAnalysisGlosses(buffer, {
          analysisIds: ['ta-missing'],
          analysisLanguage: 'en',
          now: NOW,
        }),
    ],
    [
      'writeAnalysisMorphemes',
      (buffer) =>
        writeAnalysisMorphemes(buffer, {
          analysisId: 'ta-missing',
          morphemes: [{ id: 'm-new', form: 'in' }],
          writingSystem: 'qaa',
          now: NOW,
        }),
    ],
    [
      'confirmAnalysisMorphemes',
      (buffer) => confirmAnalysisMorphemes(buffer, { analysisId: 'ta-missing', now: NOW }),
    ],
    [
      'writeAnalysisMorphemeGloss',
      (buffer) =>
        writeAnalysisMorphemeGloss(buffer, {
          analysisId: 'ta-missing',
          morphemeId: 'm-in',
          value: 'in',
          analysisLanguage: 'en',
          now: NOW,
        }),
    ],
    ['deleteAnalyses', (buffer) => deleteAnalyses(buffer, { analysisIds: ['ta-missing'] })],
    [
      'mergeAnalysesInto',
      (buffer) =>
        mergeAnalysesInto(buffer, {
          survivorAnalysisId: 'ta-missing',
          mergedAnalysisIds: ['ta-in'],
          content: { gloss: 'in', morphemes: [] },
          analysisLanguage: 'en',
          now: NOW,
        }),
    ],
  ];

  it.each(commands)('%s stages nothing', async (intent, command) => {
    const buffer = await bufferOver(glossed);

    await command(buffer);

    expect(buffer.toChangeSet(intent)).toStrictEqual({ intent });
  });
});

describe('writeAnalysisGloss', () => {
  it('returns the analysis itself when the write keeps it', async () => {
    const buffer = await bufferOver(glossed);

    await expect(
      writeAnalysisGloss(buffer, {
        analysisId: 'ta-in',
        value: 'into',
        analysisLanguage: 'en',
        now: NOW,
      }),
    ).resolves.toBe('ta-in');
  });

  it('returns the payload that an unused analysis was folded into', async () => {
    const buffer = await bufferOver({
      ...glossed,
      tokenAnalyses: [
        ...(glossed.tokenAnalyses ?? []),
        { id: 'ta-spare', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'on' } },
      ],
    });

    await expect(
      writeAnalysisGloss(buffer, {
        analysisId: 'ta-spare',
        value: 'at',
        analysisLanguage: 'en',
        now: NOW,
      }),
    ).resolves.toBe('ta-in');
  });

  it('returns nothing when the write empties the analysis', async () => {
    const buffer = await bufferOver(glossed);

    await expect(
      writeAnalysisGloss(buffer, {
        analysisId: 'ta-in',
        value: '',
        analysisLanguage: 'en',
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('deleteAnalyses', () => {
  it('stages removing the links to an analysis that is not stored', async () => {
    const buffer = await bufferOver({
      tokenAnalysisLinks: [{ ...LINK, analysisId: 'ta-missing' }],
    });

    await deleteAnalyses(buffer, { analysisIds: ['ta-missing'] });

    expect(buffer.toChangeSet('deleteAnalyses')).toStrictEqual({
      intent: 'deleteAnalyses',
      tokenAnalysisLinks: { puts: [], deletes: ['tl-in'] },
    });
  });
});

describe('clearAnalysisGlosses', () => {
  it('names the analyses it left empty, and not those it merged or never found', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [
        { id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } },
        { id: 'ta-in-2', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'in', fr: 'dans' } },
        { id: 'ta-in-3', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { fr: 'dans' } },
      ],
      tokenAnalysisLinks: [LINK],
    });

    await expect(
      clearAnalysisGlosses(buffer, {
        analysisIds: ['ta-in', 'ta-in-2', 'ta-missing'],
        analysisLanguage: 'en',
        now: NOW,
      }),
    ).resolves.toStrictEqual(['ta-in']);
  });
});
