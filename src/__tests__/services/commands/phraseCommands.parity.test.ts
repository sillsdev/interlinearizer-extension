/// <reference types="jest" />

import type { UnknownAction } from '@reduxjs/toolkit';
import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import type { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  approvePhrase as approveCommand,
  createPhrase as createCommand,
  deletePhrase as deleteCommand,
  mergePhrases as mergeCommand,
  splitPhrase as splitCommand,
  updatePhrase as updateCommand,
  writePhraseGloss as writeGlossCommand,
} from '../../../services/commands/phraseCommands';
import {
  approvePhrase,
  createPhrase,
  deletePhrase,
  mergePhrases,
  updatePhrase,
  writePhraseGloss,
} from '../../../store/analysisSlice';
import { emptyAnalysis } from '../../../types/empty-factories';
import { splitPhraseAtBoundary } from '../../../utils/phrase-arc';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { runParity } from './parity';

const NOW = '2026-06-01T00:00:00.000Z';
const EARLIER = { createdAt: '2025-06-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z' };
const STAMP = { forkId: 'fork', now: NOW };
const NEW = { linkId: 'new-link', analysisId: 'new-analysis' };

const WORDS = ['In', 'the', 'beginning', 'God', 'created'];

/** The snapshots of the words at `indexes` in verse `verse`, each verse holding {@link WORDS}. */
function run(verse: number, ...indexes: number[]): TokenSnapshot[] {
  return indexes.map((i) => ({ tokenRef: `GEN 1:${verse}:${i}`, surfaceText: WORDS[i] }));
}

function payload(
  id: string,
  surfaceText: string,
  fields: Partial<PhraseAnalysis> = {},
): PhraseAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText, ...fields };
}

function link(
  id: string,
  analysisId: string,
  tokens: TokenSnapshot[],
  fields: Partial<PhraseAnalysisLink> = {},
): PhraseAnalysisLink {
  return { id, analysisId, ...FIXTURE_STAMPS, status: 'approved', tokens, ...fields };
}

function analysisOf(
  phraseAnalyses: PhraseAnalysis[],
  phraseAnalysisLinks: PhraseAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), phraseAnalyses, phraseAnalysisLinks };
}

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

const linkOf = (store: TextAnalysis, id: string) =>
  store.phraseAnalysisLinks.find((l) => l.id === id);

const payloadOf = (store: TextAnalysis, id: string) =>
  store.phraseAnalyses.find((pa) => pa.id === id);

type ParityCase<Input> = {
  analysis: TextAnalysis;
  input: Input;
  /** What the reducer's result must show, so the case exercises the path it names. */
  expectStore: (store: TextAnalysis) => void;
};

/**
 * Runs `analysis` through both `action` and `command`, checking the reducer's result with
 * `expectStore` and that the command leaves the same analysis and consistent indexes.
 */
async function expectParity(
  { analysis, expectStore }: Omit<ParityCase<unknown>, 'input'>,
  action: UnknownAction | readonly UnknownAction[],
  command: (buffer: ChangeBuffer) => Promise<void>,
): Promise<void> {
  const outcome = await runParity(analysis, 'en', action, command);

  expectStore(outcome.store);
  expect(outcome.host).toStrictEqual(outcome.store);
  expect(outcome.indexDifferences).toStrictEqual([]);
}

describe('createPhrase parity with the reducer', () => {
  const cases: [string, ParityCase<TokenSnapshot[]>][] = [
    [
      'creates a payload and an approved link over the tokens',
      {
        analysis: emptyAnalysis(),
        input: run(1, 0, 1),
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([
            { id: 'new-analysis', createdAt: NOW, updatedAt: NOW, surfaceText: 'In the' },
          ]);
          expect(store.phraseAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: NOW,
              updatedAt: NOW,
              status: 'approved',
              tokens: run(1, 0, 1),
            },
          ]);
        },
      },
    ],
    [
      'shares a stored payload whose content matches, as that payload stands',
      {
        analysis: analysisOf(
          [payload('pa-in-the', 'in the')],
          [link('pl-other', 'pa-in-the', run(2, 0, 1))],
        ),
        input: run(1, 0, 1),
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([payload('pa-in-the', 'in the')]);
          expect(linkOf(store, 'new-link')?.analysisId).toBe('pa-in-the');
        },
      },
    ],
    [
      'shares the earliest created of several matching payloads',
      {
        analysis: analysisOf(
          [payload('pa-a', 'In the'), payload('pa-b', 'In the', EARLIER)],
          [link('pl-a', 'pa-a', run(2, 0, 1)), link('pl-b', 'pa-b', run(3, 0, 1))],
        ),
        input: run(1, 0, 1),
        expectStore: (store) => {
          expect(linkOf(store, 'new-link')?.analysisId).toBe('pa-b');
        },
      },
    ],
    [
      'makes a new payload when the stored one with the same text carries a gloss',
      {
        analysis: analysisOf(
          [payload('pa-in-the', 'In the', { gloss: { en: 'at first' } })],
          [link('pl-other', 'pa-in-the', run(2, 0, 1))],
        ),
        input: run(1, 0, 1),
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['new-analysis', 'pa-in-the']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: tokens, ...parityCase }) => {
    await expectParity(
      parityCase,
      {
        type: createPhrase.type,
        payload: { id: 'new-link', analysisId: 'new-analysis', tokens, now: NOW },
      },
      (buffer) => createCommand(buffer, { ...NEW, tokens, now: NOW }),
    );
  });
});

type UpdateInput = { phraseId: string; tokens: TokenSnapshot[] };

describe('updatePhrase parity with the reducer', () => {
  const cases: [string, ParityCase<UpdateInput>][] = [
    [
      'reshapes an unshared payload in place, re-deriving its surface text and keeping its gloss',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'in the' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the beginning', { gloss: { en: 'in the' }, updatedAt: NOW }),
          ]);
          expect(store.phraseAnalysisLinks).toStrictEqual([
            link('pl-1', 'pa-1', run(1, 0, 1, 2), { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'forks a payload a suggested occurrence shares, leaving that occurrence its surface text',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'in the' } })],
          [
            link('pl-1', 'pa-1', run(1, 0, 1)),
            link('pl-2', 'pa-1', run(2, 0, 1), { status: 'suggested' }),
          ],
        ),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['fork', 'pa-1']);
          expect(payloadOf(store, 'pa-1')?.surfaceText).toBe('In the');
          expect(payloadOf(store, 'fork')).toStrictEqual({
            id: 'fork',
            createdAt: NOW,
            updatedAt: NOW,
            surfaceText: 'In the beginning',
            gloss: { en: 'in the' },
          });
        },
      },
    ],
    [
      'folds the reshaped payload into a content-identical one',
      {
        analysis: analysisOf(
          [
            payload('pa-1', 'In the', { gloss: { en: 'x' } }),
            payload('pa-2', 'in the beginning', { ...EARLIER, gloss: { en: 'x' } }),
          ],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-2', run(2, 0, 1, 2))],
        ),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-2']);
          expect(linkOf(store, 'pl-1')).toStrictEqual(
            link('pl-1', 'pa-2', run(1, 0, 1, 2), { updatedAt: NOW }),
          );
        },
      },
    ],
    [
      'folds a fork back onto the shared payload when the new run reads the same',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { phraseId: 'pl-1', tokens: run(3, 0, 1) },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([payload('pa-1', 'In the')]);
          expect(linkOf(store, 'pl-1')?.analysisId).toBe('pa-1');
        },
      },
    ],
    [
      'removes the occurrence and its unshared payload on an empty run',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { phraseId: 'pl-1', tokens: [] },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'keeps a payload another occurrence shares when an empty run removes one occurrence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { phraseId: 'pl-1', tokens: [] },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-1']);
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-2']);
        },
      },
    ],
    [
      'gives an occurrence whose payload is missing the new run',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([
            link('pl-1', 'pa-missing', run(1, 0, 1, 2), { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown occurrence',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { phraseId: 'pl-unknown', tokens: [] },
        expectStore: (store) => {
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...parityCase }) => {
    await expectParity(
      parityCase,
      { type: updatePhrase.type, payload: { ...input, ...STAMP } },
      (buffer) => updateCommand(buffer, { ...input, ...STAMP }),
    );
  });
});

describe('deletePhrase parity with the reducer', () => {
  const cases: [string, ParityCase<string>][] = [
    [
      'removes the occurrence and its unshared payload',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-1',
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'keeps a payload a rejected occurrence still names',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [
            link('pl-1', 'pa-1', run(1, 0, 1)),
            link('pl-2', 'pa-1', run(1, 0, 1), { status: 'rejected' }),
          ],
        ),
        input: 'pl-1',
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-1']);
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-2']);
        },
      },
    ],
    [
      'removes an occurrence whose payload is missing',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: 'pl-1',
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown occurrence',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-unknown',
        expectStore: (store) => {
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: phraseId, ...parityCase }) => {
    await expectParity(parityCase, deletePhrase({ phraseId }), (buffer) =>
      deleteCommand(buffer, { phraseId }),
    );
  });
});

type MergeInput = { targetPhraseId: string; tokens: TokenSnapshot[]; absorbedPhraseId?: string };

describe('mergePhrases parity with the reducer', () => {
  const cases: [string, ParityCase<MergeInput>][] = [
    [
      'grows the target over the absorbed occurrence, removing it and its payload',
      {
        analysis: analysisOf(
          [
            payload('pa-1', 'In the', { gloss: { en: 'in the' } }),
            payload('pa-2', 'beginning God'),
          ],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-2', run(1, 2, 3))],
        ),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2, 3), absorbedPhraseId: 'pl-2' },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the beginning God', { gloss: { en: 'in the' }, updatedAt: NOW }),
          ]);
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
    [
      'grows the target over a token in no phrase',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1, 2));
          expect(payloadOf(store, 'pa-1')?.surfaceText).toBe('In the beginning');
        },
      },
    ],
    [
      'keeps a payload only the two shared with the target rather than forking it',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(1, 2, 3))],
        ),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2, 3), absorbedPhraseId: 'pl-2' },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the beginning God', { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'folds the grown payload into a content-identical one',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the'), payload('pa-3', 'In the beginning', EARLIER)],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-3', 'pa-3', run(2, 0, 1, 2))],
        ),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-3']);
          expect(linkOf(store, 'pl-1')?.analysisId).toBe('pa-3');
        },
      },
    ],
    [
      'still removes the absorbed occurrence when the target is gone',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the'), payload('pa-2', 'beginning God')],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-2', run(1, 2, 3))],
        ),
        input: {
          targetPhraseId: 'pl-unknown',
          tokens: run(1, 0, 1, 2, 3),
          absorbedPhraseId: 'pl-2',
        },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-1']);
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
    [
      'leaves the analysis alone when the absorbed occurrence is the target',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2), absorbedPhraseId: 'pl-1' },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...parityCase }) => {
    await expectParity(
      parityCase,
      { type: mergePhrases.type, payload: { ...input, ...STAMP } },
      (buffer) => mergeCommand(buffer, { ...input, ...STAMP }),
    );
  });
});

type GlossInput = { phraseId?: string; value: string };

describe('writePhraseGloss parity with the reducer', () => {
  const cases: [string, ParityCase<GlossInput>][] = [
    [
      'writes the gloss on an unshared payload',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { value: 'at first' },
        expectStore: (store) => {
          expect(store).toStrictEqual(
            analysisOf(
              [payload('pa-1', 'In the', { gloss: { en: 'at first' }, updatedAt: NOW })],
              [link('pl-1', 'pa-1', run(1, 0, 1), { updatedAt: NOW })],
            ),
          );
        },
      },
    ],
    [
      'forks a shared payload, glossing only this occurrence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { fr: 'au' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { value: 'at first' },
        expectStore: (store) => {
          expect(payloadOf(store, 'pa-1')?.gloss).toStrictEqual({ fr: 'au' });
          expect(payloadOf(store, 'fork')?.gloss).toStrictEqual({ fr: 'au', en: 'at first' });
          expect(linkOf(store, 'pl-1')?.analysisId).toBe('fork');
        },
      },
    ],
    [
      'joins a payload the gloss makes it identical to',
      {
        analysis: analysisOf(
          [
            payload('pa-1', 'In the', { gloss: { en: 'a' } }),
            payload('pa-2', 'in the', { ...EARLIER, gloss: { en: 'b' } }),
          ],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-2', run(2, 0, 1))],
        ),
        input: { value: 'b' },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['pa-2']);
          expect(linkOf(store, 'pl-1')).toStrictEqual(
            link('pl-1', 'pa-2', run(1, 0, 1), { updatedAt: NOW }),
          );
        },
      },
    ],
    [
      "clears the language's gloss on a blank value, keeping the others",
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'a', fr: 'au' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { value: '  ' },
        expectStore: (store) => {
          expect(store.phraseAnalyses[0].gloss).toStrictEqual({ fr: 'au' });
        },
      },
    ],
    [
      'drops the gloss once the clear leaves no language, keeping the phrase',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'a', fr: ' ' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the', { updatedAt: NOW }),
          ]);
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
    [
      'dates only the occurrence when a blank value leaves a shared payload as it was',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([payload('pa-1', 'In the')]);
          expect(linkOf(store, 'pl-1')).toStrictEqual(
            link('pl-1', 'pa-1', run(1, 0, 1), { updatedAt: NOW }),
          );
        },
      },
    ],
    [
      'leaves the analysis alone for an occurrence whose payload is missing',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: { value: 'at first' },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([
            link('pl-1', 'pa-missing', run(1, 0, 1)),
          ]);
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown occurrence',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { phraseId: 'pl-unknown', value: 'at first' },
        expectStore: (store) => {
          expect(store.phraseAnalyses).toStrictEqual([payload('pa-1', 'In the')]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...parityCase }) => {
    const { phraseId = 'pl-1', value } = input;
    await expectParity(
      parityCase,
      { type: writePhraseGloss.type, payload: { phraseId, value, ...STAMP } },
      (buffer) => writeGlossCommand(buffer, { phraseId, value, analysisLanguage: 'en', ...STAMP }),
    );
  });
});

describe('approvePhrase parity with the reducer', () => {
  const cases: [string, ParityCase<string>][] = [
    [
      'approves a suggested occurrence, keeping its confidence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1), { status: 'suggested', confidence: 'guess' })],
        ),
        input: 'pl-1',
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([
            link('pl-1', 'pa-1', run(1, 0, 1), { confidence: 'guess', updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'refuses while one of its tokens is in an approved phrase',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the'), payload('pa-2', 'the beginning')],
          [
            link('pl-1', 'pa-1', run(1, 0, 1), { status: 'suggested' }),
            link('pl-2', 'pa-2', run(1, 1, 2)),
          ],
        ),
        input: 'pl-1',
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.status).toBe('suggested');
        },
      },
    ],
    [
      'approves over tokens only in phrases not approved',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the'), payload('pa-2', 'the beginning')],
          [
            link('pl-1', 'pa-1', run(1, 0, 1), { status: 'suggested' }),
            link('pl-2', 'pa-2', run(1, 1, 2), { status: 'rejected' }),
          ],
        ),
        input: 'pl-1',
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.status).toBe('approved');
        },
      },
    ],
    [
      'leaves an approved occurrence as it was',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-1',
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown occurrence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1), { status: 'suggested' })],
        ),
        input: 'pl-unknown',
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.status).toBe('suggested');
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: phraseId, ...parityCase }) => {
    await expectParity(
      parityCase,
      { type: approvePhrase.type, payload: { phraseId, now: NOW } },
      (buffer) => approveCommand(buffer, { phraseId, now: NOW }),
    );
  });
});

/** Document order over the words of the verses the split fixtures use. */
const DOC_ORDER = new Map(
  [1, 2, 3].flatMap((verse) =>
    run(verse, 0, 1, 2, 3, 4).map(({ tokenRef }, i) => [tokenRef, verse * 10 + i] as const),
  ),
);

type SplitInput = { splitAfterTokenRef: string; tokenDocOrder?: ReadonlyMap<string, number> };

/**
 * The actions the WebView's split dispatches for `input` over `pl-1`, each stamped as its `prepare`
 * would stamp it.
 */
function splitActions(analysis: TextAnalysis, input: SplitInput): UnknownAction[] {
  const phrase = analysis.phraseAnalysisLinks.find(({ id }) => id === 'pl-1');
  if (!phrase) throw new Error('The split fixtures hold pl-1');
  const actions: UnknownAction[] = [];
  splitPhraseAtBoundary(
    phrase,
    input.splitAfterTokenRef,
    {
      createPhrase: (tokens) => {
        actions.push({
          type: createPhrase.type,
          payload: { id: 'new-link', analysisId: 'new-analysis', tokens, now: NOW },
        });
        return 'new-link';
      },
      updatePhrase: (phraseId, tokens) => {
        actions.push({ type: updatePhrase.type, payload: { phraseId, tokens, ...STAMP } });
      },
      deletePhrase: (phraseId) => {
        actions.push(deletePhrase({ phraseId }));
      },
    },
    input.tokenDocOrder ?? DOC_ORDER,
  );
  return actions;
}

describe('splitPhrase parity with the WebView split', () => {
  const cases: [string, ParityCase<SplitInput>][] = [
    [
      'shrinks to the first half and makes the second a phrase when both keep two tokens',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning God', { gloss: { en: 'x' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2, 3))],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectStore: (store) => {
          expect(payloadOf(store, 'pa-1')).toStrictEqual(
            payload('pa-1', 'In the', { gloss: { en: 'x' }, updatedAt: NOW }),
          );
          expect(payloadOf(store, 'new-analysis')).toStrictEqual({
            id: 'new-analysis',
            createdAt: NOW,
            updatedAt: NOW,
            surfaceText: 'beginning God',
          });
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
          expect(linkOf(store, 'new-link')?.tokens).toStrictEqual(run(1, 2, 3));
        },
      },
    ],
    [
      'removes a phrase of two tokens',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:0' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'shrinks to the second half, leaving the first token in no phrase',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning')],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2))],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:0' },
        expectStore: (store) => {
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 1, 2));
        },
      },
    ],
    [
      'shrinks to the first half, leaving the last token in no phrase',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning')],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2))],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectStore: (store) => {
          expect(ids(store.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
        },
      },
    ],
    [
      'splits in document order when the stored tokens are out of order',
      {
        analysis: analysisOf(
          [payload('pa-1', 'beginning In the God')],
          [link('pl-1', 'pa-1', run(1, 2, 0, 1, 3))],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
          expect(linkOf(store, 'new-link')?.tokens).toStrictEqual(run(1, 2, 3));
        },
      },
    ],
    [
      'sorts a token the order does not place as if at place zero',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning God')],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2, 3))],
        ),
        input: {
          splitAfterTokenRef: 'GEN 1:1:3',
          tokenDocOrder: new Map(run(1, 0, 1, 2).map(({ tokenRef }, i) => [tokenRef, i])),
        },
        expectStore: (store) => {
          expect(linkOf(store, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 3));
          expect(linkOf(store, 'new-link')?.tokens).toStrictEqual(run(1, 1, 2));
        },
      },
    ],
    [
      'forks a shared payload and shares a stored one for the second half',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning God'), payload('pa-bg', 'beginning God')],
          [
            link('pl-1', 'pa-1', run(1, 0, 1, 2, 3)),
            link('pl-2', 'pa-1', run(2, 0, 1, 2, 3)),
            link('pl-3', 'pa-bg', run(3, 2, 3)),
          ],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectStore: (store) => {
          expect(ids(store.phraseAnalyses)).toStrictEqual(['fork', 'pa-1', 'pa-bg']);
          expect(linkOf(store, 'pl-1')?.analysisId).toBe('fork');
          expect(linkOf(store, 'new-link')?.analysisId).toBe('pa-bg');
        },
      },
    ],
    [
      'leaves the analysis alone when splitting after the last token',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
    [
      'leaves the analysis alone for a token not in the phrase',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:4' },
        expectStore: (store) => {
          expect(store.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...parityCase }) => {
    await expectParity(parityCase, splitActions(parityCase.analysis, input), (buffer) =>
      splitCommand(buffer, {
        ...NEW,
        ...STAMP,
        phraseId: 'pl-1',
        splitAfterTokenRef: input.splitAfterTokenRef,
        tokenDocOrder: input.tokenDocOrder ?? DOC_ORDER,
      }),
    );
  });
});
