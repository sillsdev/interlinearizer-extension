/// <reference types="jest" />

import type { AssignmentStatus, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';
import { dedupeTokenAnalyses } from '../../../converters/pt9/tokenAnalysisDedupe';

const STAMP = '2026-08-01T00:00:00.000Z';

/** An imported `plovs` payload glossed "catorce" over the breakdown `plov s`. */
function payload(id: string, overrides: Partial<TokenAnalysis> = {}): TokenAnalysis {
  return {
    id,
    createdAt: STAMP,
    updatedAt: STAMP,
    surfaceText: 'plovs',
    producer: 'pt9-import',
    gloss: { es: 'catorce' },
    morphemes: [
      { id: 'm0', form: 'plov', writingSystem: 'pia' },
      { id: 'm1', form: 's', writingSystem: 'pia' },
    ],
    ...overrides,
  };
}

function link(
  analysisId: string,
  tokenRef: string,
  status: AssignmentStatus = 'approved',
  surfaceText = 'plovs',
): TokenAnalysisLink {
  return {
    analysisId,
    createdAt: STAMP,
    updatedAt: STAMP,
    status,
    token: { tokenRef, surfaceText },
  };
}

describe('dedupeTokenAnalyses', () => {
  it('folds twins onto the first payload and moves every link to it', () => {
    const report = emptyPt9ImportReport();
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b')],
        tokenAnalysisLinks: [link('a', 'PHP 1:6:5'), link('b', 'PHP 1:6:15')],
      },
      report,
    );

    expect(result.tokenAnalyses.map((a) => a.id)).toStrictEqual(['a']);
    expect(result.tokenAnalysisLinks).toStrictEqual([
      link('a', 'PHP 1:6:5'),
      link('a', 'PHP 1:6:15'),
    ]);
    expect(report.merge.identicalPayloadsMerged).toBe(1);
  });

  it('drops an unlinked payload identical to a linked one', () => {
    const report = emptyPt9ImportReport();
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('wa', { producer: 'pt9-import:word-analyses' })],
        tokenAnalysisLinks: [link('a', 'PHP 1:6:5')],
      },
      report,
    );

    expect(result.tokenAnalyses.map((a) => a.id)).toStrictEqual(['a']);
    expect(result.tokenAnalysisLinks).toStrictEqual([link('a', 'PHP 1:6:5')]);
    expect(report.merge.identicalPayloadsMerged).toBe(1);
  });

  it('folds case variants, each link keeping its own token surface', () => {
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b', { surfaceText: 'Plovs' })],
        tokenAnalysisLinks: [link('a', 'PHP 1:6:5'), link('b', 'PHP 1:7:0', 'approved', 'Plovs')],
      },
      emptyPt9ImportReport(),
    );

    expect(result.tokenAnalyses.map((a) => a.id)).toStrictEqual(['a']);
    expect(result.tokenAnalysisLinks[1]).toStrictEqual(link('a', 'PHP 1:7:0', 'approved', 'Plovs'));
  });

  it.each<[string, Partial<TokenAnalysis>]>([
    ['a different gloss', { gloss: { es: 'decimocuarto' } }],
    ['no breakdown against a breakdown', { morphemes: undefined }],
    [
      'a different breakdown',
      {
        morphemes: [
          { id: 'm0', form: 'plo', writingSystem: 'pia' },
          { id: 'm1', form: 'vs', writingSystem: 'pia' },
        ],
      },
    ],
  ])('keeps payloads apart that differ by %s', (_, overrides) => {
    const report = emptyPt9ImportReport();
    const layer = {
      tokenAnalyses: [payload('a'), payload('b', overrides)],
      tokenAnalysisLinks: [link('a', 'PHP 1:6:5'), link('b', 'PHP 1:7:15')],
    };
    const result = dedupeTokenAnalyses(layer, report);

    expect(result).toStrictEqual(layer);
    expect(report.merge.identicalPayloadsMerged).toBe(0);
  });

  it('keeps the earlier link when twins fold onto one token and neither is approved or rejected', () => {
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b')],
        tokenAnalysisLinks: [
          link('a', 'PHP 1:6:5', 'suggested'),
          link('b', 'PHP 1:6:5', 'candidate'),
        ],
      },
      emptyPt9ImportReport(),
    );

    expect(result.tokenAnalysisLinks).toStrictEqual([link('a', 'PHP 1:6:5', 'suggested')]);
  });

  it('keeps the approved link when twins fold onto one token after a non-approved one', () => {
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b')],
        tokenAnalysisLinks: [
          link('a', 'PHP 1:6:5', 'suggested'),
          link('b', 'PHP 1:6:5', 'approved'),
        ],
      },
      emptyPt9ImportReport(),
    );

    expect(result.tokenAnalysisLinks).toStrictEqual([link('a', 'PHP 1:6:5', 'approved')]);
  });

  it.each<[AssignmentStatus, AssignmentStatus]>([
    ['rejected', 'suggested'],
    ['suggested', 'rejected'],
  ])('drops the rejection when twins fold onto one token as %s then %s', (first, second) => {
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b')],
        tokenAnalysisLinks: [link('a', 'PHP 1:6:5', first), link('b', 'PHP 1:6:5', second)],
      },
      emptyPt9ImportReport(),
    );

    expect(result.tokenAnalysisLinks).toStrictEqual([link('a', 'PHP 1:6:5', 'suggested')]);
  });

  it('keeps the rejection when twins fold onto one token and both are rejected', () => {
    const result = dedupeTokenAnalyses(
      {
        tokenAnalyses: [payload('a'), payload('b')],
        tokenAnalysisLinks: [
          link('a', 'PHP 1:6:5', 'rejected'),
          link('b', 'PHP 1:6:5', 'rejected'),
        ],
      },
      emptyPt9ImportReport(),
    );

    expect(result.tokenAnalysisLinks).toStrictEqual([link('a', 'PHP 1:6:5', 'rejected')]);
  });
});
