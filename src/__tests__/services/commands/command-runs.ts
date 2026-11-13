/// <reference types="jest" />

import type {
  MorphemeAnalysis,
  SegmentationDelta,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import type { DraftContent } from '../../../types/draft-content';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  discardAll,
  discardBook,
  type DiscardOutcome,
  type SavedProject,
} from '../../../services/commands/discardCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { draftAnalysisKey } from '../../../services/storageKeys';
import type { ChangeSet } from '../../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { isEmptyChangeSet } from '../../../utils/change-set';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

/** Stamps dated before {@link FIXTURE_STAMPS}. */
export const EARLIER = {
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};
/** Stamps dated after {@link FIXTURE_STAMPS} and before {@link NOW}. */
export const LATER = {
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

/** `Token.ref` of the token that a case edits. */
export const TOKEN = 'GEN 1:1:0';
/** `Token.ref` of a token that a case leaves alone. */
export const OTHER_TOKEN = 'GEN 1:2:0';

/** A token analysis stamped with {@link FIXTURE_STAMPS}, with `fields` overriding the defaults. */
export function payload(id: string, surfaceText: string, fields: Partial<TokenAnalysis> = {}) {
  return { id, ...FIXTURE_STAMPS, surfaceText, ...fields };
}

/** An approved link stamped with {@link FIXTURE_STAMPS}, with `fields` overriding the defaults. */
export function link(
  id: string,
  analysisId: string,
  tokenRef: string,
  surfaceText = 'In',
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

/** A morpheme of `form` in `writingSystem`, with `fields` overriding the defaults. */
export function morpheme(
  id: string,
  form: string,
  writingSystem: string,
  fields: Partial<MorphemeAnalysis> = {},
): MorphemeAnalysis {
  return { id, form, writingSystem, ...fields };
}

/** An analysis holding only the given token analyses and links. */
export function analysisOf(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks };
}

/** One input that a suite runs through a command, with what its result must show. */
export type CommandCase<Input> = {
  /** What the draft holds before the input runs. */
  analysis: TextAnalysis;
  /** What varies between the suite's cases, passed to the command. */
  input: Input;
  /** What the command's result must show, so the case exercises the path it names. */
  expectResult: (result: TextAnalysis) => void;
};

/** What one input gives through the host's command. */
export type CommandOutcome = {
  /** The analysis the command's changes leave once applied and reloaded, in id order. */
  result: TextAnalysis;
  /** The changes the command staged. */
  changes: ChangeSet;
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

/** What a draft holds before the input runs. */
type DraftSeed = {
  analysis: TextAnalysis;
  analysisLanguage: string;
  /** The draft's boundaries; absent for the default verse segmentation. */
  segmentation?: SegmentationDelta;
};

/** Storage holding a draft of `seed`. */
async function seededStorage(seed: DraftSeed) {
  const memory = memoryStorage();
  await new DraftRepository(memory.storage, 'src', silentLogger()).startOver({
    ...emptyDraft('src'),
    analysisLanguages: [seed.analysisLanguage],
    ...(seed.segmentation && { segmentation: JSON.parse(JSON.stringify(seed.segmentation)) }),
    analysis: JSON.parse(JSON.stringify(seed.analysis)),
  });
  return memory;
}

/**
 * Stages `command`'s changes over a draft holding `seed`, then applies them, asserts that the
 * repository's indexes still match its records, and reloads the draft from storage.
 */
async function runOnHost(seed: DraftSeed, command: (buffer: ChangeBuffer) => Promise<unknown>) {
  const { storage } = await seededStorage(seed);
  const logger = silentLogger();
  const repository = new DraftRepository(storage, 'src', logger);
  const buffer = new ChangeBuffer(repository);
  await command(buffer);
  const changes = buffer.toChangeSet('command');
  await repository.apply(changes);
  expect(await repository.checkIndexes()).toStrictEqual([]);
  const { draft } = await new DraftRepository(storage, 'src', logger).exportAll();
  return { draft, changes };
}

/**
 * Stages `command`'s changes over a draft holding `analysis`, working in `analysisLanguage`, then
 * applies them, asserts that the repository's indexes still match its records, and reloads the
 * draft from storage.
 */
export async function runCommand(
  analysis: TextAnalysis,
  analysisLanguage: string,
  command: (buffer: ChangeBuffer) => Promise<unknown>,
): Promise<CommandOutcome> {
  const { draft, changes } = await runOnHost({ analysis, analysisLanguage }, command);
  return { result: normalized(draft.analysis), changes };
}

/** A boundary edit to run. */
export type BoundaryEdit =
  | { kind: 'merge'; secondSegmentStartRef: string }
  | { kind: 'split'; tokenRef: string }
  | { kind: 'move'; fromRef: string; toRef: string };

/** What one boundary edit gives through the host's command. */
export type BoundaryCommandOutcome = CommandOutcome & {
  /** The boundaries the command's changes leave once applied and reloaded. */
  resultSegmentation: SegmentationDelta | undefined;
};

/** The time stamped on every record that a run touches. */
export const NOW = '2026-06-01T00:00:00.000Z';

/** Makes ids in a fixed sequence, so a run spends ids in a known order. */
function idSequence(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${next}`;
  };
}

/**
 * Stages a boundary command's changes over a draft holding `seed`, then applies them, asserts that
 * the repository's indexes still match its records, and reloads the draft from storage. Ids come
 * from a fixed sequence, which reaches `command` as `newId`.
 */
export async function runBoundaryCommand(
  seed: Omit<DraftSeed, 'analysisLanguage'>,
  command: (buffer: ChangeBuffer, newId: () => string) => Promise<void>,
): Promise<BoundaryCommandOutcome> {
  const newId = idSequence();
  const { draft, changes } = await runOnHost({ ...seed, analysisLanguage: 'en' }, (buffer) =>
    command(buffer, newId),
  );
  return {
    result: normalized(draft.analysis),
    changes,
    resultSegmentation: draft.segmentation,
  };
}

/**
 * Asserts that the token analyses the command's changes delete are those that `before` holds and
 * the result lacks, which is what a removal preview names.
 */
export function expectRemovalPreview(outcome: CommandOutcome, before: TextAnalysis): void {
  const kept = new Set(outcome.result.tokenAnalyses.map(({ id }) => id));
  const reclaimed = before.tokenAnalyses.map(({ id }) => id).filter((id) => !kept.has(id));
  expect([...(outcome.changes.tokenAnalyses?.deletes ?? [])].sort()).toStrictEqual(
    reclaimed.sort(),
  );
}

/** What a draft holds before an unsaved-change discard runs. */
export type DiscardSeed = {
  analysis: TextAnalysis;
  /** The draft's boundaries; absent for the default verse segmentation. */
  segmentation?: SegmentationDelta;
  /** Books whose stored analysis is made unreadable once the draft is stored. */
  unreadableBooks?: readonly string[];
};

/** An unsaved-change discard to run: of one book, or of the whole draft. */
export type DiscardEdit = { kind: 'book'; bookCode: string } | { kind: 'all' };

/** What one discard gives through the host's command. */
export type DiscardCommandOutcome = CommandOutcome & {
  /** The boundaries the command's changes leave once applied and reloaded. */
  resultSegmentation: SegmentationDelta | undefined;
  /** What the command told its caller. */
  commandOutcome: DiscardOutcome;
  /** What the run leaves stored under each unreadable book's analysis key. */
  unreadableShards: (string | undefined)[];
};

/**
 * Runs one unsaved-change discard over a draft holding `seed`, restoring `saved`, the content of
 * the project the draft saves to. The project holds the draft's analysis languages. Stages the
 * host's command over the stored draft, applies its changes, asserts that the repository's indexes
 * still match its records, then reloads the draft from storage.
 */
export async function runDiscardCommand(
  seed: DiscardSeed,
  saved: DraftContent | undefined,
  edit: DiscardEdit,
): Promise<DiscardCommandOutcome> {
  const logger = silentLogger();
  const host = await seededStorage({ ...seed, analysisLanguage: 'en' });
  seed.unreadableBooks?.forEach((bookCode) =>
    host.records.set(draftAnalysisKey('src', bookCode), 'not json'),
  );
  const savedCopy = (): SavedProject | undefined =>
    saved && { ...JSON.parse(JSON.stringify(saved)), analysisLanguages: ['en'] };
  const repository = new DraftRepository(host.storage, 'src', logger);
  const stored = await repository.exportAll();
  const buffer = new ChangeBuffer(repository);
  const commandOutcome =
    edit.kind === 'book'
      ? discardBook(buffer, stored, edit.bookCode, savedCopy())
      : discardAll(buffer, stored, savedCopy());
  const changes = buffer.toChangeSet('discard');
  if (!isEmptyChangeSet(changes)) await repository.apply(changes);
  expect(await repository.checkIndexes()).toStrictEqual([]);
  const { draft } = await new DraftRepository(host.storage, 'src', logger).exportAll();

  return {
    result: normalized(draft.analysis),
    changes,
    resultSegmentation: draft.segmentation,
    commandOutcome,
    unreadableShards: (seed.unreadableBooks ?? []).map((bookCode) =>
      host.records.get(draftAnalysisKey('src', bookCode)),
    ),
  };
}
