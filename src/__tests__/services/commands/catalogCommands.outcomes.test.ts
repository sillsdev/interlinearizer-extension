/// <reference types="jest" />

import type {
  MergedContent,
  MorphemeAnalysis,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import {
  clearAnalysisGlosses as clearGlossesCommand,
  confirmAnalysisMorphemes as confirmMorphemesCommand,
  deleteAnalyses as deleteAnalysesCommand,
  mergeAnalysesInto as mergeCommand,
  writeAnalysisGloss as writeGlossCommand,
  writeAnalysisMorphemeGloss as writeMorphemeGlossCommand,
  writeAnalysisMorphemes as writeMorphemesCommand,
} from '../../../services/commands/catalogCommands';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { expectRemovalPreview, NOW, runCommand, type CommandOutcome } from './command-runs';

function payload(id: string, surfaceText: string, fields: Partial<TokenAnalysis> = {}) {
  return { id, ...FIXTURE_STAMPS, surfaceText, ...fields };
}

function morpheme(id: string, form: string, fields: Partial<MorphemeAnalysis> = {}) {
  return { id, form, writingSystem: 'qaa', ...fields };
}

function link(
  id: string,
  analysisId: string,
  tokenRef: string,
  fields: Partial<TokenAnalysisLink> = {},
): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'In' },
    ...fields,
  };
}

function analysisOf(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks };
}

const EARLIER = { createdAt: '2025-06-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z' };
const LATER = { createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
const TOKEN = 'GEN 1:1:0';
const OTHER_TOKEN = 'GEN 1:2:0';
const THIRD_TOKEN = 'GEN 1:3:0';
const SENSE = { authority: 'x-test', senseId: 'sense-in' };
const OTHER_SENSE = { authority: 'x-test', senseId: 'sense-at' };

type CommandCase<Input> = {
  analysis: TextAnalysis;
  input: Input;
  /** What the command's result must show, so the case exercises the path it names. */
  expectResult: (result: TextAnalysis) => void;
};

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

function expectOutcome(outcome: CommandOutcome, expectResult: (result: TextAnalysis) => void) {
  expectResult(outcome.result);
  expect(outcome.indexDifferences).toStrictEqual([]);
}

/** Two homographs glossed apart, each approved on its own token. */
function homographs(
  edited: Partial<TokenAnalysis>,
  sibling: Partial<TokenAnalysis>,
  links: TokenAnalysisLink[] = [link('tl-a', 'ta-a', TOKEN), link('tl-b', 'ta-b', OTHER_TOKEN)],
): TextAnalysis {
  return analysisOf([payload('ta-a', 'In', edited), payload('ta-b', 'In', sibling)], links);
}

type GlossInput = { analysisId: string; value: string };

describe('writeAnalysisGloss', () => {
  const cases: [string, CommandCase<GlossInput>][] = [
    [
      'rewrites the gloss for every linked token, keeping its sense',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at', fr: 'à' }, glossSenseRef: SENSE })],
          [link('tl-1', 'ta-in', TOKEN), link('tl-2', 'ta-in', OTHER_TOKEN)],
        ),
        input: { analysisId: 'ta-in', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', {
              gloss: { en: 'in', fr: 'à' },
              glossSenseRef: SENSE,
              updatedAt: NOW,
            }),
          ]);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-1', 'tl-2']);
        },
      },
    ],
    [
      'adds a gloss in a language the analysis lacked',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { fr: 'à' } })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in', value: 'at' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].gloss).toStrictEqual({ fr: 'à', en: 'at' });
        },
      },
    ],
    [
      'clears the gloss, keeping the sense while another language holds text',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at', fr: 'à' }, glossSenseRef: SENSE })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in', value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { gloss: { fr: 'à' }, glossSenseRef: SENSE, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'keeps the sense when clearing the last gloss text',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at' },
              glossSenseRef: SENSE,
              morphemes: [morpheme('m-in', 'in')],
            }),
          ],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in', value: '  ' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', {
              glossSenseRef: SENSE,
              morphemes: [morpheme('m-in', 'in')],
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      'removes an analysis the clear empties, with its links of every status',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } }), payload('ta-on', 'On')],
          [
            link('tl-approved', 'ta-in', TOKEN),
            link('tl-suggested', 'ta-in', OTHER_TOKEN, { status: 'suggested' }),
            link('tl-stale', 'ta-in', THIRD_TOKEN, { status: 'stale' }),
            link('tl-on', 'ta-on', THIRD_TOKEN, { status: 'suggested' }),
          ],
        ),
        input: { analysisId: 'ta-in', value: '' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-on']);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-on']);
        },
      },
    ],
    [
      'folds an analysis the write makes identical into the sibling, moving its links',
      {
        analysis: homographs({ gloss: { en: 'at' } }, { gloss: { en: 'in' } }),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', { gloss: { en: 'in' } }),
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-b', TOKEN),
            link('tl-b', 'ta-b', OTHER_TOKEN),
          ]);
        },
      },
    ],
    [
      'leaves a token linking both payloads one link, approved, dated by the earlier',
      {
        analysis: homographs({ gloss: { en: 'at' } }, { gloss: { en: 'in' } }, [
          link('tl-a', 'ta-a', TOKEN, LATER),
          link('tl-b', 'ta-b', TOKEN, { ...EARLIER, status: 'suggested' }),
        ]),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-b', TOKEN, { ...LATER, createdAt: EARLIER.createdAt }),
          ]);
        },
      },
    ],
    [
      "clears the sibling's stale mark when the edited breakdown is not stale",
      {
        analysis: homographs(
          { gloss: { en: 'at' }, morphemes: [morpheme('m-a', 'in')] },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in')], morphemesStale: true },
        ),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', {
              gloss: { en: 'in' },
              morphemes: [morpheme('m-b', 'in')],
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      "keeps the sibling's stale mark when both breakdowns are stale",
      {
        analysis: homographs(
          { gloss: { en: 'at' }, morphemes: [morpheme('m-a', 'in')], morphemesStale: true },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in')], morphemesStale: true },
        ),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', {
              gloss: { en: 'in' },
              morphemes: [morpheme('m-b', 'in')],
              morphemesStale: true,
            }),
          ]);
        },
      },
    ],
    [
      'changes nothing for an analysis that is not stored',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-missing', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeGlossCommand(buffer, { ...input, analysisLanguage: 'en', now: NOW }),
    );

    expectOutcome(outcome, expectResult);
  });
});

describe('clearAnalysisGlosses', () => {
  const cases: [string, CommandCase<{ analysisIds: string[] }>][] = [
    [
      'clears the gloss of each analysis',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' }, morphemes: [morpheme('m-in', 'in')] }),
            payload('ta-on', 'On', { gloss: { en: 'upon' }, pos: 'prep' }),
          ],
          [link('tl-in', 'ta-in', TOKEN), link('tl-on', 'ta-on', OTHER_TOKEN)],
        ),
        input: { analysisIds: ['ta-in', 'ta-on'] },
        expectResult: (result) => {
          expect(result.tokenAnalyses.map(({ gloss }) => gloss)).toStrictEqual([
            undefined,
            undefined,
          ]);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-in', 'tl-on']);
        },
      },
    ],
    [
      'removes the analyses the clears empty, with their links',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } }), payload('ta-on', 'On', { pos: 'p' })],
          [link('tl-in', 'ta-in', TOKEN), link('tl-on', 'ta-on', OTHER_TOKEN)],
        ),
        input: { analysisIds: ['ta-in', 'ta-on'] },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-on']);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-on']);
        },
      },
    ],
    [
      'clears an analysis that an earlier clear folded another into',
      {
        analysis: homographs({ gloss: { en: 'at', fr: 'à' } }, { gloss: { fr: 'à' } }),
        input: { analysisIds: ['ta-a', 'ta-b'] },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', { gloss: { fr: 'à' }, updatedAt: NOW }),
          ]);
          expect(result.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toStrictEqual([
            'ta-b',
            'ta-b',
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      clearGlossesCommand(buffer, { ...input, analysisLanguage: 'en', now: NOW }),
    );

    expectOutcome(outcome, expectResult);
    expectRemovalPreview(outcome, analysis);
  });
});

type MorphemesInput = {
  analysisId: string;
  morphemes: { id: string; form: string }[];
  writingSystem: string;
};

describe('writeAnalysisMorphemes', () => {
  const cases: [string, CommandCase<MorphemesInput>][] = [
    [
      'keeps the morpheme of a form the breakdown carried, adding new ones for the rest',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'Inside', {
              morphemes: [morpheme('m-in', 'in', { gloss: { en: 'in' } }), morpheme('m-to', 'to')],
            }),
          ],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: {
          analysisId: 'ta-in',
          morphemes: [
            { id: 'new-1', form: 'in' },
            { id: 'new-2', form: 'side' },
          ],
          writingSystem: 'qab',
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes).toStrictEqual([
            morpheme('m-in', 'in', { gloss: { en: 'in' }, writingSystem: 'qab' }),
            morpheme('new-2', 'side', { writingSystem: 'qab' }),
          ]);
          expect(result.tokenAnalyses[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'clears the stale mark',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              morphemes: [morpheme('m-in', 'in')],
              morphemesStale: true,
            }),
          ],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: {
          analysisId: 'ta-in',
          morphemes: [{ id: 'new-1', form: 'in' }],
          writingSystem: 'qaa',
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')], updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'removes the breakdown for no forms, keeping an analysis with a gloss',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' }, morphemes: [morpheme('m-in', 'in')] })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in', morphemes: [], writingSystem: 'qaa' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { gloss: { en: 'at' }, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'removes an analysis left empty, with its links',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')] })],
          [link('tl-1', 'ta-in', TOKEN), link('tl-2', 'ta-in', OTHER_TOKEN, { status: 'stale' })],
        ),
        input: { analysisId: 'ta-in', morphemes: [], writingSystem: 'qaa' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([]);
          expect(result.tokenAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      'folds an analysis the re-split makes identical into the sibling',
      {
        analysis: homographs(
          { gloss: { en: 'in' }, morphemes: [morpheme('m-a', 'i'), morpheme('m-n', 'n')] },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in')] },
        ),
        input: {
          analysisId: 'ta-a',
          morphemes: [{ id: 'new-1', form: 'in' }],
          writingSystem: 'qaa',
        },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-b']);
          expect(result.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toStrictEqual([
            'ta-b',
            'ta-b',
          ]);
        },
      },
    ],
    [
      'changes nothing for an analysis that is not stored',
      {
        analysis: analysisOf([payload('ta-in', 'In', { gloss: { en: 'at' } })], []),
        input: { analysisId: 'ta-missing', morphemes: [], writingSystem: 'qaa' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeMorphemesCommand(buffer, { ...input, now: NOW }),
    );

    expectOutcome(outcome, expectResult);
  });
});

describe('confirmAnalysisMorphemes', () => {
  const cases: [string, CommandCase<{ analysisId: string }>][] = [
    [
      'clears the stale mark, keeping the breakdown',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')], morphemesStale: true })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')], updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'changes nothing when the breakdown is not stale',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')] })],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'changes nothing for an analysis that is not stored',
      {
        analysis: analysisOf([payload('ta-in', 'In', { gloss: { en: 'at' } })], []),
        input: { analysisId: 'ta-missing' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      confirmMorphemesCommand(buffer, { ...input, now: NOW }),
    );

    expectOutcome(outcome, expectResult);
  });
});

type MorphemeGlossInput = { analysisId: string; morphemeId: string; value: string };

describe('writeAnalysisMorphemeGloss', () => {
  const glossed = (gloss?: Record<string, string>) =>
    analysisOf(
      [
        payload('ta-in', 'Into', {
          morphemes: [morpheme('m-in', 'in', { gloss }), morpheme('m-to', 'to')],
        }),
      ],
      [link('tl-1', 'ta-in', TOKEN)],
    );

  const cases: [string, CommandCase<MorphemeGlossInput>][] = [
    [
      "writes a morpheme's first gloss",
      {
        analysis: glossed(),
        input: { analysisId: 'ta-in', morphemeId: 'm-in', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ en: 'in' });
          expect(result.tokenAnalyses[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      "rewrites one language's gloss, keeping the others",
      {
        analysis: glossed({ en: 'at', fr: 'dans' }),
        input: { analysisId: 'ta-in', morphemeId: 'm-in', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({
            en: 'in',
            fr: 'dans',
          });
        },
      },
    ],
    [
      'clears the gloss and keeps the morpheme, dropping the emptied gloss map',
      {
        analysis: glossed({ en: 'in' }),
        input: { analysisId: 'ta-in', morphemeId: 'm-in', value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes).toStrictEqual([
            morpheme('m-in', 'in'),
            morpheme('m-to', 'to'),
          ]);
        },
      },
    ],
    [
      'clears one language, keeping the others',
      {
        analysis: glossed({ en: 'in', fr: 'dans' }),
        input: { analysisId: 'ta-in', morphemeId: 'm-in', value: ' ' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ fr: 'dans' });
        },
      },
    ],
    [
      'stamps the analysis when clearing a morpheme that has no gloss',
      {
        analysis: glossed(),
        input: { analysisId: 'ta-in', morphemeId: 'm-in', value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0]).toStrictEqual(morpheme('m-in', 'in'));
          expect(result.tokenAnalyses[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'folds an analysis the write makes identical into the sibling',
      {
        analysis: homographs(
          { morphemes: [morpheme('m-a', 'in')] },
          { morphemes: [morpheme('m-b', 'in', { gloss: { en: 'in' } })] },
        ),
        input: { analysisId: 'ta-a', morphemeId: 'm-a', value: 'in' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-b']);
          expect(result.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toStrictEqual([
            'ta-b',
            'ta-b',
          ]);
        },
      },
    ],
    [
      'changes nothing for a morpheme the analysis lacks',
      {
        analysis: glossed(),
        input: { analysisId: 'ta-in', morphemeId: 'm-missing', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'changes nothing for an analysis that is not stored',
      {
        analysis: glossed(),
        input: { analysisId: 'ta-missing', morphemeId: 'm-in', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeMorphemeGlossCommand(buffer, { ...input, analysisLanguage: 'en', now: NOW }),
    );

    expectOutcome(outcome, expectResult);
  });
});

describe('deleteAnalyses', () => {
  const cases: [string, CommandCase<{ analysisIds: string[] }>][] = [
    [
      'removes the analyses with every link to them',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
            payload('ta-on', 'On', { gloss: { en: 'upon' } }),
            payload('ta-to', 'To', { gloss: { en: 'toward' } }),
          ],
          [
            link('tl-in', 'ta-in', TOKEN),
            link('tl-in-stale', 'ta-in', OTHER_TOKEN, { status: 'stale' }),
            link('tl-on', 'ta-on', THIRD_TOKEN, { status: 'suggested' }),
            link('tl-to', 'ta-to', OTHER_TOKEN),
          ],
        ),
        input: { analysisIds: ['ta-in', 'ta-on'] },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-to']);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-to']);
        },
      },
    ],
    [
      'removes the links to an analysis that is not stored',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN), link('tl-dangling', 'ta-missing', OTHER_TOKEN)],
        ),
        input: { analysisIds: ['ta-missing'] },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-in']);
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-in']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      deleteAnalysesCommand(buffer, input),
    );

    expectOutcome(outcome, expectResult);
  });
});

type MergeInput = {
  survivorAnalysisId: string;
  mergedAnalysisIds: string[];
  content: MergedContent;
};

/** Settled content glossed `gloss`, with no breakdown. */
function settled(gloss: string, fields: Partial<MergedContent> = {}): MergedContent {
  return { gloss, morphemes: [], ...fields };
}

describe('mergeAnalysesInto', () => {
  /** A survivor and two donors of one spelling, each approved on its own token. */
  const threeHomographs = (
    survivor: Partial<TokenAnalysis> = { gloss: { en: 'in' } },
    donor: Partial<TokenAnalysis> = { gloss: { en: 'at' } },
    otherDonor: Partial<TokenAnalysis> = { gloss: { en: 'into' } },
  ) =>
    analysisOf(
      [
        payload('ta-s', 'In', survivor),
        payload('ta-a', 'In', donor),
        payload('ta-b', 'In', otherDonor),
      ],
      [
        link('tl-s', 'ta-s', TOKEN),
        link('tl-a', 'ta-a', OTHER_TOKEN),
        link('tl-b', 'ta-b', THIRD_TOKEN),
      ],
    );

  const cases: [string, CommandCase<MergeInput>][] = [
    [
      'folds the donors in, moving their links to the survivor and stamping them',
      {
        analysis: threeHomographs(),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-s', 'In', { gloss: { en: 'in' }, updatedAt: NOW }),
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-s', OTHER_TOKEN, { updatedAt: NOW }),
            link('tl-b', 'ta-s', THIRD_TOKEN, { updatedAt: NOW }),
            link('tl-s', 'ta-s', TOKEN),
          ]);
        },
      },
    ],
    [
      'skips a folded id naming the survivor or no stored analysis, and a repeated one',
      {
        analysis: threeHomographs(),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-s', 'ta-missing', 'ta-a', 'ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-b', 'ta-s']);
        },
      },
    ],
    [
      'changes nothing when the survivor is not stored',
      {
        analysis: threeHomographs(),
        input: {
          survivorAnalysisId: 'ta-missing',
          mergedAnalysisIds: ['ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-a', 'ta-b', 'ta-s']);
        },
      },
    ],
    [
      'leaves a token linking a donor and the survivor one link, approved, dated by the earlier',
      {
        analysis: analysisOf(
          [
            payload('ta-s', 'In', { gloss: { en: 'in' } }),
            payload('ta-a', 'In', { gloss: { en: 'at' } }),
          ],
          [
            link('tl-s', 'ta-s', TOKEN, { ...EARLIER, status: 'suggested' }),
            link('tl-a', 'ta-a', TOKEN, LATER),
          ],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-s', TOKEN, { createdAt: EARLIER.createdAt, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'keeps the latest of the links a token holds when none is approved',
      {
        analysis: analysisOf(
          [
            payload('ta-s', 'In', { gloss: { en: 'in' } }),
            payload('ta-a', 'In', { gloss: { en: 'at' } }),
          ],
          [
            link('tl-s', 'ta-s', TOKEN, { ...LATER, status: 'suggested' }),
            link('tl-a', 'ta-a', TOKEN, { ...EARLIER, status: 'candidate' }),
          ],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-s', TOKEN, {
              status: 'candidate',
              createdAt: EARLIER.createdAt,
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      "carries other languages' glosses from the donors, the most-preferred first",
      {
        analysis: threeHomographs(
          { gloss: { en: 'in', fr: 'dans' } },
          { gloss: { en: 'at', fr: 'à', de: 'an' } },
          { gloss: { de: 'bei', es: 'en' } },
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].gloss).toStrictEqual({
            en: 'in',
            fr: 'dans',
            de: 'an',
            es: 'en',
          });
        },
      },
    ],
    [
      'gives the survivor the sense of the donor its gloss came from',
      {
        analysis: threeHomographs(
          { gloss: { en: 'in' }, glossSenseRef: SENSE },
          { gloss: { en: 'at' }, glossSenseRef: OTHER_SENSE },
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('at', { glossFromAnalysisId: 'ta-a' }),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].glossSenseRef).toStrictEqual(OTHER_SENSE);
        },
      },
    ],
    [
      "keeps the survivor's sense when its gloss came from the survivor",
      {
        analysis: threeHomographs({ gloss: { en: 'in' }, glossSenseRef: SENSE }),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('in', { glossFromAnalysisId: 'ta-s' }),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].glossSenseRef).toStrictEqual(SENSE);
        },
      },
    ],
    [
      'drops the sense for a gloss the reader typed',
      {
        analysis: threeHomographs({ gloss: { en: 'in' }, glossSenseRef: SENSE }),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('inside'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0]).not.toHaveProperty('glossSenseRef');
        },
      },
    ],
    [
      'writes the settled content as given, dropping a blank morpheme gloss',
      {
        analysis: threeHomographs(),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('in', {
            morphemes: [
              morpheme('m-i', 'i', { gloss: { en: ' ' } }),
              morpheme('m-n', 'n', { gloss: { en: ' ', fr: 'n' } }),
            ],
            morphemesStale: true,
            pos: 'prep',
            features: { case: 'loc' },
            confidence: 'high',
          }),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-s', 'In', {
              gloss: { en: 'in' },
              morphemes: [morpheme('m-i', 'i'), morpheme('m-n', 'n', { gloss: { fr: 'n' } })],
              morphemesStale: true,
              pos: 'prep',
              features: { case: 'loc' },
              confidence: 'high',
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      'clears each field the merge settles on nothing for',
      {
        analysis: threeHomographs({
          gloss: { en: 'in' },
          morphemes: [morpheme('m-in', 'in')],
          morphemesStale: true,
          pos: 'prep',
          features: { case: 'loc' },
          confidence: 'high',
        }),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-s', 'In', { gloss: { en: 'in' }, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'removes a survivor the merge leaves empty, with every link to it',
      {
        analysis: threeHomographs(),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled(''),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([]);
          expect(result.tokenAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      'keeps a survivor holding only carried-over glosses',
      {
        analysis: threeHomographs({ gloss: { en: 'in' } }, { gloss: { fr: 'dans' } }),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a', 'ta-b'],
          content: settled(''),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-s', 'In', { gloss: { fr: 'dans' }, updatedAt: NOW }),
          ]);
          expect(result.tokenAnalysisLinks).toHaveLength(3);
        },
      },
    ],
    [
      'folds a survivor matching another payload into it, which takes its confidence',
      {
        analysis: analysisOf(
          [
            payload('ta-s', 'In', { gloss: { en: 'in' } }),
            payload('ta-a', 'In', { gloss: { en: 'at' } }),
            payload('ta-other', 'In', { gloss: { en: 'inside' }, confidence: 'low' }),
          ],
          [
            link('tl-s', 'ta-s', TOKEN),
            link('tl-a', 'ta-a', OTHER_TOKEN),
            link('tl-other', 'ta-other', THIRD_TOKEN),
          ],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a'],
          content: settled('inside', { confidence: 'high' }),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-other', 'In', {
              gloss: { en: 'inside' },
              confidence: 'high',
              updatedAt: NOW,
            }),
          ]);
          expect(result.tokenAnalysisLinks.map(({ analysisId }) => analysisId)).toStrictEqual([
            'ta-other',
            'ta-other',
            'ta-other',
          ]);
        },
      },
    ],
    [
      'clears the confidence of the payload a survivor without one folds into',
      {
        analysis: analysisOf(
          [
            payload('ta-s', 'In', { gloss: { en: 'in' } }),
            payload('ta-other', 'In', { gloss: { en: 'inside' }, confidence: 'low' }),
          ],
          [link('tl-s', 'ta-s', TOKEN), link('tl-other', 'ta-other', OTHER_TOKEN)],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: [],
          content: settled('inside'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-other', 'In', { gloss: { en: 'inside' }, updatedAt: NOW }),
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      mergeCommand(buffer, { ...input, analysisLanguage: 'en', now: NOW }),
    );

    expectOutcome(outcome, expectResult);
  });
});
