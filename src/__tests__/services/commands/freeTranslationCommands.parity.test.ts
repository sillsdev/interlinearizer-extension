/// <reference types="jest" />

import type { SegmentAnalysis, SegmentAnalysisLink, TextAnalysis } from 'interlinearizer';
import { writeSegmentFreeTranslation as writeCommand } from '../../../services/commands/freeTranslationCommands';
import { writeSegmentFreeTranslation } from '../../../store/analysisSlice';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { runParity } from './parity';

const NOW = '2026-06-01T00:00:00.000Z';
const LATER = { createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
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

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

const translationOf = (store: TextAnalysis, id: string) =>
  store.segmentAnalyses.find((sa) => sa.id === id);

const linkOf = (store: TextAnalysis, id: string) =>
  store.segmentAnalysisLinks.find((l) => l.id === id);

type WriteInput = { value: string; adoptStaleAnalysisId?: string };

type ParityCase = {
  analysis: TextAnalysis;
  input: WriteInput;
  /** What the reducer's result must show, so the case exercises the path it names. */
  expectStore: (store: TextAnalysis) => void;
};

describe('writeSegmentFreeTranslation parity with the reducer', () => {
  const cases: [string, ParityCase][] = [
    [
      'makes an approved translation for a segment with none',
      {
        analysis: emptyAnalysis(),
        input: { value: 'At first' },
        expectStore: (store) => {
          expect(store.segmentAnalyses).toStrictEqual([
            {
              id: 'new-analysis',
              createdAt: NOW,
              updatedAt: NOW,
              surfaceText: TEXT,
              freeTranslation: { en: 'At first' },
            },
          ]);
          expect(store.segmentAnalysisLinks).toStrictEqual([
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-1')).toStrictEqual(
            translation('sa-1', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { en: 'At first', fr: 'Au début' },
            }),
          );
          expect(linkOf(store, 'sl-1')?.updatedAt).toBe(NOW);
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-2')?.freeTranslation).toStrictEqual({ en: 'At first' });
          expect(translationOf(store, 'sa-1')?.freeTranslation).toBeUndefined();
        },
      },
    ],
    [
      'removes an approved link naming no stored translation before making one',
      {
        analysis: analysisOf([], [link('sl-orphan', 'sa-missing')]),
        input: { value: 'At first' },
        expectStore: (store) => {
          expect(ids(store.segmentAnalysisLinks)).toStrictEqual(['new-link']);
        },
      },
    ],
    [
      'removes an approved link naming no stored translation even when the write clears nothing',
      {
        analysis: analysisOf([], [link('sl-orphan', 'sa-missing')]),
        input: { value: '  ' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-1')).toStrictEqual(
            translation('sa-1', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { fr: 'Au début' },
            }),
          );
          expect(linkOf(store, 'sl-1')?.updatedAt).toBe(NOW);
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
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-1')).toStrictEqual(
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-stale')?.freeTranslation).toStrictEqual({
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
        expectStore: (store) => {
          expect(store.segmentAnalyses).toStrictEqual([
            translation('sa-stale', {
              surfaceText: TEXT,
              updatedAt: NOW,
              freeTranslation: { en: 'At first', fr: 'Au début' },
            }),
          ]);
          expect(store.segmentAnalysisLinks).toStrictEqual([
            link('sl-stale', 'sa-stale', { updatedAt: NOW }),
          ]);
        },
      },
    ],
    [
      // The reducer takes the first stale link listed, whereas the host takes the one the tie
      // picks. Listing the tie's pick first lets the two agree.
      'adopts the stale translation through the stale link the approval tie picks',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { fr: 'Au début' } })],
          [
            link('sl-stale-2', 'sa-stale', {
              ...LATER,
              status: 'stale',
              segmentId: OTHER_SEGMENT,
            }),
            link('sl-stale-1', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT }),
          ],
        ),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-stale' },
        expectStore: (store) => {
          expect(linkOf(store, 'sl-stale-2')?.status).toBe('approved');
          expect(linkOf(store, 'sl-stale-1')?.status).toBe('stale');
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
        expectStore: (store) => {
          expect(translationOf(store, 'sa-1')?.freeTranslation).toStrictEqual({ en: 'At first' });
          expect(linkOf(store, 'sl-stale')).toStrictEqual(
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
        expectStore: (store) => {
          expect(ids(store.segmentAnalyses)).toStrictEqual(['new-analysis', 'sa-elsewhere']);
        },
      },
    ],
    [
      'makes a translation when the named one is not stored',
      {
        analysis: analysisOf([], [link('sl-stale', 'sa-missing', { status: 'stale' })]),
        input: { value: 'At first', adoptStaleAnalysisId: 'sa-missing' },
        expectStore: (store) => {
          expect(ids(store.segmentAnalysisLinks)).toStrictEqual(['new-link', 'sl-stale']);
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
        expectStore: (store) => {
          expect(store.segmentAnalyses).toStrictEqual([
            translation('sa-stale', { updatedAt: NOW, freeTranslation: { fr: 'Au début' } }),
          ]);
          expect(store.segmentAnalysisLinks).toStrictEqual([
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
      'removes the named stale translation once a blank value leaves it nothing',
      {
        analysis: analysisOf(
          [translation('sa-stale', { freeTranslation: { en: 'Old' } })],
          [link('sl-stale', 'sa-stale', { status: 'stale', segmentId: OTHER_SEGMENT })],
        ),
        input: { value: '', adoptStaleAnalysisId: 'sa-stale' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectStore }) => {
    const outcome = await runParity(
      analysis,
      'en',
      {
        type: writeSegmentFreeTranslation.type,
        payload: {
          segmentId: SEGMENT,
          surfaceText: TEXT,
          value: input.value,
          id: NEW.analysisId,
          linkId: NEW.linkId,
          now: NOW,
          ...(input.adoptStaleAnalysisId !== undefined && {
            adoptStaleAnalysisId: input.adoptStaleAnalysisId,
          }),
        },
      },
      (buffer) =>
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

    expectStore(outcome.store);
    expect(outcome.host).toStrictEqual(outcome.store);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});
