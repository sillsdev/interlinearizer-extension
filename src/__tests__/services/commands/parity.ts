/// <reference types="jest" />

import type { UnknownAction } from '@reduxjs/toolkit';
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import reducer from '../../../store/analysisSlice';
import type { ChangeSet, IndexDifference } from '../../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

export const NOW = '2026-06-01T00:00:00.000Z';
export const EARLIER = {
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};
export const LATER = {
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

export const TOKEN = 'GEN 1:1:0';
export const OTHER_TOKEN = 'GEN 1:2:0';

export function payload(id: string, surfaceText: string, fields: Partial<TokenAnalysis> = {}) {
  return { id, ...FIXTURE_STAMPS, surfaceText, ...fields };
}

export function link(
  id: string,
  analysisId: string,
  tokenRef: string,
  surfaceText: string,
  fields: Partial<TokenAnalysisLink> = {},
): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText },
    ...fields,
  };
}

export function analysisOf(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks };
}

export const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

export type ParityCase<Input> = {
  analysis: TextAnalysis;
  input: Input;
  /** What the reducer's result must show, so the case exercises the path it names. */
  expectStore: (store: TextAnalysis) => void;
};

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
 * Runs one input both ways over `analysis`: `action` through the store's reducer, working in
 * `analysisLanguage`, and `command` staging changes over a draft holding the same analysis, which
 * are then applied and the draft reloaded from storage.
 */
export async function runParity(
  analysis: TextAnalysis,
  analysisLanguage: string,
  action: UnknownAction,
  command: (buffer: ChangeBuffer) => Promise<void>,
): Promise<ParityOutcome> {
  const store = reducer(
    { analysis: JSON.parse(JSON.stringify(analysis)), analysisLanguage },
    action,
  );

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

/**
 * Asserts the reducer took the path the case names, and that the command left the same analysis
 * with its indexes matching its records.
 */
export function expectParity(
  outcome: ParityOutcome,
  expectStore: ParityCase<unknown>['expectStore'],
): void {
  expectStore(outcome.store);
  expect(outcome.host).toStrictEqual(outcome.store);
  expect(outcome.indexDifferences).toStrictEqual([]);
}
