/// <reference types="jest" />

import type { PhraseAnalysisLink, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  changeAnalysisLanguages,
  type ChangeAnalysisLanguagesRequest,
} from '../../../services/commands/languageCommands';
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

/** An approved link from the phrase "big fish" in `verseRef` to `analysisId`. */
function phraseLink(id: string, analysisId: string, verseRef: string): PhraseAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    tokens: [
      { tokenRef: `${verseRef}:0`, surfaceText: 'big' },
      { tokenRef: `${verseRef}:1`, surfaceText: 'fish' },
    ],
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
  request: Omit<ChangeAnalysisLanguagesRequest, 'now'>,
) {
  const buffer = new ChangeBuffer(repository);
  const { draft } = await repository.exportAll();
  const outcome = await changeAnalysisLanguages(buffer, draft.analysis, { ...request, now: NOW });
  await repository.apply(buffer.toChangeSet('changeAnalysisLanguages'));
  return { outcome, draft: await repository.getWholeDraft() };
}

describe('changeAnalysisLanguages', () => {
  it('gives the draft the new languages and moves no glosses without a move', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'fish' } },
      ],
    });

    const { outcome, draft } = await change(repository, { analysisLanguages: ['es', 'en'] });

    expect(outcome).toEqual({});
    expect(draft.analysisLanguages).toEqual(['es', 'en']);
    expect(draft.analysis.tokenAnalyses[0].gloss).toEqual({ en: 'fish' });
  });

  it('moves the glosses under one tag to another', async () => {
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

    const { outcome, draft } = await change(repository, {
      analysisLanguages: ['es'],
      retag: { from: 'en', to: 'es' },
    });

    expect(outcome.glossRetag).toEqual({ words: 2, morphemes: 1, freeTranslations: 0, skipped: 0 });
    expect(draft.analysisLanguages).toEqual(['es']);
    const [token] = draft.analysis.tokenAnalyses;
    expect(token).toMatchObject({ gloss: { es: 'fish' }, updatedAt: NOW });
    expect(token.morphemes?.[0].gloss).toEqual({ es: 'fish' });
    expect(draft.analysis.phraseAnalyses[0].gloss).toEqual({ es: 'whale' });
  });

  it('moves the free translations under one tag to another', async () => {
    const repository = await repositoryOver({
      segmentAnalyses: [
        {
          id: 'sa-1',
          ...FIXTURE_STAMPS,
          surfaceText: 'Big fish.',
          freeTranslation: { en: 'Big.' },
        },
      ],
    });

    const { outcome, draft } = await change(repository, {
      analysisLanguages: ['es'],
      retag: { from: 'en', to: 'es' },
    });

    expect(outcome.glossRetag).toEqual({ words: 0, morphemes: 0, freeTranslations: 1, skipped: 0 });
    expect(draft.analysis.segmentAnalyses[0]).toMatchObject({
      freeTranslation: { es: 'Big.' },
      updatedAt: NOW,
    });
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

    const { outcome, draft } = await change(repository, {
      analysisLanguages: ['es'],
      retag: { from: 'en', to: 'es' },
    });

    expect(outcome.glossRetag).toEqual({ words: 1, morphemes: 0, freeTranslations: 0, skipped: 0 });
    expect(draft.analysis.tokenAnalyses.map(({ id }) => id)).toEqual(['ta-es']);
    expect(draft.analysis.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toEqual([
      'ta-es',
      'ta-es',
    ]);
  });

  it('folds a phrase analysis the move makes identical to another into it', async () => {
    const repository = await repositoryOver({
      phraseAnalyses: [
        { id: 'pa-en', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { en: 'ballena' } },
        { id: 'pa-es', ...FIXTURE_STAMPS, surfaceText: 'big fish', gloss: { es: 'ballena' } },
      ],
      phraseAnalysisLinks: [
        phraseLink('pl-1', 'pa-en', 'GEN 1:1'),
        phraseLink('pl-2', 'pa-es', 'GEN 1:2'),
      ],
    });

    const { outcome, draft } = await change(repository, {
      analysisLanguages: ['es'],
      retag: { from: 'en', to: 'es' },
    });

    expect(outcome.glossRetag).toEqual({ words: 1, morphemes: 0, freeTranslations: 0, skipped: 0 });
    expect(draft.analysis.phraseAnalyses.map(({ id }) => id)).toEqual(['pa-es']);
    expect(draft.analysis.phraseAnalysisLinks.map(({ analysisId }) => analysisId)).toEqual([
      'pa-es',
      'pa-es',
    ]);
  });

  it('deletes the glosses and free translations under a tag', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'fish', fr: 'x' } },
      ],
      segmentAnalyses: [
        { id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'Big fish.', freeTranslation: { fr: 'y' } },
      ],
    });

    const { outcome, draft } = await change(repository, {
      analysisLanguages: ['en'],
      deleteTextOf: 'fr',
    });

    expect(outcome).toEqual({ deletedText: { glosses: 1, freeTranslations: 1 } });
    expect(draft.analysisLanguages).toEqual(['en']);
    expect(draft.analysis.tokenAnalyses[0]).toMatchObject({
      gloss: { en: 'fish' },
      updatedAt: NOW,
    });
    expect(draft.analysis.segmentAnalyses[0].freeTranslation).toEqual({});
  });

  it('folds an analysis the deletion makes identical to another into it', async () => {
    const repository = await repositoryOver({
      tokenAnalyses: [
        { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'pez', fr: 'x' } },
        { id: 'ta-2', ...FIXTURE_STAMPS, surfaceText: 'fish', gloss: { en: 'pez' } },
      ],
      tokenAnalysisLinks: [
        approved('tl-1', 'ta-1', 'GEN 1:1:0'),
        approved('tl-2', 'ta-2', 'GEN 1:2:0'),
      ],
    });

    const { draft } = await change(repository, { analysisLanguages: ['en'], deleteTextOf: 'fr' });

    expect(draft.analysis.tokenAnalyses).toHaveLength(1);
    const [survivor] = draft.analysis.tokenAnalyses;
    expect(draft.analysis.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toEqual([
      survivor.id,
      survivor.id,
    ]);
  });
});
