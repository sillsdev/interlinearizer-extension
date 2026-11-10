/// <reference types="jest" />

import type {
  MergedContent,
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
import { FIXTURE_STAMPS } from '../../test-helpers';
import {
  analysisOf,
  EARLIER,
  expectRemovalPreview,
  LATER,
  link,
  morpheme,
  NOW,
  OTHER_TOKEN,
  type CommandCase,
  payload,
  runCommand,
  TOKEN,
} from './command-runs';

const THIRD_TOKEN = 'GEN 1:3:0';
const SENSE = { authority: 'x-test', senseId: 'sense-in' };
const OTHER_SENSE = { authority: 'x-test', senseId: 'sense-at' };

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
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-1',
              analysisId: 'ta-in',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
            },
            {
              id: 'tl-2',
              analysisId: 'ta-in',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'In' },
            },
          ]);
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
              morphemes: [morpheme('m-in', 'in', 'qaa')],
            }),
          ],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in', value: '  ' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', {
              glossSenseRef: SENSE,
              morphemes: [morpheme('m-in', 'in', 'qaa')],
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
            link('tl-suggested', 'ta-in', OTHER_TOKEN, 'In', { status: 'suggested' }),
            link('tl-stale', 'ta-in', THIRD_TOKEN, 'In', { status: 'stale' }),
            link('tl-on', 'ta-on', THIRD_TOKEN, 'In', { status: 'suggested' }),
          ],
        ),
        input: { analysisId: 'ta-in', value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-on',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'On',
            },
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-on',
              analysisId: 'ta-on',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'suggested',
              token: { tokenRef: 'GEN 1:3:0', surfaceText: 'In' },
            },
          ]);
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
          link('tl-a', 'ta-a', TOKEN, 'In', LATER),
          link('tl-b', 'ta-b', TOKEN, 'In', { ...EARLIER, status: 'suggested' }),
        ]),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-b', TOKEN, 'In', { ...LATER, createdAt: EARLIER.createdAt }),
          ]);
        },
      },
    ],
    [
      "clears the sibling's stale mark when the edited breakdown is not stale",
      {
        analysis: homographs(
          { gloss: { en: 'at' }, morphemes: [morpheme('m-a', 'in', 'qaa')] },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in', 'qaa')], morphemesStale: true },
        ),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', {
              gloss: { en: 'in' },
              morphemes: [morpheme('m-b', 'in', 'qaa')],
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
          { gloss: { en: 'at' }, morphemes: [morpheme('m-a', 'in', 'qaa')], morphemesStale: true },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in', 'qaa')], morphemesStale: true },
        ),
        input: { analysisId: 'ta-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-b', 'In', {
              gloss: { en: 'in' },
              morphemes: [morpheme('m-b', 'in', 'qaa')],
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

    expectResult(outcome.result);
  });
});

describe('clearAnalysisGlosses', () => {
  const cases: [string, CommandCase<{ analysisIds: string[] }>][] = [
    [
      'clears the gloss of each analysis',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at' },
              morphemes: [morpheme('m-in', 'in', 'qaa')],
            }),
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
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-in',
              analysisId: 'ta-in',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
            },
            {
              id: 'tl-on',
              analysisId: 'ta-on',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'In' },
            },
          ]);
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
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-on',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'On',
              pos: 'p',
            },
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-on',
              analysisId: 'ta-on',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'In' },
            },
          ]);
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

    expectResult(outcome.result);
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
              morphemes: [
                morpheme('m-in', 'in', 'qaa', { gloss: { en: 'in' } }),
                morpheme('m-to', 'to', 'qaa'),
              ],
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
            morpheme('m-in', 'in', 'qaa', { gloss: { en: 'in' }, writingSystem: 'qab' }),
            morpheme('new-2', 'side', 'qaa', { writingSystem: 'qab' }),
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
              morphemes: [morpheme('m-in', 'in', 'qaa')],
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
            payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in', 'qaa')], updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'removes the breakdown for no forms, keeping an analysis with a gloss',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at' },
              morphemes: [morpheme('m-in', 'in', 'qaa')],
            }),
          ],
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
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in', 'qaa')] })],
          [
            link('tl-1', 'ta-in', TOKEN),
            link('tl-2', 'ta-in', OTHER_TOKEN, 'In', { status: 'stale' }),
          ],
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
          {
            gloss: { en: 'in' },
            morphemes: [morpheme('m-a', 'i', 'qaa'), morpheme('m-n', 'n', 'qaa')],
          },
          { gloss: { en: 'in' }, morphemes: [morpheme('m-b', 'in', 'qaa')] },
        ),
        input: {
          analysisId: 'ta-a',
          morphemes: [{ id: 'new-1', form: 'in' }],
          writingSystem: 'qaa',
        },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'in' },
              morphemes: [{ id: 'm-b', form: 'in', writingSystem: 'qaa' }],
            },
          ]);
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

    expectResult(outcome.result);
  });
});

describe('confirmAnalysisMorphemes', () => {
  const cases: [string, CommandCase<{ analysisId: string }>][] = [
    [
      'clears the stale mark, keeping the breakdown',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              morphemes: [morpheme('m-in', 'in', 'qaa')],
              morphemesStale: true,
            }),
          ],
          [link('tl-1', 'ta-in', TOKEN)],
        ),
        input: { analysisId: 'ta-in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in', 'qaa')], updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'changes nothing when the breakdown is not stale',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in', 'qaa')] })],
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

    expectResult(outcome.result);
  });
});

type MorphemeGlossInput = { analysisId: string; morphemeId: string; value: string };

describe('writeAnalysisMorphemeGloss', () => {
  const glossed = (gloss?: Record<string, string>) =>
    analysisOf(
      [
        payload('ta-in', 'Into', {
          morphemes: [morpheme('m-in', 'in', 'qaa', { gloss }), morpheme('m-to', 'to', 'qaa')],
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
            morpheme('m-in', 'in', 'qaa'),
            morpheme('m-to', 'to', 'qaa'),
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
          expect(result.tokenAnalyses[0].morphemes?.[0]).toStrictEqual(
            morpheme('m-in', 'in', 'qaa'),
          );
          expect(result.tokenAnalyses[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'folds an analysis the write makes identical into the sibling',
      {
        analysis: homographs(
          { morphemes: [morpheme('m-a', 'in', 'qaa')] },
          { morphemes: [morpheme('m-b', 'in', 'qaa', { gloss: { en: 'in' } })] },
        ),
        input: { analysisId: 'ta-a', morphemeId: 'm-a', value: 'in' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              morphemes: [{ id: 'm-b', form: 'in', writingSystem: 'qaa', gloss: { en: 'in' } }],
            },
          ]);
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

    expectResult(outcome.result);
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
            link('tl-in-stale', 'ta-in', OTHER_TOKEN, 'In', { status: 'stale' }),
            link('tl-on', 'ta-on', THIRD_TOKEN, 'In', { status: 'suggested' }),
            link('tl-to', 'ta-to', OTHER_TOKEN),
          ],
        ),
        input: { analysisIds: ['ta-in', 'ta-on'] },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-to',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'To',
              gloss: { en: 'toward' },
            },
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-to',
              analysisId: 'ta-to',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'In' },
            },
          ]);
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
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-in',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'at' },
            },
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-in',
              analysisId: 'ta-in',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
            },
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      deleteAnalysesCommand(buffer, input),
    );

    expectResult(outcome.result);
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
            link('tl-a', 'ta-s', OTHER_TOKEN, 'In', { updatedAt: NOW }),
            link('tl-b', 'ta-s', THIRD_TOKEN, 'In', { updatedAt: NOW }),
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
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'into' },
            },
            {
              id: 'ta-s',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'in' },
            },
          ]);
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
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-a',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'at' },
            },
            {
              id: 'ta-b',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'into' },
            },
            {
              id: 'ta-s',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In',
              gloss: { en: 'in' },
            },
          ]);
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
            link('tl-s', 'ta-s', TOKEN, 'In', { ...EARLIER, status: 'suggested' }),
            link('tl-a', 'ta-a', TOKEN, 'In', LATER),
          ],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-s', TOKEN, 'In', { createdAt: EARLIER.createdAt, updatedAt: NOW }),
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
            link('tl-s', 'ta-s', TOKEN, 'In', { ...LATER, status: 'suggested' }),
            link('tl-a', 'ta-a', TOKEN, 'In', { ...EARLIER, status: 'candidate' }),
          ],
        ),
        input: {
          survivorAnalysisId: 'ta-s',
          mergedAnalysisIds: ['ta-a'],
          content: settled('in'),
        },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-a', 'ta-s', TOKEN, 'In', {
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
              morpheme('m-i', 'i', 'qaa', { gloss: { en: ' ' } }),
              morpheme('m-n', 'n', 'qaa', { gloss: { en: ' ', fr: 'n' } }),
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
              morphemes: [
                morpheme('m-i', 'i', 'qaa'),
                morpheme('m-n', 'n', 'qaa', { gloss: { fr: 'n' } }),
              ],
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
          morphemes: [morpheme('m-in', 'in', 'qaa')],
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

    expectResult(outcome.result);
  });
});
