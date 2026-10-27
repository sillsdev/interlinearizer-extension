/// <reference types="jest" />

import type { UnknownAction } from '@reduxjs/toolkit';
import type {
  Book,
  SegmentationDelta,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { resegmentBook } from 'parsers/papi/resegmentBook';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import reducer, {
  createPhrase,
  deletePhrase,
  selectPhraseLinkById,
  updatePhrase,
} from '../../../store/analysisSlice';
import type { ChangeSet, IndexDifference } from '../../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { buildBookIndexes } from '../../../utils/book-indexes';
import { phrasesStraddlingBoundary, splitPhraseAtBoundary } from '../../../utils/phrase-arc';
import {
  isEmptyDelta,
  mergeSegments,
  moveBoundary,
  reanchorSegmentation,
  splitSegmentBefore,
} from '../../../utils/segmentation';
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

/** An analysis holding only the given token analyses and links. */
export function analysisOf(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks };
}

/** The ids of `records`, sorted. */
export const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

/** One input that a parity suite runs through both the reducer and the command. */
export type ParityCase<Input> = {
  /** What the draft holds before the input runs. */
  analysis: TextAnalysis;
  /** What varies between the suite's cases, passed to both the reducer and the command. */
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

/** What a draft holds before the input runs. */
type DraftSeed = {
  analysis: TextAnalysis;
  analysisLanguage: string;
  /** The draft's boundaries; absent for the default verse segmentation. */
  segmentation?: SegmentationDelta;
};

/**
 * Stages `command`'s changes over a draft holding `seed`, then applies them and reloads the draft
 * from storage.
 */
async function runOnHost(seed: DraftSeed, command: (buffer: ChangeBuffer) => Promise<void>) {
  const { storage } = memoryStorage();
  const logger = silentLogger();
  await new DraftRepository(storage, 'src', logger).replaceAll({
    ...emptyDraft('src'),
    analysisLanguages: [seed.analysisLanguage],
    ...(seed.segmentation && { segmentation: JSON.parse(JSON.stringify(seed.segmentation)) }),
    analysis: JSON.parse(JSON.stringify(seed.analysis)),
  });
  const repository = new DraftRepository(storage, 'src', logger);
  const buffer = new ChangeBuffer(repository);
  await command(buffer);
  const changes = buffer.toChangeSet('parity');
  await repository.apply(changes);
  const { draft } = await new DraftRepository(storage, 'src', logger).exportAll();
  return { draft, changes, indexDifferences: await repository.checkIndexes() };
}

/** Runs `actions` in turn through the store's reducer over `analysis`. */
function runInStore(
  analysis: TextAnalysis,
  analysisLanguage: string,
  actions: readonly UnknownAction[],
): TextAnalysis {
  return actions.reduce(reducer, {
    analysis: JSON.parse(JSON.stringify(analysis)),
    analysisLanguage,
  }).analysis;
}

/**
 * Runs one input both ways over `analysis`. One way runs `action` through the store's reducer,
 * working in `analysisLanguage`. An array of actions runs in turn. The other way stages `command`'s
 * changes over a draft holding the same analysis, then applies them and reloads the draft from
 * storage.
 */
export async function runParity(
  analysis: TextAnalysis,
  analysisLanguage: string,
  action: UnknownAction | readonly UnknownAction[],
  command: (buffer: ChangeBuffer) => Promise<void>,
): Promise<ParityOutcome> {
  const store = runInStore(analysis, analysisLanguage, [action].flat());
  const { draft, changes, indexDifferences } = await runOnHost(
    { analysis, analysisLanguage },
    command,
  );
  return { store: normalized(store), host: normalized(draft.analysis), changes, indexDifferences };
}

/** A boundary edit to run both ways. */
export type BoundaryEdit =
  | { kind: 'merge'; secondSegmentStartRef: string }
  | { kind: 'split'; tokenRef: string }
  | { kind: 'move'; fromRef: string; toRef: string };

/** What one boundary edit gives through the WebView and through the host's command. */
export type BoundaryParityOutcome = ParityOutcome & {
  /** The boundaries the WebView saves. */
  storeSegmentation: SegmentationDelta | undefined;
  /** The boundaries the command's changes leave once applied and reloaded. */
  hostSegmentation: SegmentationDelta | undefined;
};

/** The time stamped on every record that either way of a run touches. */
export const NOW = '2026-06-01T00:00:00.000Z';

/** Makes ids in a fixed sequence, so both ways of a run spend the same ids in the same order. */
function idSequence(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${next}`;
  };
}

/**
 * The reducer actions and the boundaries that the WebView gives for `edit`. A split, and the add
 * half of a move, first breaks every approved phrase the new boundary would cut, in the document
 * order of the book the view renders. Ids come from `newId`, spent for each broken phrase as the
 * host command spends them.
 */
function webViewBoundaryEdit(
  verseBook: Book,
  seed: DraftSeed,
  edit: BoundaryEdit,
  newId: () => string,
): { actions: UnknownAction[]; segmentation: SegmentationDelta | undefined } {
  const rendered = resegmentBook(verseBook, reanchorSegmentation(verseBook, seed.segmentation));
  const { tokenDocOrder, fullTokenOrder } = buildBookIndexes(rendered.segments);
  const actions: UnknownAction[] = [];
  const breakStraddledPhrases = (boundaryRef: string) => {
    const phraseLinks = selectPhraseLinkById({
      analysis: seed.analysis,
      analysisLanguage: seed.analysisLanguage,
    }).values();
    phrasesStraddlingBoundary(boundaryRef, phraseLinks, fullTokenOrder).forEach(
      ({ link: straddlingLink, splitAfterTokenRef }) => {
        const forkId = newId();
        const linkId = newId();
        const analysisId = newId();
        splitPhraseAtBoundary(
          straddlingLink,
          splitAfterTokenRef,
          {
            createPhrase: (tokens: TokenSnapshot[]) => {
              actions.push({
                type: createPhrase.type,
                payload: { id: linkId, analysisId, tokens, now: NOW },
              });
              return linkId;
            },
            updatePhrase: (phraseId, tokens) => {
              actions.push({
                type: updatePhrase.type,
                payload: { phraseId, tokens, forkId, now: NOW },
              });
            },
            deletePhrase: (phraseId) => {
              actions.push(deletePhrase({ phraseId }));
            },
          },
          tokenDocOrder,
        );
      },
    );
  };

  let next: SegmentationDelta;
  if (edit.kind === 'merge') {
    next = mergeSegments(verseBook, seed.segmentation, edit.secondSegmentStartRef);
  } else if (edit.kind === 'split') {
    breakStraddledPhrases(edit.tokenRef);
    next = splitSegmentBefore(verseBook, seed.segmentation, edit.tokenRef);
  } else {
    breakStraddledPhrases(edit.toRef);
    next = moveBoundary(verseBook, seed.segmentation, edit.fromRef, edit.toRef);
  }
  return { actions, segmentation: isEmptyDelta(next) ? undefined : next };
}

/**
 * Runs one boundary edit both ways over a draft holding `seed`. One way composes what the WebView
 * does for `edit` over `verseBook`: its boundary transform, and the reducer actions that break the
 * phrases the edit would cut. The other way stages `command`'s changes over a draft holding the
 * same analysis and boundaries, then applies them and reloads the draft from storage. Each way
 * makes ids from its own sequence. The host way's sequence reaches `command` as `newId`.
 */
export async function runBoundaryParity(
  verseBook: Book,
  seed: Omit<DraftSeed, 'analysisLanguage'>,
  edit: BoundaryEdit,
  command: (buffer: ChangeBuffer, newId: () => string) => Promise<void>,
): Promise<BoundaryParityOutcome> {
  const fullSeed: DraftSeed = { ...seed, analysisLanguage: 'en' };
  const webView = webViewBoundaryEdit(verseBook, fullSeed, edit, idSequence());
  const store = runInStore(seed.analysis, 'en', webView.actions);
  const newId = idSequence();
  const { draft, changes, indexDifferences } = await runOnHost(fullSeed, (buffer) =>
    command(buffer, newId),
  );
  return {
    store: normalized(store),
    host: normalized(draft.analysis),
    changes,
    indexDifferences,
    storeSegmentation: webView.segmentation,
    hostSegmentation: draft.segmentation,
  };
}

/**
 * Asserts that the reducer took the path that the case names, and that the command left the same
 * analysis and consistent indexes.
 */
export function expectParity(
  outcome: ParityOutcome,
  expectStore: ParityCase<unknown>['expectStore'],
): void {
  expectStore(outcome.store);
  expect(outcome.host).toStrictEqual(outcome.store);
  expect(outcome.indexDifferences).toStrictEqual([]);
}
