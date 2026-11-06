/// <reference types="jest" />

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
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { EARLIER, ids, NOW, type CommandCase, runCommand } from './command-runs';

const STAMP = { forkId: 'fork', now: NOW };
const NEW = { linkId: 'new-link', analysisId: 'new-analysis' };
const SENSE = { authority: 'fwlite', senseId: 's-beginning' } as const;

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

const linkOf = (result: TextAnalysis, id: string) =>
  result.phraseAnalysisLinks.find((l) => l.id === id);

const payloadOf = (result: TextAnalysis, id: string) =>
  result.phraseAnalyses.find((pa) => pa.id === id);

/**
 * Runs `analysis` through `command`, checking its result with `expectResult` and its indexes for
 * consistency.
 */
async function expectOutcome(
  { analysis, expectResult }: Omit<CommandCase<unknown>, 'input'>,
  command: (buffer: ChangeBuffer) => Promise<void>,
): Promise<void> {
  const outcome = await runCommand(analysis, 'en', command);

  expectResult(outcome.result);
  expect(outcome.indexDifferences).toStrictEqual([]);
}

describe('createPhrase', () => {
  const cases: [string, CommandCase<TokenSnapshot[]>][] = [
    [
      'creates a payload and an approved link over the tokens',
      {
        analysis: emptyAnalysis(),
        input: run(1, 0, 1),
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            { id: 'new-analysis', createdAt: NOW, updatedAt: NOW, surfaceText: 'In the' },
          ]);
          expect(result.phraseAnalysisLinks).toStrictEqual([
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([payload('pa-in-the', 'in the')]);
          expect(linkOf(result, 'new-link')?.analysisId).toBe('pa-in-the');
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
        expectResult: (result) => {
          expect(linkOf(result, 'new-link')?.analysisId).toBe('pa-b');
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['new-analysis', 'pa-in-the']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: tokens, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) =>
      createCommand(buffer, { ...NEW, tokens, now: NOW }),
    );
  });
});

type UpdateInput = { phraseId: string; tokens: TokenSnapshot[] };

describe('updatePhrase', () => {
  const cases: [string, CommandCase<UpdateInput>][] = [
    [
      'reshapes an unshared payload in place, re-deriving its surface text and keeping its gloss',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'in the' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the beginning', { gloss: { en: 'in the' }, updatedAt: NOW }),
          ]);
          expect(result.phraseAnalysisLinks).toStrictEqual([
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['fork', 'pa-1']);
          expect(payloadOf(result, 'pa-1')?.surfaceText).toBe('In the');
          expect(payloadOf(result, 'fork')).toStrictEqual({
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['pa-2']);
          expect(linkOf(result, 'pl-1')).toStrictEqual(
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([payload('pa-1', 'In the')]);
          expect(linkOf(result, 'pl-1')?.analysisId).toBe('pa-1');
        },
      },
    ],
    [
      'removes the occurrence and its unshared payload on an empty run',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { phraseId: 'pl-1', tokens: [] },
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['pa-1']);
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-2']);
        },
      },
    ],
    [
      'gives an occurrence whose payload is missing the new run',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: { phraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) => updateCommand(buffer, { ...input, ...STAMP }));
  });
});

describe('deletePhrase', () => {
  const cases: [string, CommandCase<string>][] = [
    [
      'removes the occurrence and its unshared payload',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-1',
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['pa-1']);
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-2']);
        },
      },
    ],
    [
      'removes an occurrence whose payload is missing',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: 'pl-1',
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown occurrence',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-unknown',
        expectResult: (result) => {
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: phraseId, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) => deleteCommand(buffer, { phraseId }));
  });
});

type MergeInput = { targetPhraseId: string; tokens: TokenSnapshot[]; absorbedPhraseId?: string };

describe('mergePhrases', () => {
  const cases: [string, CommandCase<MergeInput>][] = [
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the beginning God', { gloss: { en: 'in the' }, updatedAt: NOW }),
          ]);
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
    [
      'grows the target over a token in no phrase',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2) },
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1, 2));
          expect(payloadOf(result, 'pa-1')?.surfaceText).toBe('In the beginning');
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['pa-3']);
          expect(linkOf(result, 'pl-1')?.analysisId).toBe('pa-3');
        },
      },
    ],
    [
      'leaves the analysis alone for an unknown target',
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
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [payload('pa-1', 'In the'), payload('pa-2', 'beginning God')],
              [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-2', run(1, 2, 3))],
            ),
          );
        },
      },
    ],
    [
      'leaves the analysis alone when the absorbed occurrence is the target',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { targetPhraseId: 'pl-1', tokens: run(1, 0, 1, 2), absorbedPhraseId: 'pl-1' },
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) => mergeCommand(buffer, { ...input, ...STAMP }));
  });
});

type GlossInput = { phraseId?: string; value: string };

describe('writePhraseGloss', () => {
  const cases: [string, CommandCase<GlossInput>][] = [
    [
      'writes the gloss on an unshared payload',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { value: 'at first' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
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
        expectResult: (result) => {
          expect(payloadOf(result, 'pa-1')?.gloss).toStrictEqual({ fr: 'au' });
          expect(payloadOf(result, 'fork')?.gloss).toStrictEqual({ fr: 'au', en: 'at first' });
          expect(linkOf(result, 'pl-1')?.analysisId).toBe('fork');
        },
      },
    ],
    [
      'forks a shared payload on a blank value, clearing only this occurrence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'a', fr: 'au' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(payloadOf(result, 'pa-1')?.gloss).toStrictEqual({ en: 'a', fr: 'au' });
          expect(payloadOf(result, 'fork')?.gloss).toStrictEqual({ fr: 'au' });
          expect(linkOf(result, 'pl-1')?.analysisId).toBe('fork');
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['pa-2']);
          expect(linkOf(result, 'pl-1')).toStrictEqual(
            link('pl-1', 'pa-2', run(1, 0, 1), { updatedAt: NOW }),
          );
        },
      },
    ],
    [
      'keeps the sense ref through a write',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'a' }, senseRef: SENSE })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { value: 'at first' },
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the', {
              gloss: { en: 'at first' },
              senseRef: SENSE,
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      'keeps the sense ref through a blank value that clears the last gloss',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { en: 'a' }, senseRef: SENSE })],
          [link('pl-1', 'pa-1', run(1, 0, 1))],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the', { senseRef: SENSE, updatedAt: NOW }),
          ]);
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
        expectResult: (result) => {
          expect(result.phraseAnalyses[0].gloss).toStrictEqual({ fr: 'au' });
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([
            payload('pa-1', 'In the', { updatedAt: NOW }),
          ]);
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
        },
      },
    ],
    [
      'leaves the analysis alone for a blank value when the language has no gloss to clear',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the', { gloss: { fr: 'au' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [payload('pa-1', 'In the', { gloss: { fr: 'au' } })],
              [link('pl-1', 'pa-1', run(1, 0, 1)), link('pl-2', 'pa-1', run(2, 0, 1))],
            ),
          );
        },
      },
    ],
    [
      'leaves the analysis alone for an occurrence whose payload is missing',
      {
        analysis: analysisOf([], [link('pl-1', 'pa-missing', run(1, 0, 1))]),
        input: { value: 'at first' },
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([
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
        expectResult: (result) => {
          expect(result.phraseAnalyses).toStrictEqual([payload('pa-1', 'In the')]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...commandCase }) => {
    const { phraseId = 'pl-1', value } = input;
    await expectOutcome(commandCase, (buffer) =>
      writeGlossCommand(buffer, { phraseId, value, analysisLanguage: 'en', ...STAMP }),
    );
  });
});

describe('approvePhrase', () => {
  const cases: [string, CommandCase<string>][] = [
    [
      'approves a suggested occurrence, keeping its confidence',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the')],
          [link('pl-1', 'pa-1', run(1, 0, 1), { status: 'suggested', confidence: 'guess' })],
        ),
        input: 'pl-1',
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([
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
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.status).toBe('suggested');
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
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.status).toBe('approved');
        },
      },
    ],
    [
      'leaves an approved occurrence as it was',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: 'pl-1',
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
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
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.status).toBe('suggested');
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input: phraseId, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) => approveCommand(buffer, { phraseId, now: NOW }));
  });
});

/** Document order over the words of the verses the split fixtures use. */
const DOC_ORDER = new Map(
  [1, 2, 3].flatMap((verse) =>
    run(verse, 0, 1, 2, 3, 4).map(({ tokenRef }, i) => [tokenRef, verse * 10 + i] as const),
  ),
);

type SplitInput = { splitAfterTokenRef: string; tokenDocOrder?: ReadonlyMap<string, number> };

describe('splitPhrase split', () => {
  const cases: [string, CommandCase<SplitInput>][] = [
    [
      'shrinks to the first half and makes the second a phrase when both keep two tokens',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning God', { gloss: { en: 'x' } })],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2, 3))],
        ),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectResult: (result) => {
          expect(payloadOf(result, 'pa-1')).toStrictEqual(
            payload('pa-1', 'In the', { gloss: { en: 'x' }, updatedAt: NOW }),
          );
          expect(payloadOf(result, 'new-analysis')).toStrictEqual({
            id: 'new-analysis',
            createdAt: NOW,
            updatedAt: NOW,
            surfaceText: 'beginning God',
          });
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
          expect(linkOf(result, 'new-link')?.tokens).toStrictEqual(run(1, 2, 3));
        },
      },
    ],
    [
      'removes a phrase of two tokens',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:0' },
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 1, 2));
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalysisLinks)).toStrictEqual(['pl-1']);
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
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
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
          expect(linkOf(result, 'new-link')?.tokens).toStrictEqual(run(1, 2, 3));
        },
      },
    ],
    [
      'keeps a token the order does not place after the token stored before it',
      {
        analysis: analysisOf(
          [payload('pa-1', 'In the beginning God')],
          [link('pl-1', 'pa-1', run(1, 0, 1, 2, 3))],
        ),
        input: {
          splitAfterTokenRef: 'GEN 1:1:1',
          tokenDocOrder: new Map(run(1, 0, 1, 2).map(({ tokenRef }, i) => [tokenRef, i])),
        },
        expectResult: (result) => {
          expect(linkOf(result, 'pl-1')?.tokens).toStrictEqual(run(1, 0, 1));
          expect(linkOf(result, 'new-link')?.tokens).toStrictEqual(run(1, 2, 3));
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
        expectResult: (result) => {
          expect(ids(result.phraseAnalyses)).toStrictEqual(['fork', 'pa-1', 'pa-bg']);
          expect(linkOf(result, 'pl-1')?.analysisId).toBe('fork');
          expect(linkOf(result, 'new-link')?.analysisId).toBe('pa-bg');
        },
      },
    ],
    [
      'leaves the analysis alone when splitting after the last token',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:1' },
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
    [
      'leaves the analysis alone for a token not in the phrase',
      {
        analysis: analysisOf([payload('pa-1', 'In the')], [link('pl-1', 'pa-1', run(1, 0, 1))]),
        input: { splitAfterTokenRef: 'GEN 1:1:4' },
        expectResult: (result) => {
          expect(result.phraseAnalysisLinks).toStrictEqual([link('pl-1', 'pa-1', run(1, 0, 1))]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { input, ...commandCase }) => {
    await expectOutcome(commandCase, (buffer) =>
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
