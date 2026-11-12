/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { changeAnalysisLanguages } from '../../../services/commands/languageCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, seedRepository, silentLogger } from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';

function approved(id: string, analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'fish' },
  };
}

/** A repository holding a draft in `en` over `analysis`. */
async function repositoryOver(analysis: Partial<TextAnalysis>): Promise<DraftRepository> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await seedRepository(repository, {
    ...emptyDraft('src'),
    analysisLanguages: ['en'],
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return repository;
}

/** Stages the change over `repository`'s stored draft, applies it, and reads the draft back. */
async function change(
  repository: DraftRepository,
  analysisLanguages: string[],
  retagFrom?: string,
) {
  const buffer = new ChangeBuffer(repository);
  const { draft } = await repository.exportAll();
  const counts = await changeAnalysisLanguages(buffer, draft.analysis, {
    analysisLanguages,
    retagFrom,
    now: NOW,
  });
  await repository.apply(buffer.toChangeSet('changeAnalysisLanguages'));
  return { counts, draft: await repository.getWholeDraft() };
}

describe('changeAnalysisLanguages', () => {
  it('gives the draft the new languages and moves no glosses without a tag to move', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'fish' } },
      ],
    });

    const { counts, draft } = await change(repository, ['es', 'en']);

    expect(counts).toBeUndefined();
    expect(draft.analysisLanguages).toEqual(['es', 'en']);
    expect(draft.analysis.tokenAnalyses[0].gloss).toEqual({ en: 'fish' });
  });

  it('moves the glosses under the old tag to the new primary language', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        {
          id: 'ta-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'fish',
          gloss: { en: 'fish' },
          morphemes: [{ id: 'm-1', form: 'fish', writingSystem: 'x', gloss: { en: 'fish' } }],
        },
      ],
      phraseAnalyses: [
        { id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { en: 'whale' } },
      ],
    });

    const { counts, draft } = await change(repository, ['es'], 'en');

    expect(counts).toEqual({ words: 2, morphemes: 1, skipped: 0 });
    expect(draft.analysisLanguages).toEqual(['es']);
    const [token] = draft.analysis.tokenAnalyses;
    expect(token).toMatchObject({ gloss: { es: 'fish' }, updatedAt: NOW });
    expect(token.morphemes?.[0].gloss).toEqual({ es: 'fish' });
    expect(draft.analysis.phraseAnalyses[0].gloss).toEqual({ es: 'whale' });
  });

  it('folds an analysis the move makes identical to another into it', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        { id: 'ta-en', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'pez' } },
        { id: 'ta-es', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { es: 'pez' } },
      ],
      tokenAnalysisLinks: [
        approved('tl-1', 'ta-en', 'GEN 1:1:0'),
        approved('tl-2', 'ta-es', 'GEN 1:2:0'),
      ],
    });

    const { counts, draft } = await change(repository, ['es'], 'en');

    expect(counts).toEqual({ words: 1, morphemes: 0, skipped: 0 });
    expect(draft.analysis.tokenAnalyses.map(({ id }) => id)).toEqual(['ta-es']);
    expect(draft.analysis.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toEqual([
      'ta-es',
      'ta-es',
    ]);
  });
});
