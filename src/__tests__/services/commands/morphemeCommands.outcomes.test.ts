/// <reference types="jest" />

import {
  deleteMorphemes as deleteMorphemesCommand,
  writeMorphemeGloss as writeMorphemeGlossCommand,
  writeMorphemes as writeMorphemesCommand,
} from '../../../services/commands/morphemeCommands';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import {
  analysisOf,
  EARLIER,
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

/** A breakdown as the WebView prepares one: a fresh id per form. */
const forms = (...list: string[]) => list.map((form, i) => ({ id: `new-m-${i}`, form }));
const CAT_S = [morpheme('m-cat', 'cat', 'en'), morpheme('m-s', '-s', 'en')];

type MorphemesInput = {
  surfaceText?: string;
  writingSystem?: string;
  morphemes: { id: string; form: string }[];
};

describe('writeMorphemes', () => {
  const cases: [string, CommandCase<MorphemesInput>][] = [
    [
      'creates a payload and an approved link for an unanalyzed token',
      {
        analysis: emptyAnalysis(),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('new-analysis', 'cats', {
              createdAt: NOW,
              updatedAt: NOW,
              morphemes: [morpheme('new-m-0', 'cat', 'en'), morpheme('new-m-1', '-s', 'en')],
            }),
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'cats' },
            },
          ]);
        },
      },
    ],
    [
      'shares a stored payload whose breakdown matches, whatever its morpheme ids',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats')],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(result.tokenAnalysisLinks.find(({ id }) => id === 'new-link')?.analysisId).toBe(
            'ta-cats',
          );
        },
      },
    ],
    [
      "approves the token's held link to the matching payload rather than adding one",
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-held', 'ta-cats', TOKEN, 'cats', { status: 'suggested', confidence: 'low' })],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            expect.objectContaining({ id: 'tl-held', status: 'approved', confidence: 'low' }),
          ]);
        },
      },
    ],
    [
      'adds a breakdown to an unshared payload holding none',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' } })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              gloss: { en: 'cats' },
              morphemes: [morpheme('new-m-0', 'cat', 'en'), morpheme('new-m-1', '-s', 'en')],
            }),
          ]);
        },
      },
    ],
    [
      're-splits an unshared payload in place, keeping unchanged morphemes whole',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [
                morpheme('m-cat', 'cat', 'en', {
                  gloss: { en: 'feline' },
                  senseRef: { authority: 'fwlite', senseId: 's-cat' },
                }),
                morpheme('m-s', '-s', 'en', { gloss: { en: 'PL' } }),
              ],
              morphemesStale: true,
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { surfaceText: 'cats,', morphemes: forms('cat', 's') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats,', {
              updatedAt: NOW,
              morphemes: [
                morpheme('m-cat', 'cat', 'en', {
                  gloss: { en: 'feline' },
                  senseRef: { authority: 'fwlite', senseId: 's-cat' },
                }),
                morpheme('new-m-1', 's', 'en'),
              ],
            }),
          ]);
          expect(result.tokenAnalysisLinks[0].token.surfaceText).toBe('cats,');
        },
      },
    ],
    [
      'keeps a distinct old morpheme per repeated form',
      {
        analysis: analysisOf(
          [
            payload('ta-baba', 'baba', {
              morphemes: [
                morpheme('m-1', 'ba', 'en', { gloss: { en: 'first' } }),
                morpheme('m-2', 'ba', 'en', { gloss: { en: 'second' } }),
              ],
            }),
          ],
          [link('tl-baba', 'ta-baba', TOKEN, 'baba')],
        ),
        input: { surfaceText: 'baba', morphemes: forms('ba', 'ba', 'ba') },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.map(({ id }) => id)).toStrictEqual([
            'm-1',
            'm-2',
            'new-m-2',
          ]);
        },
      },
    ],
    [
      'stamps the writing system on kept morphemes too',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { writingSystem: 'en-Latn', morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes).toStrictEqual([
            morpheme('m-cat', 'cat', 'en', { writingSystem: 'en-Latn', gloss: { en: 'feline' } }),
            morpheme('new-m-1', '-s', 'en', { writingSystem: 'en-Latn' }),
          ]);
        },
      },
    ],
    [
      'forks a payload other tokens share, re-splitting only the fork',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { morphemes: forms('ca', 'ts') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'new-m-0', form: 'ca', writingSystem: 'en' },
                { id: 'new-m-1', form: 'ts', writingSystem: 'en' },
              ],
            },
            {
              id: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(result.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
            CAT_S,
          );
        },
      },
    ],
    [
      'folds a fork back onto the shared payload when the re-split leaves it unchanged',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(
            result.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-cats'),
          ).toBe(true);
        },
      },
    ],
    [
      "folds a re-split matching another payload into it, clearing the survivor's stale mark",
      {
        analysis: analysisOf(
          [
            payload('ta-split', 'cats', {
              morphemes: [morpheme('m-ca', 'ca', 'en'), morpheme('m-ts', 'ts', 'en')],
            }),
            payload('ta-cats', 'Cats', { ...EARLIER, morphemes: CAT_S, morphemesStale: true }),
          ],
          [
            link('tl-split', 'ta-split', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-cats',
              createdAt: '2025-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'Cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(result.tokenAnalyses[0].morphemesStale).toBeUndefined();
          expect(
            result.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-cats'),
          ).toBe(true);
        },
      },
    ],
    [
      'leaves a token linking both folded payloads one link, dated by the earlier',
      {
        analysis: analysisOf(
          [
            payload('ta-split', 'cats', {
              morphemes: [morpheme('m-ca', 'ca', 'en'), morpheme('m-ts', 'ts', 'en')],
            }),
            payload('ta-cats', 'cats', { ...EARLIER, morphemes: CAT_S }),
          ],
          [
            link('tl-split', 'ta-split', TOKEN, 'cats', LATER),
            link('tl-offered', 'ta-cats', TOKEN, 'cats', { ...EARLIER, status: 'suggested' }),
          ],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            expect.objectContaining({
              id: 'tl-split',
              status: 'approved',
              createdAt: EARLIER.createdAt,
            }),
          ]);
        },
      },
    ],
    [
      'edits the payload an approval tie picks among several approved links',
      {
        analysis: analysisOf(
          [
            payload('ta-old', 'cats', { morphemes: [morpheme('m-old', 'cats', 'en')] }),
            payload('ta-new', 'cats', { morphemes: CAT_S }),
          ],
          [
            link('tl-old', 'ta-old', TOKEN, 'cats', EARLIER),
            link('tl-new', 'ta-new', TOKEN, 'cats', LATER),
          ],
        ),
        input: { morphemes: forms('ca', 'ts') },
        expectResult: (result) => {
          expect(
            result.tokenAnalyses.find(({ id }) => id === 'ta-new')?.morphemes?.map((m) => m.form),
          ).toStrictEqual(['ca', 'ts']);
          expect(result.tokenAnalyses.find(({ id }) => id === 'ta-old')?.morphemes).toStrictEqual([
            morpheme('m-old', 'cats', 'en'),
          ]);
        },
      },
    ],
    [
      'leaves an empty breakdown where no forms are given',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' }, morphemes: CAT_S })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { morphemes: [] },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes).toStrictEqual([]);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone before writing',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        input: { morphemes: forms('cat', '-s') },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'cats' },
            },
          ]);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const surfaceText = input.surfaceText ?? 'cats';
    const writingSystem = input.writingSystem ?? 'en';
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeMorphemesCommand(buffer, {
        tokenRef: TOKEN,
        surfaceText,
        writingSystem,
        analysisId: 'new-analysis',
        linkId: 'new-link',
        morphemes: input.morphemes,
        now: NOW,
      }),
    );

    expectResult(outcome.result);
  });
});

type GlossInput = { morphemeId?: string; value: string };

describe('writeMorphemeGloss', () => {
  const cases: [string, CommandCase<GlossInput>][] = [
    [
      'glosses an unglossed morpheme on an unshared payload, leaving its stale mark',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S, morphemesStale: true })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              morphemes: [
                morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline' } }),
                morpheme('m-s', '-s', 'en'),
              ],
              morphemesStale: true,
            }),
          ]);
          expect(result.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'rewrites the gloss in one language, keeping the others',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline', fr: 'chat' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: 'cat' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({
            en: 'cat',
            fr: 'chat',
          });
        },
      },
    ],
    [
      'clears the gloss, dropping it once its only entry goes',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '  ' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              morphemes: [morpheme('m-cat', 'cat', 'en')],
            }),
          ]);
        },
      },
    ],
    [
      'clears one language, keeping the others',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline', fr: 'chat' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ fr: 'chat' });
        },
      },
    ],
    [
      'clears the gloss and keeps the sense ref',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [
                morpheme('m-cat', 'cat', 'en', {
                  gloss: { en: 'feline' },
                  senseRef: { authority: 'fwlite', senseId: 's-cat' },
                }),
              ],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes).toStrictEqual([
            morpheme('m-cat', 'cat', 'en', { senseRef: { authority: 'fwlite', senseId: 's-cat' } }),
          ]);
        },
      },
    ],
    [
      'stamps the payload and link even when a blank value finds no gloss to clear',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0]).toMatchObject({ updatedAt: NOW, morphemes: CAT_S });
          expect(result.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'forks a payload other tokens share, glossing only the fork',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en', gloss: { en: 'feline' } },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
            {
              id: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(
            result.tokenAnalyses.find(({ id }) => id === 'new-analysis')?.morphemes?.[0].gloss,
          ).toStrictEqual({ en: 'feline' });
          expect(result.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
            CAT_S,
          );
        },
      },
    ],
    [
      "folds a gloss matching another payload into it, clearing the survivor's stale mark",
      {
        analysis: analysisOf(
          [
            payload('ta-bare', 'cats', { morphemes: CAT_S }),
            payload('ta-glossed', 'cats', {
              ...EARLIER,
              morphemes: [
                morpheme('m-cat-2', 'cat', 'en', { gloss: { en: 'feline' } }),
                morpheme('m-s-2', '-s', 'en'),
              ],
              morphemesStale: true,
            }),
          ],
          [
            link('tl-bare', 'ta-bare', TOKEN, 'cats'),
            link('tl-other', 'ta-glossed', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-glossed',
              createdAt: '2025-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat-2', form: 'cat', writingSystem: 'en', gloss: { en: 'feline' } },
                { id: 'm-s-2', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(result.tokenAnalyses[0].morphemesStale).toBeUndefined();
          expect(
            result.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-glossed'),
          ).toBe(true);
        },
      },
    ],
    [
      'folds a clear matching another payload into it',
      {
        analysis: analysisOf(
          [
            payload('ta-glossed', 'cats', {
              morphemes: [
                morpheme('m-cat', 'cat', 'en', { gloss: { en: 'feline' } }),
                morpheme('m-s', '-s', 'en'),
              ],
            }),
            payload('ta-bare', 'cats', {
              ...EARLIER,
              morphemes: [morpheme('m-cat-2', 'cat', 'en'), morpheme('m-s-2', '-s', 'en')],
            }),
          ],
          [
            link('tl-glossed', 'ta-glossed', TOKEN, 'cats'),
            link('tl-other', 'ta-bare', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-bare',
              createdAt: '2025-06-01T00:00:00.000Z',
              updatedAt: '2025-06-01T00:00:00.000Z',
              surfaceText: 'cats',
              morphemes: [
                { id: 'm-cat-2', form: 'cat', writingSystem: 'en' },
                { id: 'm-s-2', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(
            result.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-bare'),
          ).toBe(true);
        },
      },
    ],
    [
      'stages nothing for a token with no approved analysis',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats')],
        ),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'stages nothing for a morpheme the breakdown lacks',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { morphemeId: 'm-missing', value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'stages nothing for a payload with no breakdown',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' } })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone, and nothing else',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        input: { value: 'feline' },
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const morphemeId = input.morphemeId ?? 'm-cat';
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeMorphemeGlossCommand(buffer, {
        tokenRef: TOKEN,
        morphemeId,
        value: input.value,
        analysisLanguage: 'en',
        analysisId: 'new-analysis',
        now: NOW,
      }),
    );

    expectResult(outcome.result);
  });
});

describe('deleteMorphemes', () => {
  const cases: [string, Omit<CommandCase<undefined>, 'input'>][] = [
    [
      'removes the breakdown, keeping a payload with a gloss',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              gloss: { en: 'cats' },
              morphemes: CAT_S,
              morphemesStale: true,
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, gloss: { en: 'cats' } }),
          ]);
          expect(result.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'removes the payload and its link when the breakdown was its only content',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'removes an empty breakdown',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' }, morphemes: [] })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, gloss: { en: 'cats' } }),
          ]);
        },
      },
    ],
    [
      "keeps an emptied payload another of the token's links still names",
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-rejected', 'ta-cats', TOKEN, 'cats', { status: 'rejected' }),
          ],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW }),
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-rejected',
              analysisId: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'rejected',
              token: { tokenRef: 'GEN 1:1:0', surfaceText: 'cats' },
            },
          ]);
        },
      },
    ],
    [
      'removes the payload and its link when its gloss object is empty',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: {}, morphemes: CAT_S })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'keeps a payload holding a part of speech',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S, pos: 'n' })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, pos: 'n' }),
          ]);
        },
      },
    ],
    [
      'keeps a payload holding features',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S, features: { Number: 'Pl' } })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, features: { Number: 'Pl' } }),
          ]);
        },
      },
    ],
    [
      'keeps a payload holding a sense reference',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: CAT_S,
              glossSenseRef: { authority: 'fwlite', senseId: 's-cat' },
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              glossSenseRef: { authority: 'fwlite', senseId: 's-cat' },
            }),
          ]);
        },
      },
    ],
    [
      "forks a payload other tokens share, removing only the fork's breakdown",
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' }, morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'cats',
              gloss: { en: 'cats' },
            },
            {
              id: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'cats',
              gloss: { en: 'cats' },
              morphemes: [
                { id: 'm-cat', form: 'cat', writingSystem: 'en' },
                { id: 'm-s', form: '-s', writingSystem: 'en' },
              ],
            },
          ]);
          expect(result.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
            CAT_S,
          );
        },
      },
    ],
    [
      "drops only this token's link from a shared payload the removal would empty",
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [
            link('tl-cats', 'ta-cats', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { morphemes: CAT_S }),
          ]);
          expect(result.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'tl-other',
              analysisId: 'ta-cats',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'approved',
              token: { tokenRef: 'GEN 1:2:0', surfaceText: 'cats' },
            },
          ]);
        },
      },
    ],
    [
      'folds the stripped payload into another its remaining content matches',
      {
        analysis: analysisOf(
          [
            payload('ta-split', 'cats', { gloss: { en: 'cats' }, morphemes: CAT_S }),
            payload('ta-plain', 'Cats', { ...EARLIER, gloss: { en: 'cats' } }),
          ],
          [
            link('tl-split', 'ta-split', TOKEN, 'cats'),
            link('tl-other', 'ta-plain', OTHER_TOKEN, 'cats'),
          ],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            {
              id: 'ta-plain',
              createdAt: '2025-06-01T00:00:00.000Z',
              updatedAt: '2025-06-01T00:00:00.000Z',
              surfaceText: 'Cats',
              gloss: { en: 'cats' },
            },
          ]);
          expect(
            result.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-plain'),
          ).toBe(true);
        },
      },
    ],
    [
      'stages nothing for a token with no approved analysis',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S })],
          [link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'stages nothing for a payload with no breakdown',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { gloss: { en: 'cats' } })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone, and nothing else',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      deleteMorphemesCommand(buffer, { tokenRef: TOKEN, analysisId: 'new-analysis', now: NOW }),
    );

    expectResult(outcome.result);
  });
});
