/// <reference types="jest" />

import type {
  SegmentAnalysis,
  SegmentAnalysisLink,
  SegmentationDelta,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import type { DraftContent } from '../../../types/draft-content';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import {
  runDiscardParity,
  type DiscardEdit,
  type DiscardParityOutcome,
  type DiscardSeed,
} from './parity';

const GEN_TOKEN = 'GEN 1:1:0';
const EXO_TOKEN = 'EXO 1:1:0';

function payload(id: string, surfaceText: string, gloss: string): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText, gloss: { en: gloss } };
}

function link(id: string, analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'In' },
  };
}

function translation(id: string, freeTranslation: string): SegmentAnalysis {
  return {
    id,
    ...FIXTURE_STAMPS,
    surfaceText: 'In the beginning',
    freeTranslation: { en: freeTranslation },
  };
}

function segmentLink(id: string, analysisId: string, segmentId: string): SegmentAnalysisLink {
  return { id, analysisId, ...FIXTURE_STAMPS, status: 'approved', segmentId };
}

function analysisOf(records: Partial<TextAnalysis>): TextAnalysis {
  return { ...emptyAnalysis(), ...records };
}

function savedOf(records: Partial<TextAnalysis>, segmentation?: SegmentationDelta): DraftContent {
  return { analysis: analysisOf(records), segmentation };
}

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

/** A draft with one approved gloss in each of Genesis and Exodus. */
const glossedInBothBooks = analysisOf({
  tokenAnalyses: [payload('ta-gen-now', 'In', 'in'), payload('ta-exo-now', 'And', 'and')],
  tokenAnalysisLinks: [
    link('tl-gen-now', 'ta-gen-now', GEN_TOKEN),
    link('tl-exo-now', 'ta-exo-now', EXO_TOKEN),
  ],
});

/** A saved project glossing each of Genesis and Exodus differently from the draft. */
const savedInBothBooks = savedOf({
  tokenAnalyses: [payload('ta-gen-saved', 'In', 'at'), payload('ta-exo-saved', 'And', 'plus')],
  tokenAnalysisLinks: [
    link('tl-gen-saved', 'ta-gen-saved', GEN_TOKEN),
    link('tl-exo-saved', 'ta-exo-saved', EXO_TOKEN),
  ],
});

const GEN: DiscardEdit = { kind: 'book', bookCode: 'GEN' };
const ALL: DiscardEdit = { kind: 'all' };

type DiscardCase = {
  seed: DiscardSeed;
  saved: DraftContent | undefined;
  edit: DiscardEdit;
  /** What the WebView's result must show, so the case exercises the path it names. */
  expectStore: (outcome: DiscardParityOutcome) => void;
};

describe('unsaved-change discard parity with the WebView', () => {
  const cases: [string, DiscardCase][] = [
    [
      "restores the saved project's records for the book, leaving other books as they were",
      {
        seed: { analysis: glossedInBothBooks },
        saved: savedInBothBooks,
        edit: GEN,
        expectStore: ({ store }) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-exo-now', 'ta-gen-saved']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-exo-now', 'tl-gen-saved']);
        },
      },
    ],
    [
      'restores a link the draft repointed under the same id',
      {
        seed: {
          analysis: analysisOf({
            tokenAnalyses: [payload('ta-now', 'In', 'in')],
            tokenAnalysisLinks: [link('tl-gen', 'ta-now', GEN_TOKEN)],
          }),
        },
        saved: savedOf({
          tokenAnalyses: [payload('ta-saved', 'In', 'at')],
          tokenAnalysisLinks: [link('tl-gen', 'ta-saved', GEN_TOKEN)],
        }),
        edit: GEN,
        expectStore: ({ store }) => {
          expect(store.tokenAnalysisLinks).toStrictEqual([link('tl-gen', 'ta-saved', GEN_TOKEN)]);
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-saved']);
        },
      },
    ],
    [
      "takes the saved version of a payload that only the book's links name",
      {
        seed: {
          analysis: analysisOf({
            tokenAnalyses: [payload('ta-in', 'In', 'in')],
            tokenAnalysisLinks: [link('tl-gen', 'ta-in', GEN_TOKEN)],
          }),
        },
        saved: savedOf({
          tokenAnalyses: [payload('ta-in', 'In', 'at')],
          tokenAnalysisLinks: [link('tl-gen', 'ta-in', GEN_TOKEN)],
        }),
        edit: GEN,
        expectStore: ({ store }) => {
          expect(store.tokenAnalyses).toStrictEqual([payload('ta-in', 'In', 'at')]);
        },
      },
    ],
    [
      'empties the book when the draft saves to no project',
      {
        seed: { analysis: glossedInBothBooks },
        saved: undefined,
        edit: GEN,
        expectStore: ({ store }) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-exo-now']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-exo-now']);
        },
      },
    ],
    [
      "keeps the draft's version of a payload the book shares with another book",
      {
        seed: {
          analysis: analysisOf({
            tokenAnalyses: [payload('ta-shared', 'In', 'current')],
            tokenAnalysisLinks: [
              link('tl-gen', 'ta-shared', GEN_TOKEN),
              link('tl-exo', 'ta-shared', EXO_TOKEN),
            ],
          }),
        },
        saved: savedOf({
          tokenAnalyses: [payload('ta-shared', 'In', 'saved')],
          tokenAnalysisLinks: [link('tl-gen', 'ta-shared', GEN_TOKEN)],
        }),
        edit: GEN,
        expectStore: ({ store }) => {
          expect(store.tokenAnalyses).toStrictEqual([payload('ta-shared', 'In', 'current')]);
        },
      },
    ],
    [
      'keeps a payload no link names through a book discard',
      {
        seed: {
          analysis: analysisOf({
            tokenAnalyses: [payload('ta-gen-now', 'In', 'in'), payload('ta-loose', 'Of', 'of')],
            tokenAnalysisLinks: [link('tl-gen-now', 'ta-gen-now', GEN_TOKEN)],
          }),
        },
        saved: savedInBothBooks,
        edit: GEN,
        expectStore: ({ store }) => {
          expect(ids(store.tokenAnalyses)).toContain('ta-loose');
        },
      },
    ],
    [
      'drops a payload no link names in a whole-draft discard',
      {
        seed: {
          analysis: analysisOf({
            tokenAnalyses: [payload('ta-gen-now', 'In', 'in'), payload('ta-loose', 'Of', 'of')],
            tokenAnalysisLinks: [link('tl-gen-now', 'ta-gen-now', GEN_TOKEN)],
          }),
        },
        saved: savedInBothBooks,
        edit: ALL,
        expectStore: ({ store }) => {
          expect(ids(store.tokenAnalyses)).not.toContain('ta-loose');
        },
      },
    ],
    [
      "restores the book's boundaries, leaving other books' boundaries alone",
      {
        seed: {
          analysis: glossedInBothBooks,
          segmentation: {
            removedVerseStarts: ['GEN 1:2:0', 'EXO 1:2:0'],
            addedStarts: [{ tokenRef: 'GEN 1:1:7', surfaceText: 'beginning' }],
          },
        },
        saved: savedOf({}, { removedVerseStarts: ['GEN 1:3:0'], addedStarts: [] }),
        edit: GEN,
        expectStore: ({ storeSegmentation }) => {
          expect(storeSegmentation).toStrictEqual({
            removedVerseStarts: ['EXO 1:2:0', 'GEN 1:3:0'],
            addedStarts: [],
          });
        },
      },
    ],
    [
      "removes the book's boundaries when the saved project has none",
      {
        seed: {
          analysis: glossedInBothBooks,
          segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
        },
        saved: savedInBothBooks,
        edit: GEN,
        expectStore: ({ storeSegmentation }) => {
          expect(storeSegmentation).toBeUndefined();
        },
      },
    ],
    [
      'restores the whole saved project in a whole-draft discard',
      {
        seed: {
          analysis: glossedInBothBooks,
          segmentation: { removedVerseStarts: ['EXO 1:2:0'], addedStarts: [] },
        },
        saved: {
          ...savedInBothBooks,
          segmentation: { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
        },
        edit: ALL,
        expectStore: ({ store, storeSegmentation }) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-exo-saved', 'tl-gen-saved']);
          expect(storeSegmentation).toStrictEqual({
            removedVerseStarts: ['GEN 1:2:0'],
            addedStarts: [],
          });
        },
      },
    ],
    [
      'empties the draft in a whole-draft discard when it saves to no project',
      {
        seed: {
          analysis: glossedInBothBooks,
          segmentation: { removedVerseStarts: ['EXO 1:2:0'], addedStarts: [] },
        },
        saved: undefined,
        edit: ALL,
        expectStore: ({ store, storeSegmentation }) => {
          expect(store).toStrictEqual(emptyAnalysis());
          expect(storeSegmentation).toBeUndefined();
        },
      },
    ],
    [
      'keeps the stored analysis of a book that could not be read through its own discard',
      {
        seed: { analysis: glossedInBothBooks, unreadableBooks: ['GEN'] },
        saved: savedInBothBooks,
        edit: GEN,
        expectStore: ({ store, unreadableShards }) => {
          expect(unreadableShards.store).toStrictEqual(['not json']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-exo-now']);
        },
      },
    ],
    [
      'keeps the stored analysis of a book that could not be read through a whole-draft discard',
      {
        seed: { analysis: glossedInBothBooks, unreadableBooks: ['GEN'] },
        saved: savedOf({
          tokenAnalyses: [payload('ta-shared', 'In', 'at'), payload('ta-gen-saved', 'In', 'in')],
          tokenAnalysisLinks: [
            link('tl-gen-shared', 'ta-shared', GEN_TOKEN),
            link('tl-gen-saved', 'ta-gen-saved', 'GEN 1:2:0'),
            link('tl-exo-shared', 'ta-shared', EXO_TOKEN),
          ],
        }),
        edit: ALL,
        expectStore: ({ store, unreadableShards }) => {
          expect(unreadableShards.store).toStrictEqual(['not json']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-exo-shared']);
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-shared']);
        },
      },
    ],
    [
      'reports a free translation the discard restores',
      {
        seed: { analysis: glossedInBothBooks },
        saved: savedOf({
          segmentAnalyses: [translation('sa-gen', 'At the start')],
          segmentAnalysisLinks: [segmentLink('sl-gen', 'sa-gen', 'GEN 1:1')],
        }),
        edit: GEN,
        expectStore: ({ storeHasFreeTranslations }) => {
          expect(storeHasFreeTranslations).toBe(true);
        },
      },
    ],
    [
      'reports no free translation once the discard drops the last one',
      {
        seed: {
          analysis: analysisOf({
            segmentAnalyses: [translation('sa-gen', 'At the start')],
            segmentAnalysisLinks: [segmentLink('sl-gen', 'sa-gen', 'GEN 1:1')],
          }),
        },
        saved: savedInBothBooks,
        edit: GEN,
        expectStore: ({ storeHasFreeTranslations }) => {
          expect(storeHasFreeTranslations).toBe(false);
        },
      },
    ],
    [
      'reports a free translation restored into a book that could not be read, as the WebView holds it',
      {
        seed: { analysis: glossedInBothBooks, unreadableBooks: ['GEN'] },
        saved: savedOf({
          segmentAnalyses: [translation('sa-gen', 'At the start')],
          segmentAnalysisLinks: [segmentLink('sl-gen', 'sa-gen', 'GEN 1:1')],
        }),
        edit: GEN,
        expectStore: ({ store, storeHasFreeTranslations }) => {
          expect(storeHasFreeTranslations).toBe(true);
          expect(store.segmentAnalyses).toStrictEqual([]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { seed, saved, edit, expectStore }) => {
    const outcome = await runDiscardParity(seed, saved, edit);

    expectStore(outcome);
    expect(outcome.host).toStrictEqual(outcome.store);
    expect(outcome.hostSegmentation).toStrictEqual(outcome.storeSegmentation);
    expect(outcome.hostOutcome.hasFreeTranslations).toBe(outcome.storeHasFreeTranslations);
    expect(outcome.unreadableShards.host).toStrictEqual(outcome.unreadableShards.store);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});
