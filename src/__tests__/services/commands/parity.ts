/// <reference types="jest" />

import type { UnknownAction } from '@reduxjs/toolkit';
import type { TextAnalysis } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import reducer from '../../../store/analysisSlice';
import type { ChangeSet, IndexDifference } from '../../../types/analysis-repository';
import { emptyDraft } from '../../../types/empty-factories';
import { memoryStorage, silentLogger } from '../../test-helpers';

/** What one input gives through the store's reducer and through the host's command. */
export type ParityOutcome = {
  /** The analysis the reducer leaves, its record lists in id order. */
  store: TextAnalysis;
  /** The analysis the command's changes leave once applied and reloaded, in id order. */
  host: TextAnalysis;
  /** The changes the command staged. */
  changes: ChangeSet;
  /** Where the repository's kept indexes differ from its records after applying the changes. */
  indexDifferences: IndexDifference[];
};

/** `analysis` as JSON holds it, with each record list in id order. */
function normalized(analysis: TextAnalysis): TextAnalysis {
  const plain: TextAnalysis = JSON.parse(JSON.stringify(analysis));
  const byId = <T extends { id: string }>(records: T[]) =>
    [...records].sort((a, b) => a.id.localeCompare(b.id));
  return {
    segmentAnalyses: byId(plain.segmentAnalyses),
    segmentAnalysisLinks: byId(plain.segmentAnalysisLinks),
    tokenAnalyses: byId(plain.tokenAnalyses),
    tokenAnalysisLinks: byId(plain.tokenAnalysisLinks),
    phraseAnalyses: byId(plain.phraseAnalyses),
    phraseAnalysisLinks: byId(plain.phraseAnalysisLinks),
  };
}

/**
 * Runs one input both ways over `analysis`. One way runs `action` through the store's reducer,
 * working in `analysisLanguage`; several actions run in turn. The other way stages `command`'s
 * changes over a draft holding the same analysis, then applies them and reloads the draft from
 * storage.
 */
export async function runParity(
  analysis: TextAnalysis,
  analysisLanguage: string,
  action: UnknownAction | readonly UnknownAction[],
  command: (buffer: ChangeBuffer) => Promise<void>,
): Promise<ParityOutcome> {
  const store = [action]
    .flat()
    .reduce(reducer, { analysis: JSON.parse(JSON.stringify(analysis)), analysisLanguage });

  const { storage } = memoryStorage();
  const logger = silentLogger();
  await new DraftRepository(storage, 'src', logger).replaceAll({
    ...emptyDraft('src'),
    analysisLanguages: [analysisLanguage],
    analysis: JSON.parse(JSON.stringify(analysis)),
  });
  const repository = new DraftRepository(storage, 'src', logger);
  const buffer = new ChangeBuffer(repository);
  await command(buffer);
  const changes = buffer.toChangeSet('parity');
  await repository.apply(changes);
  const { draft: reloaded } = await new DraftRepository(storage, 'src', logger).exportAll();

  return {
    store: normalized(store.analysis),
    host: normalized(reloaded.analysis),
    changes,
    indexDifferences: await repository.checkIndexes(),
  };
}
