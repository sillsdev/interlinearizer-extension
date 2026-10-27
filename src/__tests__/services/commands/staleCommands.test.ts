/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  discardStaleAnalysis,
  discardStaleFreeTranslation,
  keepStaleFreeTranslation,
  reapplyStaleAnalysis,
} from '../../../services/commands/staleCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

const approved: Partial<TextAnalysis> = {
  tokenAnalyses: [{ id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
  tokenAnalysisLinks: [
    {
      id: 'tl-in',
      analysisId: 'ta-in',
      ...FIXTURE_STAMPS,
      status: 'approved',
      token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
    },
  ],
  segmentAnalyses: [
    { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning', freeTranslation: {} },
  ],
  segmentAnalysisLinks: [
    { id: 'sl-1', analysisId: 'sa-1', ...FIXTURE_STAMPS, status: 'approved', segmentId: 'GEN 1:1' },
  ],
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

describe('stale commands over records that are not stale', () => {
  const commands: [string, (buffer: ChangeBuffer) => Promise<void>][] = [
    [
      'discardStaleAnalysis',
      (buffer) => discardStaleAnalysis(buffer, { analysisId: 'ta-in', tokenRef: 'GEN 1:1:0' }),
    ],
    [
      'reapplyStaleAnalysis',
      (buffer) =>
        reapplyStaleAnalysis(buffer, {
          analysisId: 'ta-in',
          staleTokenRef: 'GEN 1:1:0',
          tokenRef: 'GEN 1:2:0',
          surfaceText: 'In',
          copyId: 'new-analysis',
          linkId: 'new-link',
          now: NOW,
        }),
    ],
    [
      'keepStaleFreeTranslation',
      (buffer) =>
        keepStaleFreeTranslation(buffer, {
          analysisId: 'sa-1',
          segmentId: 'GEN 1:2',
          surfaceText: 'And the earth',
          now: NOW,
        }),
    ],
    [
      'discardStaleFreeTranslation',
      (buffer) => discardStaleFreeTranslation(buffer, { analysisId: 'sa-1' }),
    ],
  ];

  it.each(commands)('%s stages nothing', async (intent, command) => {
    const buffer = await bufferOver(approved);

    await command(buffer);

    expect(buffer.toChangeSet(intent)).toStrictEqual({ intent });
  });
});
