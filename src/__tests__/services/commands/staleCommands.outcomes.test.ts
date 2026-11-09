/// <reference types="jest" />

import type {
  MorphemeAnalysis,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import {
  discardStaleAnalysis as discardCommand,
  discardStaleFreeTranslation as discardFreeTranslationCommand,
  keepStaleFreeTranslation as keepFreeTranslationCommand,
  reapplyStaleAnalysis as reapplyCommand,
} from '../../../services/commands/staleCommands';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import {
  analysisOf,
  EARLIER,
  expectRemovalPreview,
  ids,
  LATER,
  NOW,
  OTHER_TOKEN,
  type CommandCase,
  payload,
  runCommand,
  TOKEN,
} from './command-runs';

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

describe('discardStaleAnalysis', () => {
  const cases: [string, CommandCase<{ tokenRef: string }>][] = [
    [
      'drops the stale link and the payload nothing else links',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: TOKEN },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([]);
          expect(result.tokenAnalyses).toStrictEqual([]);
        },
      },
    ],
    [
      'keeps the payload another place still links',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [
            link('tl-stale', 'ta-in', TOKEN, { status: 'stale' }),
            link('tl-other', 'ta-in', OTHER_TOKEN),
          ],
        ),
        input: { tokenRef: TOKEN },
        expectResult: (result) => {
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-other']);
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-in']);
        },
      },
    ],
    [
      'drops every stale link to the analysis at the place',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [
            link('tl-stale-1', 'ta-in', TOKEN, { status: 'stale' }),
            link('tl-stale-2', 'ta-in', TOKEN, { status: 'stale' }),
          ],
        ),
        input: { tokenRef: TOKEN },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      'drops a stale link whose payload is missing',
      {
        analysis: analysisOf([], [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })]),
        input: { tokenRef: TOKEN },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      'changes nothing where no stale link to the analysis sits at the place',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [
            link('tl-in', 'ta-in', TOKEN),
            link('tl-stale', 'ta-in', OTHER_TOKEN, { status: 'stale' }),
          ],
        ),
        input: { tokenRef: TOKEN },
        expectResult: (result) => {
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-in', 'tl-stale']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const request = { analysisId: 'ta-in', tokenRef: input.tokenRef };
    const outcome = await runCommand(analysis, 'en', (buffer) => discardCommand(buffer, request));

    expectResult(outcome.result);
    expect(outcome.indexDifferences).toStrictEqual([]);
    expectRemovalPreview(outcome, analysis);
  });
});

type ReapplyInput = { tokenRef: string; surfaceText: string };

describe('reapplyStaleAnalysis', () => {
  const cases: [string, CommandCase<ReapplyInput>][] = [
    [
      'approves the analysis on a token of the same spelling, dropping the stale link',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('new-link', 'ta-in', OTHER_TOKEN, { createdAt: NOW, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'gives a token spelled differently a copy under its spelling, reclaiming the original',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'Inn' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toStrictEqual([
            payload('new-analysis', 'Inn', { gloss: { en: 'at' }, createdAt: NOW, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      "respells a breakdown that is the old word whole as one morpheme in the token's copy",
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { morphemes: [morpheme('m-in', 'in')] })],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'Inn' },
        expectResult: (result) => {
          expect(result.tokenAnalyses.map(({ morphemes }) => morphemes)).toStrictEqual([
            [morpheme('m-in', 'Inn')],
          ]);
        },
      },
    ],
    [
      'keeps the form of a whole-word morpheme that names a lexicon entry',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              morphemes: [morpheme('m-in', 'in', { entryRef: { authority: 'fw', entryId: 'e' } })],
            }),
          ],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'Inn' },
        expectResult: (result) => {
          expect(result.tokenAnalyses[0].morphemes?.[0].form).toBe('in');
        },
      },
    ],
    [
      "marks a breakdown of several morphemes stale in the token's copy, keeping its forms",
      {
        analysis: analysisOf(
          [payload('ta-in', 'Into', { morphemes: [morpheme('m-1', 'in'), morpheme('m-2', 'to')] })],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'Unto' },
        expectResult: (result) => {
          expect(result.tokenAnalyses).toMatchObject([
            { morphemes: [{ form: 'in' }, { form: 'to' }], morphemesStale: true },
          ]);
        },
      },
    ],
    [
      'adopts a stored payload identical to the copy rather than adding one',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
            payload('ta-inn', 'Inn', { gloss: { en: 'at' } }),
          ],
          [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'Inn' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-inn']);
          expect(result.tokenAnalysisLinks[0].analysisId).toBe('ta-inn');
        },
      },
    ],
    [
      "replaces the token's approval, reclaiming the payload it named",
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
            payload('ta-old', 'In', { gloss: { en: 'on' } }),
          ],
          [
            link('tl-stale', 'ta-in', TOKEN, { status: 'stale' }),
            link('tl-other', 'ta-old', OTHER_TOKEN),
          ],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalyses)).toStrictEqual(['ta-in']);
          expect(result.tokenAnalysisLinks).toMatchObject([
            { id: 'tl-other', analysisId: 'ta-in' },
          ]);
        },
      },
    ],
    [
      "takes over the stale link's confidence and earlier creation date at the place it went stale",
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
            payload('ta-old', 'In', { gloss: { en: 'on' } }),
          ],
          [
            link('tl-stale', 'ta-in', TOKEN, { status: 'stale', confidence: 'high', ...EARLIER }),
            link('tl-in', 'ta-old', TOKEN, { confidence: 'low', ...LATER }),
          ],
        ),
        input: { tokenRef: TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toMatchObject([
            { id: 'tl-in', analysisId: 'ta-in', confidence: 'high', createdAt: EARLIER.createdAt },
          ]);
        },
      },
    ],
    [
      'drops the confidence and keeps the earlier date of an approval a later stale link replaces',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' } }),
            payload('ta-old', 'In', { gloss: { en: 'on' } }),
          ],
          [
            link('tl-stale', 'ta-in', TOKEN, { status: 'stale', ...LATER }),
            link('tl-in', 'ta-old', TOKEN, { confidence: 'low', ...EARLIER }),
          ],
        ),
        input: { tokenRef: TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(result.tokenAnalysisLinks).toStrictEqual([
            link('tl-in', 'ta-in', TOKEN, { ...EARLIER, updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'changes nothing where no stale link to the analysis sits at the stale place',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-in']);
        },
      },
    ],
    [
      'changes nothing for a stale link whose payload is missing',
      {
        analysis: analysisOf([], [link('tl-stale', 'ta-in', TOKEN, { status: 'stale' })]),
        input: { tokenRef: OTHER_TOKEN, surfaceText: 'In' },
        expectResult: (result) => {
          expect(ids(result.tokenAnalysisLinks)).toStrictEqual(['tl-stale']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const request = { analysisId: 'ta-in', staleTokenRef: TOKEN, ...input };
    const stamp = { linkId: 'new-link', now: NOW };
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      reapplyCommand(buffer, { ...request, ...stamp, copyId: 'new-analysis' }),
    );

    expectResult(outcome.result);
    expect(outcome.indexDifferences).toStrictEqual([]);
    expectRemovalPreview(outcome, analysis);
  });
});

function translation(id: string, surfaceText: string, text: string): SegmentAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText, freeTranslation: { en: text } };
}

function segmentLink(
  id: string,
  analysisId: string,
  segmentId: string,
  status: SegmentAnalysisLink['status'],
): SegmentAnalysisLink {
  return { id, analysisId, ...FIXTURE_STAMPS, status, segmentId };
}

function translationsOf(
  segmentAnalyses: SegmentAnalysis[],
  segmentAnalysisLinks: SegmentAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), segmentAnalyses, segmentAnalysisLinks };
}

const SEGMENT = 'GEN 1:1';

describe('keepStaleFreeTranslation', () => {
  const cases: [string, CommandCase<{ segmentId: string }>][] = [
    [
      'approves the stale translation for the segment it is shown in, restamping its text',
      {
        analysis: translationsOf(
          [translation('sa-1', 'In the beginning', 'At first')],
          [segmentLink('sl-stale', 'sa-1', 'GEN 1:1-2', 'stale')],
        ),
        input: { segmentId: SEGMENT },
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([
            { ...translation('sa-1', 'In the start', 'At first'), updatedAt: NOW },
          ]);
          expect(result.segmentAnalysisLinks).toStrictEqual([
            { ...segmentLink('sl-stale', 'sa-1', SEGMENT, 'approved'), updatedAt: NOW },
          ]);
        },
      },
    ],
    [
      'changes nothing when the segment already holds an approved translation',
      {
        analysis: translationsOf(
          [
            translation('sa-1', 'In the beginning', 'At first'),
            translation('sa-2', 'In the start', 'At the start'),
          ],
          [
            segmentLink('sl-stale', 'sa-1', SEGMENT, 'stale'),
            segmentLink('sl-2', 'sa-2', SEGMENT, 'approved'),
          ],
        ),
        input: { segmentId: SEGMENT },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks.find(({ id }) => id === 'sl-stale')?.status).toBe(
            'stale',
          );
        },
      },
    ],
    [
      'changes nothing when the translation is not stale',
      {
        analysis: translationsOf(
          [translation('sa-1', 'In the beginning', 'At first')],
          [segmentLink('sl-1', 'sa-1', 'GEN 1:2', 'approved')],
        ),
        input: { segmentId: SEGMENT },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks[0].segmentId).toBe('GEN 1:2');
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const request = { analysisId: 'sa-1', surfaceText: 'In the start', now: NOW, ...input };
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      keepFreeTranslationCommand(buffer, request),
    );

    expectResult(outcome.result);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});

describe('discardStaleFreeTranslation', () => {
  const cases: [string, CommandCase<undefined>][] = [
    [
      'drops the stale translation with its link',
      {
        analysis: translationsOf(
          [translation('sa-1', 'In the beginning', 'At first')],
          [segmentLink('sl-stale', 'sa-1', SEGMENT, 'stale')],
        ),
        input: undefined,
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([]);
          expect(result.segmentAnalysisLinks).toStrictEqual([]);
        },
      },
    ],
    [
      "drops an orphaned translation, whose verse the book no longer holds, leaving others' alone",
      {
        analysis: translationsOf(
          [
            translation('sa-1', 'And the evening', 'Evening came'),
            translation('sa-2', 'In the beginning', 'At first'),
          ],
          [
            segmentLink('sl-orphan', 'sa-1', 'GEN 1:99', 'stale'),
            segmentLink('sl-2', 'sa-2', SEGMENT, 'stale'),
          ],
        ),
        input: undefined,
        expectResult: (result) => {
          expect(ids(result.segmentAnalyses)).toStrictEqual(['sa-2']);
          expect(ids(result.segmentAnalysisLinks)).toStrictEqual(['sl-2']);
        },
      },
    ],
    [
      'keeps the translation while another link names it',
      {
        analysis: translationsOf(
          [translation('sa-1', 'In the beginning', 'At first')],
          [
            segmentLink('sl-stale', 'sa-1', SEGMENT, 'stale'),
            segmentLink('sl-other', 'sa-1', 'GEN 1:2', 'approved'),
          ],
        ),
        input: undefined,
        expectResult: (result) => {
          expect(ids(result.segmentAnalyses)).toStrictEqual(['sa-1']);
          expect(ids(result.segmentAnalysisLinks)).toStrictEqual(['sl-other']);
        },
      },
    ],
    [
      'changes nothing when the translation is not stale',
      {
        analysis: translationsOf(
          [translation('sa-1', 'In the beginning', 'At first')],
          [segmentLink('sl-1', 'sa-1', SEGMENT, 'approved')],
        ),
        input: undefined,
        expectResult: (result) => {
          expect(ids(result.segmentAnalyses)).toStrictEqual(['sa-1']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, expectResult }) => {
    const request = { analysisId: 'sa-1' };
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      discardFreeTranslationCommand(buffer, request),
    );

    expectResult(outcome.result);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});
