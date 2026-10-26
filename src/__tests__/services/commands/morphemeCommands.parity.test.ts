/// <reference types="jest" />

import type { MorphemeAnalysis } from 'interlinearizer';
import {
  deleteMorphemes as deleteMorphemesCommand,
  writeMorphemeGloss as writeMorphemeGlossCommand,
  writeMorphemes as writeMorphemesCommand,
} from '../../../services/commands/morphemeCommands';
import { deleteMorphemes, writeMorphemeGloss, writeMorphemes } from '../../../store/analysisSlice';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import {
  analysisOf,
  EARLIER,
  expectParity,
  ids,
  LATER,
  link,
  NOW,
  OTHER_TOKEN,
  type ParityCase,
  payload,
  runParity,
  TOKEN,
} from './parity';

function morpheme(id: string, form: string, fields: Partial<MorphemeAnalysis> = {}) {
  return { id, form, writingSystem: 'en', ...fields };
}

/** A breakdown as the WebView prepares one: a fresh id per form. */
const forms = (...list: string[]) => list.map((form, i) => ({ id: `new-m-${i}`, form }));
const CAT_S = [morpheme('m-cat', 'cat'), morpheme('m-s', '-s')];

type MorphemesInput = {
  surfaceText?: string;
  writingSystem?: string;
  morphemes: { id: string; form: string }[];
};

describe('writeMorphemes parity with the reducer', () => {
  const cases: [string, ParityCase<MorphemesInput>][] = [
    [
      'creates a payload and an approved link for an unanalyzed token',
      {
        analysis: emptyAnalysis(),
        input: { morphemes: forms('cat', '-s') },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('new-analysis', 'cats', {
              createdAt: NOW,
              updatedAt: NOW,
              morphemes: [morpheme('new-m-0', 'cat'), morpheme('new-m-1', '-s')],
            }),
          ]);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['new-link']);
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-cats']);
          expect(store.tokenAnalysisLinks.find(({ id }) => id === 'new-link')?.analysisId).toBe(
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
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toStrictEqual([
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              gloss: { en: 'cats' },
              morphemes: [morpheme('new-m-0', 'cat'), morpheme('new-m-1', '-s')],
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
                morpheme('m-cat', 'cat', {
                  gloss: { en: 'feline' },
                  senseRef: { authority: 'fwlite', senseId: 's-cat' },
                }),
                morpheme('m-s', '-s', { gloss: { en: 'PL' } }),
              ],
              morphemesStale: true,
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { surfaceText: 'cats,', morphemes: forms('cat', 's') },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats,', {
              updatedAt: NOW,
              morphemes: [
                morpheme('m-cat', 'cat', {
                  gloss: { en: 'feline' },
                  senseRef: { authority: 'fwlite', senseId: 's-cat' },
                }),
                morpheme('new-m-1', 's'),
              ],
            }),
          ]);
          expect(store.tokenAnalysisLinks[0].token.surfaceText).toBe('cats,');
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
                morpheme('m-1', 'ba', { gloss: { en: 'first' } }),
                morpheme('m-2', 'ba', { gloss: { en: 'second' } }),
              ],
            }),
          ],
          [link('tl-baba', 'ta-baba', TOKEN, 'baba')],
        ),
        input: { surfaceText: 'baba', morphemes: forms('ba', 'ba', 'ba') },
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].morphemes?.map(({ id }) => id)).toStrictEqual([
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
              morphemes: [morpheme('m-cat', 'cat', { gloss: { en: 'feline' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { writingSystem: 'en-Latn', morphemes: forms('cat', '-s') },
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].morphemes).toStrictEqual([
            morpheme('m-cat', 'cat', { writingSystem: 'en-Latn', gloss: { en: 'feline' } }),
            morpheme('new-m-1', '-s', { writingSystem: 'en-Latn' }),
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['new-analysis', 'ta-cats']);
          expect(store.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-cats']);
          expect(store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-cats')).toBe(
            true,
          );
        },
      },
    ],
    [
      "folds a re-split matching another payload into it, clearing the survivor's stale mark",
      {
        analysis: analysisOf(
          [
            payload('ta-split', 'cats', {
              morphemes: [morpheme('m-ca', 'ca'), morpheme('m-ts', 'ts')],
            }),
            payload('ta-cats', 'Cats', { ...EARLIER, morphemes: CAT_S, morphemesStale: true }),
          ],
          [
            link('tl-split', 'ta-split', TOKEN, 'cats'),
            link('tl-other', 'ta-cats', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-cats']);
          expect(store.tokenAnalyses[0].morphemesStale).toBeUndefined();
          expect(store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-cats')).toBe(
            true,
          );
        },
      },
    ],
    [
      'leaves a token linking both folded payloads one link, dated by the earlier',
      {
        analysis: analysisOf(
          [
            payload('ta-split', 'cats', {
              morphemes: [morpheme('m-ca', 'ca'), morpheme('m-ts', 'ts')],
            }),
            payload('ta-cats', 'cats', { ...EARLIER, morphemes: CAT_S }),
          ],
          [
            link('tl-split', 'ta-split', TOKEN, 'cats', LATER),
            link('tl-offered', 'ta-cats', TOKEN, 'cats', { ...EARLIER, status: 'suggested' }),
          ],
        ),
        input: { morphemes: forms('cat', '-s') },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toStrictEqual([
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
            payload('ta-old', 'cats', { morphemes: [morpheme('m-old', 'cats')] }),
            payload('ta-new', 'cats', { morphemes: CAT_S }),
          ],
          [
            link('tl-old', 'ta-old', TOKEN, 'cats', EARLIER),
            link('tl-new', 'ta-new', TOKEN, 'cats', LATER),
          ],
        ),
        input: { morphemes: forms('ca', 'ts') },
        expectStore: (store) => {
          expect(
            store.tokenAnalyses.find(({ id }) => id === 'ta-new')?.morphemes?.map((m) => m.form),
          ).toStrictEqual(['ca', 'ts']);
          expect(store.tokenAnalyses.find(({ id }) => id === 'ta-old')?.morphemes).toStrictEqual([
            morpheme('m-old', 'cats'),
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].morphemes).toStrictEqual([]);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone before writing',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        input: { morphemes: forms('cat', '-s') },
        expectStore: (store) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['new-link']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectStore }) => {
    const surfaceText = input.surfaceText ?? 'cats';
    const writingSystem = input.writingSystem ?? 'en';
    const outcome = await runParity(
      analysis,
      'en',
      {
        type: writeMorphemes.type,
        payload: {
          tokenRef: TOKEN,
          surfaceText,
          writingSystem,
          analysisId: 'new-analysis',
          linkId: 'new-link',
          morphemes: input.morphemes,
          now: NOW,
        },
      },
      (buffer) =>
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

    expectParity(outcome, expectStore);
  });
});

type GlossInput = { morphemeId?: string; value: string };

describe('writeMorphemeGloss parity with the reducer', () => {
  const cases: [string, ParityCase<GlossInput>][] = [
    [
      'glosses an unglossed morpheme on an unshared payload, leaving its stale mark',
      {
        analysis: analysisOf(
          [payload('ta-cats', 'cats', { morphemes: CAT_S, morphemesStale: true })],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: 'feline' },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', {
              updatedAt: NOW,
              morphemes: [
                morpheme('m-cat', 'cat', { gloss: { en: 'feline' } }),
                morpheme('m-s', '-s'),
              ],
              morphemesStale: true,
            }),
          ]);
          expect(store.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'rewrites the gloss in one language, keeping the others',
      {
        analysis: analysisOf(
          [
            payload('ta-cats', 'cats', {
              morphemes: [morpheme('m-cat', 'cat', { gloss: { en: 'feline', fr: 'chat' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: 'cat' },
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({
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
              morphemes: [morpheme('m-cat', 'cat', { gloss: { en: 'feline' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '  ' },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, morphemes: [morpheme('m-cat', 'cat')] }),
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
              morphemes: [morpheme('m-cat', 'cat', { gloss: { en: 'feline', fr: 'chat' } })],
            }),
          ],
          [link('tl-cats', 'ta-cats', TOKEN, 'cats')],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ fr: 'chat' });
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0]).toMatchObject({ updatedAt: NOW, morphemes: CAT_S });
          expect(store.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['new-analysis', 'ta-cats']);
          expect(
            store.tokenAnalyses.find(({ id }) => id === 'new-analysis')?.morphemes?.[0].gloss,
          ).toStrictEqual({ en: 'feline' });
          expect(store.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
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
                morpheme('m-cat-2', 'cat', { gloss: { en: 'feline' } }),
                morpheme('m-s-2', '-s'),
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-glossed']);
          expect(store.tokenAnalyses[0].morphemesStale).toBeUndefined();
          expect(
            store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-glossed'),
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
                morpheme('m-cat', 'cat', { gloss: { en: 'feline' } }),
                morpheme('m-s', '-s'),
              ],
            }),
            payload('ta-bare', 'cats', {
              ...EARLIER,
              morphemes: [morpheme('m-cat-2', 'cat'), morpheme('m-s-2', '-s')],
            }),
          ],
          [
            link('tl-glossed', 'ta-glossed', TOKEN, 'cats'),
            link('tl-other', 'ta-bare', OTHER_TOKEN, 'cats'),
          ],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-bare']);
          expect(store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-bare')).toBe(
            true,
          );
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone, and nothing else',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        input: { value: 'feline' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectStore }) => {
    const morphemeId = input.morphemeId ?? 'm-cat';
    const outcome = await runParity(
      analysis,
      'en',
      {
        type: writeMorphemeGloss.type,
        payload: { tokenRef: TOKEN, morphemeId, value: input.value, id: 'new-analysis', now: NOW },
      },
      (buffer) =>
        writeMorphemeGlossCommand(buffer, {
          tokenRef: TOKEN,
          morphemeId,
          value: input.value,
          analysisLanguage: 'en',
          analysisId: 'new-analysis',
          now: NOW,
        }),
    );

    expectParity(outcome, expectStore);
  });
});

describe('deleteMorphemes parity with the reducer', () => {
  const cases: [string, Omit<ParityCase<undefined>, 'input'>][] = [
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW, gloss: { en: 'cats' } }),
          ]);
          expect(store.tokenAnalysisLinks[0].updatedAt).toBe(NOW);
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
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { updatedAt: NOW }),
          ]);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-rejected']);
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
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['new-analysis', 'ta-cats']);
          expect(store.tokenAnalyses.find(({ id }) => id === 'ta-cats')?.morphemes).toStrictEqual(
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
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-cats', 'cats', { morphemes: CAT_S }),
          ]);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-other']);
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
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-plain']);
          expect(
            store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-plain'),
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
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
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone, and nothing else',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN, 'cats')]),
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, expectStore }) => {
    const outcome = await runParity(
      analysis,
      'en',
      { type: deleteMorphemes.type, payload: { tokenRef: TOKEN, id: 'new-analysis', now: NOW } },
      (buffer) =>
        deleteMorphemesCommand(buffer, { tokenRef: TOKEN, analysisId: 'new-analysis', now: NOW }),
    );

    expectParity(outcome, expectStore);
  });
});
