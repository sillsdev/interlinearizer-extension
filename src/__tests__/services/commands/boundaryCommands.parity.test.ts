/// <reference types="jest" />

import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentationDelta,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import type { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  mergeSegments,
  moveBoundary,
  splitSegment,
} from '../../../services/commands/boundaryCommands';
import { emptyAnalysis } from '../../../types/empty-factories';
import { phraseSurfaceText } from '../../../utils/phrase-text';
import { FIXTURE_STAMPS, makeVerseBook } from '../../test-helpers';
import { type BoundaryEdit, NOW, runBoundaryParity } from './parity';

const VERSE_BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning God created.' },
  { sid: 'GEN 1:2', text: 'And the earth was void.' },
  { heading: 's1', verseId: 'GEN 1:2', text: 'Darkness' },
  { sid: 'GEN 1:3', text: 'Light was there.' },
]);

const SURFACES = new Map(
  VERSE_BOOK.segments.flatMap(({ tokens }) => tokens.map((t) => [t.ref, t.surfaceText] as const)),
);

/** The snapshot of the token at `charStart` in verse `verse`. */
function word(verse: number, charStart: number): TokenSnapshot {
  const tokenRef = `GEN 1:${verse}:${charStart}`;
  const surfaceText = SURFACES.get(tokenRef);
  if (surfaceText === undefined) throw new Error(`The fixture has no token ${tokenRef}`);
  return { tokenRef, surfaceText };
}

// Verse 1: In(0) the(3) beginning(7) God(17) created(21). Verse 2: And(0) the(4) earth(8) was(14)
// void(18). Verse 3, after a heading: Light(0) was(6) there(10).
const IN = word(1, 0);
const THE = word(1, 3);
const BEGINNING = word(1, 7);
const GOD = word(1, 17);
const CREATED = word(1, 21);
const AND = word(2, 0);
const THE_2 = word(2, 4);
const EARTH = word(2, 8);
const WAS = word(2, 14);
const LIGHT = word(3, 0);

/** A token of an earlier text of verse 1, which the current text lacks. */
const GONE: TokenSnapshot = { tokenRef: 'GEN 1:1:40', surfaceText: 'formless' };

// Tokens of verse 1 of another book, spelled as GEN 1:1 spells them.
const EXO_THE: TokenSnapshot = { tokenRef: 'EXO 1:1:3', surfaceText: 'the' };
const EXO_BEGINNING: TokenSnapshot = { tokenRef: 'EXO 1:1:7', surfaceText: 'beginning' };
const EXO_GOD: TokenSnapshot = { tokenRef: 'EXO 1:1:17', surfaceText: 'God' };

/** Verse 2 merged into verse 1. */
const MERGED: SegmentationDelta = { removedVerseStarts: [AND.tokenRef], addedStarts: [] };

/** A phrase occurrence over `tokens` with a payload of its own, both named by `id`. */
function phrase(id: string, tokens: TokenSnapshot[]): [PhraseAnalysis, PhraseAnalysisLink] {
  return [
    { id: `pa-${id}`, ...FIXTURE_STAMPS, surfaceText: phraseSurfaceText(tokens) },
    { id, analysisId: `pa-${id}`, ...FIXTURE_STAMPS, status: 'approved', tokens },
  ];
}

/** An analysis holding the phrases `phrases` describes, its links in the order given. */
function analysisOf(...phrases: [PhraseAnalysis, PhraseAnalysisLink][]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: phrases.map(([analysis]) => analysis),
    phraseAnalysisLinks: phrases.map(([, link]) => link),
  };
}

/**
 * An analysis whose phrase occurrences, each an id and its tokens, share the payload `pa-shared`.
 * The links come in the order given.
 */
function sharingOnePayload(...occurrences: [string, TokenSnapshot[]][]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [
      { id: 'pa-shared', ...FIXTURE_STAMPS, surfaceText: phraseSurfaceText(occurrences[0][1]) },
    ],
    phraseAnalysisLinks: occurrences.map(([id, tokens]) => ({
      id,
      analysisId: 'pa-shared',
      ...FIXTURE_STAMPS,
      status: 'approved',
      tokens,
    })),
  };
}

const tokensOf = (store: TextAnalysis) =>
  Object.fromEntries(
    store.phraseAnalysisLinks.map(({ id, tokens }) => [id, tokens.map(({ tokenRef }) => tokenRef)]),
  );

const refs = (...tokens: TokenSnapshot[]) => tokens.map(({ tokenRef }) => tokenRef);

const payloadsOf = (store: TextAnalysis) =>
  Object.fromEntries(store.phraseAnalysisLinks.map(({ id, analysisId }) => [id, analysisId]));

/** The host command for `edit`. */
function commandFor(edit: BoundaryEdit) {
  return (buffer: ChangeBuffer, newId: () => string) => {
    if (edit.kind === 'merge') return mergeSegments(buffer, { ...edit, verseBook: VERSE_BOOK });
    if (edit.kind === 'split')
      return splitSegment(buffer, { ...edit, verseBook: VERSE_BOOK, now: NOW, newId });
    return moveBoundary(buffer, { ...edit, verseBook: VERSE_BOOK, now: NOW, newId });
  };
}

type BoundaryCase = {
  analysis: TextAnalysis;
  segmentation?: SegmentationDelta;
  edit: BoundaryEdit;
  /** What the WebView's result must show, so the case exercises the path it names. */
  expectStore: (store: TextAnalysis, segmentation: SegmentationDelta | undefined) => void;
};

describe('boundary command parity with the WebView boundary dispatch', () => {
  const cases: [string, BoundaryCase][] = [
    [
      'splits a segment cutting no phrase, leaving the phrases alone',
      {
        analysis: analysisOf(phrase('pl-1', [IN, THE])),
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({ 'pl-1': refs(IN, THE) });
          expect(segmentation).toStrictEqual({ removedVerseStarts: [], addedStarts: [GOD] });
        },
      },
    ],
    [
      'splits a phrase the new boundary cuts into two when both halves keep two tokens',
      {
        analysis: analysisOf(phrase('pl-1', [THE, BEGINNING, GOD, CREATED])),
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-1': refs(THE, BEGINNING),
            'id-2': refs(GOD, CREATED),
          });
        },
      },
    ],
    [
      'removes a cut phrase both of whose halves keep one token',
      {
        analysis: analysisOf(phrase('pl-1', [BEGINNING, GOD])),
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([]);
          expect(store.phraseAnalyses).toStrictEqual([]);
        },
      },
    ],
    [
      'shrinks a cut phrase to the half that keeps two tokens',
      {
        analysis: analysisOf(phrase('pl-1', [THE, BEGINNING, GOD]), phrase('pl-2', [AND, THE_2])),
        segmentation: MERGED,
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-1': refs(THE, BEGINNING),
            'pl-2': refs(AND, THE_2),
          });
        },
      },
    ],
    [
      'breaks every phrase the new boundary cuts, a discontiguous one whose gap holds it included',
      {
        analysis: analysisOf(
          phrase('pl-a', [BEGINNING, GOD, AND]),
          phrase('pl-b', [IN, CREATED, THE_2]),
          phrase('pl-c', [THE, EARTH, WAS]),
        ),
        segmentation: MERGED,
        edit: { kind: 'split', tokenRef: CREATED.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-a': refs(BEGINNING, GOD),
            'pl-b': refs(CREATED, THE_2),
            'pl-c': refs(EARTH, WAS),
          });
          expect(segmentation).toStrictEqual({ ...MERGED, addedStarts: [CREATED] });
        },
      },
    ],
    [
      'breaks two cut phrases sharing a payload in id order, the first forking, whatever order they are stored in',
      {
        analysis: sharingOnePayload(['pl-b', [BEGINNING, CREATED, AND]], ['pl-a', [IN, THE, GOD]]),
        segmentation: MERGED,
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-a': refs(IN, THE),
            'pl-b': refs(CREATED, AND),
          });
          expect(payloadsOf(store)).toStrictEqual({ 'pl-a': 'id-1', 'pl-b': 'pa-shared' });
        },
      },
    ],
    [
      'leaves alone a phrase in another book, forking the cut phrase that shares its payload',
      {
        analysis: sharingOnePayload(
          ['pl-gen', [THE, BEGINNING, GOD]],
          ['pl-exo', [EXO_THE, EXO_BEGINNING, EXO_GOD]],
        ),
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-exo': refs(EXO_THE, EXO_BEGINNING, EXO_GOD),
            'pl-gen': refs(THE, BEGINNING),
          });
          expect(payloadsOf(store)).toStrictEqual({ 'pl-exo': 'pa-shared', 'pl-gen': 'id-1' });
        },
      },
    ],
    [
      'breaks a cut phrase holding a token the current text lacks',
      {
        analysis: analysisOf(phrase('pl-1', [THE, BEGINNING, GONE, GOD, CREATED])),
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (store) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-1': refs(GONE, THE, BEGINNING),
            'id-2': refs(GOD, CREATED),
          });
        },
      },
    ],
    [
      'removes a discontiguous phrase whose gap alone holds the new boundary',
      {
        analysis: analysisOf(phrase('pl-1', [THE, AND])),
        segmentation: MERGED,
        edit: { kind: 'split', tokenRef: CREATED.tokenRef },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      'breaks a phrase across a token that already begins a segment, leaving the boundaries alone',
      {
        analysis: analysisOf(phrase('pl-1', [GOD, CREATED, AND])),
        edit: { kind: 'split', tokenRef: AND.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({ 'pl-1': refs(GOD, CREATED) });
          expect(segmentation).toBeUndefined();
        },
      },
    ],
    [
      'clears the boundaries once a split restores the default verse segmentation',
      {
        analysis: emptyAnalysis(),
        segmentation: MERGED,
        edit: { kind: 'split', tokenRef: AND.tokenRef },
        expectStore: (_store, segmentation) => {
          expect(segmentation).toBeUndefined();
        },
      },
    ],
    [
      'keeps the boundaries set in another book',
      {
        analysis: emptyAnalysis(),
        segmentation: { removedVerseStarts: ['EXO 1:2:0'], addedStarts: [] },
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
        expectStore: (_store, segmentation) => {
          expect(segmentation).toStrictEqual({
            removedVerseStarts: ['EXO 1:2:0'],
            addedStarts: [GOD],
          });
        },
      },
    ],
    [
      'moves a boundary to pull an edge token across it, breaking the phrase it cuts',
      {
        analysis: analysisOf(phrase('pl-1', [AND, THE_2]), phrase('pl-2', [GOD, CREATED])),
        edit: { kind: 'move', fromRef: AND.tokenRef, toRef: THE_2.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({ 'pl-2': refs(GOD, CREATED) });
          expect(segmentation).toStrictEqual({
            removedVerseStarts: [AND.tokenRef],
            addedStarts: [THE_2],
          });
        },
      },
    ],
    [
      'moves a boundary into the gap of a discontiguous phrase, breaking the phrase',
      {
        analysis: analysisOf(phrase('pl-1', [THE, GOD, CREATED])),
        segmentation: { removedVerseStarts: [], addedStarts: [THE] },
        edit: { kind: 'move', fromRef: THE.tokenRef, toRef: BEGINNING.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({ 'pl-1': refs(GOD, CREATED) });
          expect(segmentation).toStrictEqual({ removedVerseStarts: [], addedStarts: [BEGINNING] });
        },
      },
    ],
    [
      'clears the boundaries once a move restores the default verse segmentation',
      {
        analysis: analysisOf(phrase('pl-1', [GOD, CREATED])),
        segmentation: { removedVerseStarts: [], addedStarts: [CREATED] },
        edit: { kind: 'move', fromRef: CREATED.tokenRef, toRef: AND.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({ 'pl-1': refs(GOD, CREATED) });
          expect(segmentation).toBeUndefined();
        },
      },
    ],
    [
      'merges a segment into the one before it, leaving the phrases alone',
      {
        analysis: analysisOf(phrase('pl-1', [GOD, CREATED]), phrase('pl-2', [AND, THE_2])),
        edit: { kind: 'merge', secondSegmentStartRef: AND.tokenRef },
        expectStore: (store, segmentation) => {
          expect(tokensOf(store)).toStrictEqual({
            'pl-1': refs(GOD, CREATED),
            'pl-2': refs(AND, THE_2),
          });
          expect(segmentation).toStrictEqual(MERGED);
        },
      },
    ],
    [
      'clears the boundaries once a merge restores the default verse segmentation',
      {
        analysis: emptyAnalysis(),
        segmentation: { removedVerseStarts: [], addedStarts: [GOD] },
        edit: { kind: 'merge', secondSegmentStartRef: GOD.tokenRef },
        expectStore: (_store, segmentation) => {
          expect(segmentation).toBeUndefined();
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, segmentation, edit, expectStore }) => {
    const outcome = await runBoundaryParity(
      VERSE_BOOK,
      { analysis, segmentation },
      edit,
      commandFor(edit),
    );

    expectStore(outcome.store, outcome.storeSegmentation);
    expect(outcome.host).toStrictEqual(outcome.store);
    expect(outcome.hostSegmentation).toStrictEqual(outcome.storeSegmentation);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });

  const noOps: [string, Omit<BoundaryCase, 'expectStore'>][] = [
    [
      'splitting before a token that already begins a segment',
      { analysis: emptyAnalysis(), edit: { kind: 'split', tokenRef: AND.tokenRef } },
    ],
    [
      'splitting where custom boundaries already begin a segment',
      {
        analysis: emptyAnalysis(),
        segmentation: { removedVerseStarts: [], addedStarts: [GOD] },
        edit: { kind: 'split', tokenRef: GOD.tokenRef },
      },
    ],
    [
      "merging the book's first segment, which has none before it",
      { analysis: emptyAnalysis(), edit: { kind: 'merge', secondSegmentStartRef: IN.tokenRef } },
    ],
    [
      'merging the segment after a heading, which has none before it to merge into',
      {
        analysis: emptyAnalysis(),
        segmentation: MERGED,
        edit: { kind: 'merge', secondSegmentStartRef: LIGHT.tokenRef },
      },
    ],
    [
      'moving a boundary onto the token it is at',
      {
        analysis: analysisOf(phrase('pl-1', [GOD, CREATED])),
        edit: { kind: 'move', fromRef: AND.tokenRef, toRef: AND.tokenRef },
      },
    ],
  ];

  it.each(noOps)(
    'stages nothing for %s, as the WebView changes nothing',
    async (_name, { analysis, segmentation, edit }) => {
      const outcome = await runBoundaryParity(
        VERSE_BOOK,
        { analysis, segmentation },
        edit,
        commandFor(edit),
      );

      expect(outcome.changes).toStrictEqual({ intent: 'parity' });
      expect(outcome.host).toStrictEqual(outcome.store);
      expect(outcome.storeSegmentation).toStrictEqual(segmentation);
      expect(outcome.hostSegmentation).toStrictEqual(segmentation);
    },
  );
});
