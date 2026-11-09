/// <reference types="jest" />

import type { SegmentAnalysis, SegmentAnalysisLink, TextAnalysis } from 'interlinearizer';
import { writeSegmentFreeTranslation as writeCommand } from '../../../services/commands/freeTranslationCommands';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { LATER, NOW, type CommandCase, runCommand } from './command-runs';

const NEW = { linkId: 'new-link', analysisId: 'new-analysis' };

const SEGMENT = 'GEN 1:1';
const OTHER_SEGMENT = 'GEN 1:2';
const TEXT = 'In the beginning';

function translation(id: string, fields: Partial<SegmentAnalysis> = {}): SegmentAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText: 'In the start', ...fields };
}

function link(
  id: string,
  analysisId: string,
  fields: Partial<SegmentAnalysisLink> = {},
): SegmentAnalysisLink {
  return { id, analysisId, ...FIXTURE_STAMPS, status: 'approved', segmentId: SEGMENT, ...fields };
}

function analysisOf(
  segmentAnalyses: SegmentAnalysis[],
  segmentAnalysisLinks: SegmentAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), segmentAnalyses, segmentAnalysisLinks };
}

const translationOf = (result: TextAnalysis, id: string) =>
  result.segmentAnalyses.find((sa) => sa.id === id);

const linkOf = (result: TextAnalysis, id: string) =>
  result.segmentAnalysisLinks.find((l) => l.id === id);

type WriteInput = { value: string; adoptStaleAnalysisId?: string };

describe('writeSegmentFreeTranslation', () => {
  const cases: [string, CommandCase<WriteInput>][] = [
    [
      'makes an approved translation for a segment with none',
      {
        analysis: emptyAnalysis(),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: NOW,
              updatedAt: NOW,
              surfaceText: TEXT,
              freeTranslation: { en: 'At first' },
            },
          ]);
          expect(result.segmentAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: NOW,
              updatedAt: NOW,
              status: 'approved',
              segmentId: SEGMENT,
            },
          ]);
        },
      },
    ],
    [
      "updates the segment's approved translation in place, refreshing its surface text",
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { en: 'Old', fr: 'Au début' } })],
          [link('sl-1', 'sa-1')],
        ),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-1')).toStrictEqual(
            translation('sa-1', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { en: 'At first', fr: 'Au début' },
            }),
          );
          expect(linkOf(result, 'sl-1')?.updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'writes the translation the approval tie picks of several approved ones',
      {
        analysis: analysisOf(
          [translation('sa-1'), translation('sa-2')],
          [link('sl-1', 'sa-1'), link('sl-2', 'sa-2', LATER)],
        ),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-2')?.freeTranslation).toStrictEqual({ en: 'At first' });
          expect(translationOf(result, 'sa-1')?.freeTranslation).toBeUndefined();
        },
      },
    ],
    [
      'writes the smaller-id translation of two approved ones updated alike, listed second',
      {
        analysis: analysisOf(
          [translation('sa-1'), translation('sa-2')],
          [link('sl-2', 'sa-2'), link('sl-1', 'sa-1')],
        ),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-1')?.freeTranslation).toStrictEqual({ en: 'At first' });
          expect(translationOf(result, 'sa-2')?.freeTranslation).toBeUndefined();
        },
      },
    ],
    [
      'removes an approved link naming no stored translation before making one',
      {
        analysis: analysisOf([], [link('sl-orphan', 'sa-missing')]),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              status: 'approved',
              segmentId: 'GEN 1:1',
            },
          ]);
        },
      },
    ],
    [
      'keeps an approved link naming no stored translation when a blank value clears nothing',
      {
        analysis: analysisOf([], [link('sl-orphan', 'sa-missing')]),
        input: { value: '  ' },
        expectResult: (result) => {
          expect(result).toStrictEqual(analysisOf([], [link('sl-orphan', 'sa-missing')]));
        },
      },
    ],
    [
      'changes nothing when the value matches the approved translation',
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { en: 'At first' } })],
          [link('sl-1', 'sa-1'), link('sl-orphan', 'sa-missing')],
        ),
        input: { value: 'At first' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [translation('sa-1', { freeTranslation: { en: 'At first' } })],
              [link('sl-1', 'sa-1'), link('sl-orphan', 'sa-missing')],
            ),
          );
        },
      },
    ],
    [
      "changes nothing when a blank value finds no translation in the approved one's language",
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { fr: 'Au début' } })],
          [link('sl-1', 'sa-1')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [translation('sa-1', { freeTranslation: { fr: 'Au début' } })],
              [link('sl-1', 'sa-1')],
            ),
          );
        },
      },
    ],
    [
      "clears a blank value's language, keeping a translation that holds another",
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { en: 'At first', fr: 'Au début' } })],
          [link('sl-1', 'sa-1')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-1')).toStrictEqual(
            translation('sa-1', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { fr: 'Au début' },
            }),
          );
          expect(linkOf(result, 'sl-1')?.updatedAt).toBe(NOW);
        },
      },
    ],
    [
      'removes a translation, with its link, once a blank value leaves it nothing',
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { en: 'At first', fr: ' ' } })],
          [link('sl-1', 'sa-1')],
        ),
        input: { value: ' ' },
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'keeps a translation that another link names once a blank value leaves it nothing',
      {
        analysis: analysisOf(
          [translation('sa-1', { freeTranslation: { en: 'At first' } })],
          [link('sl-1', 'sa-1'), link('sl-2', 'sa-1', { segmentId: OTHER_SEGMENT })],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [translation('sa-1', { surfaceText: TEXT, updatedAt: NOW })],
              [link('sl-2', 'sa-1', { segmentId: OTHER_SEGMENT })],
            ),
          );
        },
      },
    ],
    [
      'keeps a translation holding a literal translation once a blank value clears its free one',
      {
        analysis: analysisOf(
          [
            translation('sa-1', {
              freeTranslation: { en: 'At first' },
              literalTranslation: { en: 'In beginning' },
            }),
          ],
          [link('sl-1', 'sa-1')],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-1')).toStrictEqual(
            translation('sa-1', {
              surfaceText: TEXT,
              updatedAt: NOW,
              literalTranslation: { en: 'In beginning' },
            }),
          );
        },
      },
    ],
    [
      'clears nothing for a blank value on a segment with no translation',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'At first' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: '' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-stale')?.freeTranslation).toStrictEqual({
            en: 'At first',
          });
        },
      },
    ],
    [
      'adopts the stale translation the value was typed over, carrying its other languages',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old', fr: 'Au début' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([
            translation('sa-stale', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { en: 'At first', fr: 'Au début' },
            }),
          ]);
          expect(result.segmentAnalysisLinks).toStrictEqual([
            link('sl-stale', 'sa-stale', { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'adopts the stale translation through the stale link updated last, listed second',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { fr: 'Au début' } })],
          [
            link('sl-stale-1', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
            link('sl-stale-2', 'sa-stale', {
              ...LATER,
              status: 'stale',
              segmentId: OTHER_SEGMENT,
            }),
          ],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(linkOf(result, 'sl-stale-2')?.status).toBe('approved');
          expect(linkOf(result, 'sl-stale-1')?.status).toBe('stale');
        },
      },
    ],
    [
      'adopts the stale translation through the smaller-id stale link of two updated alike',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { fr: 'Au début' } })],
          [
            link('sl-stale-2', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
            link('sl-stale-1', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
          ],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(linkOf(result, 'sl-stale-1')?.status).toBe('approved');
          expect(linkOf(result, 'sl-stale-2')?.status).toBe('stale');
        },
      },
    ],
    [
      'writes the approved translation, leaving a named stale one alone',
      {
        analysis: analysisOf(
          [translation('sa-1'), translation('sa-stale', { freeTranslation: { en: 'Old' } })],
          [
            link('sl-1', 'sa-1'),
            link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
          ],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(translationOf(result, 'sa-1')?.freeTranslation).toStrictEqual({ en: 'At first' });
          expect(linkOf(result, 'sl-stale')).toStrictEqual(
            link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
          );
        },
      },
    ],
    [
      'makes a translation when the named one has no stale link',
      {
        analysis: analysisOf(
          [translation('sa-elsewhere')],
          [link('sl-elsewhere', 'sa-elsewhere', { segmentId: OTHER_SEGMENT })],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-elsewhere' },
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              surfaceText: 'In the beginning',
              freeTranslation: { en: 'At first' },
            },
            {
              id: 'sa-elsewhere',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              surfaceText: 'In the start',
            },
          ]);
        },
      },
    ],
    [
      'makes a translation when the named one is not stored',
      {
        analysis: analysisOf([], [link('sl-stale', 'sa-missing', { status: 'stale' })]),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-missing' },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'new-analysis',
              createdAt: '2026-06-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              status: 'approved',
              segmentId: 'GEN 1:1',
            },
            {
              id: 'sl-stale',
              analysisId: 'sa-missing',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              status: 'stale',
              segmentId: 'GEN 1:1',
            },
          ]);
        },
      },
    ],
    [
      "clears a blank value's language from the named stale translation, leaving it stale",
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old', fr: 'Au début' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result.segmentAnalyses).toStrictEqual([
            translation('sa-stale', { updatedAt: NOW, freeTranslation: { fr: 'Au début' } }),
          ]);
          expect(result.segmentAnalysisLinks).toStrictEqual([
            link('sl-stale', 'sa-stale', {
              status: 'stale',
              segmentId: OTHER_SEGMENT,
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      'changes nothing when a blank value finds no translation in the named stale one',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { fr: 'Au début' } })],
          [
            link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
            link('sl-orphan', 'sa-missing'),
          ],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result).toStrictEqual(
            analysisOf(
              [translation('sa-stale', { freeTranslation: { fr: 'Au début' } })],
              [
                link('sl-orphan', 'sa-missing'),
                link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
              ],
            ),
          );
        },
      },
    ],
    [
      'removes an approved link naming no stored translation when a blank value clears a stale one',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old', fr: 'Au début' } })],
          [
            link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
            link('sl-orphan', 'sa-missing'),
          ],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks).toStrictEqual([
            {
              id: 'sl-stale',
              analysisId: 'sa-stale',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-06-01T00:00:00.000Z',
              status: 'stale',
              segmentId: 'GEN 1:2',
            },
          ]);
        },
      },
    ],
    [
      'adopts the named stale translation even when the value matches it',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'At first' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result.segmentAnalysisLinks).toStrictEqual([
            link('sl-stale', 'sa-stale', { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      'stamps the stale link the approval tie picks when a blank value clears a language',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old', fr: 'Au début' } })],
          [
            link('sl-stale-2', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
            link('sl-stale-1', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
          ],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(linkOf(result, 'sl-stale-1')?.updatedAt).toBe(NOW);
          expect(linkOf(result, 'sl-stale-2')?.updatedAt).toBe(FIXTURE_STAMPS.updatedAt);
        },
      },
    ],
    [
      'removes the named stale translation once a blank value leaves it nothing',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectResult: (result) => {
          expect(result).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectResult }) => {
    const outcome = await runCommand(analysis, 'en', (buffer) =>
      writeCommand(buffer, {
        ...NEW,
        segmentId: SEGMENT,
        surfaceText: TEXT,
        value: input.value,
        analysisLanguage: 'en',
        adoptStaleAnalysisId: input.adoptStaleAnalysisId,
        now: NOW,
      }),
    );

    expectResult(outcome.result);
  });
});
