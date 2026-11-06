/// <reference types="jest" />

import type { AssignmentStatus, PhraseAnalysis, PhraseAnalysisLink } from 'interlinearizer';
import { dedupePhraseAnalyses } from '../../../converters/pt9/phraseAnalysisDedupe';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';

const STAMP = '2026-08-01T00:00:00.000Z';

/** An imported `en el` payload glossed "within" under one lexicon sense. */
function payload(id: string, overrides: Partial<PhraseAnalysis> = {}): PhraseAnalysis {
  return {
    id,
    createdAt: STAMP,
    updatedAt: STAMP,
    surfaceText: 'en el',
    producer: 'pt9-import',
    gloss: { en: 'within' },
    senseRef: { authority: 'paratext', senseId: 'S5' },
    ...overrides,
  };
}

function link(
  analysisId: string,
  verse: string,
  status: AssignmentStatus = 'approved',
  surfaces: [string, string] = ['en', 'el'],
): PhraseAnalysisLink {
  return {
    id: `${verse}:${status}`,
    analysisId,
    createdAt: STAMP,
    updatedAt: STAMP,
    status,
    tokens: surfaces.map((surfaceText, index) => ({
      tokenRef: `${verse}:${index * 3}`,
      surfaceText,
    })),
  };
}

describe('dedupePhraseAnalyses', () => {
  it('folds twins onto the first payload and moves every link to it', () => {
    const report = emptyPt9ImportReport();
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b')],
        phraseAnalysisLinks: [link('a', 'GEN 1:1'), link('b', 'GEN 1:2', 'candidate')],
      },
      report,
    );

    expect(result.phraseAnalyses.map((a) => a.id)).toStrictEqual(['a']);
    expect(result.phraseAnalysisLinks).toStrictEqual([
      link('a', 'GEN 1:1'),
      link('a', 'GEN 1:2', 'candidate'),
    ]);
    expect(report.merge.identicalPhrasePayloadsMerged).toBe(1);
  });

  it('folds case variants, each link keeping its own token surfaces', () => {
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b', { surfaceText: 'En el' })],
        phraseAnalysisLinks: [link('a', 'GEN 1:1'), link('b', 'GEN 1:2', 'approved', ['En', 'el'])],
      },
      emptyPt9ImportReport(),
    );

    expect(result.phraseAnalyses.map((a) => a.id)).toStrictEqual(['a']);
    expect(result.phraseAnalysisLinks[1]).toStrictEqual(
      link('a', 'GEN 1:2', 'approved', ['En', 'el']),
    );
  });

  it.each<[string, Partial<PhraseAnalysis>]>([
    ['a different gloss', { gloss: { en: 'inside' } }],
    ['a different sense', { senseRef: { authority: 'paratext', senseId: 'S6' } }],
    ['a different surface', { surfaceText: 'en la' }],
  ])('keeps payloads apart that differ by %s', (_, overrides) => {
    const report = emptyPt9ImportReport();
    const layer = {
      phraseAnalyses: [payload('a'), payload('b', overrides)],
      phraseAnalysisLinks: [link('a', 'GEN 1:1'), link('b', 'GEN 1:2')],
    };
    const result = dedupePhraseAnalyses(layer, report);

    expect(result).toStrictEqual(layer);
    expect(report.merge.identicalPhrasePayloadsMerged).toBe(0);
  });

  it('keeps the earlier link when twins fold onto one run and neither is approved or rejected', () => {
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b')],
        phraseAnalysisLinks: [link('a', 'GEN 1:1', 'suggested'), link('b', 'GEN 1:1', 'candidate')],
      },
      emptyPt9ImportReport(),
    );

    expect(result.phraseAnalysisLinks).toStrictEqual([link('a', 'GEN 1:1', 'suggested')]);
  });

  it('keeps the approved link when twins fold onto one run after a non-approved one', () => {
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b')],
        phraseAnalysisLinks: [link('a', 'GEN 1:1', 'candidate'), link('b', 'GEN 1:1')],
      },
      emptyPt9ImportReport(),
    );

    expect(result.phraseAnalysisLinks).toStrictEqual([link('a', 'GEN 1:1')]);
  });

  it.each<[AssignmentStatus, AssignmentStatus]>([
    ['rejected', 'suggested'],
    ['suggested', 'rejected'],
  ])('drops the rejection when twins fold onto one run as %s then %s', (first, second) => {
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b')],
        phraseAnalysisLinks: [link('a', 'GEN 1:1', first), link('b', 'GEN 1:1', second)],
      },
      emptyPt9ImportReport(),
    );

    expect(result.phraseAnalysisLinks).toStrictEqual([link('a', 'GEN 1:1', 'suggested')]);
  });

  it('keeps the rejection when twins fold onto one run and both are rejected', () => {
    const result = dedupePhraseAnalyses(
      {
        phraseAnalyses: [payload('a'), payload('b')],
        phraseAnalysisLinks: [link('a', 'GEN 1:1', 'rejected'), link('b', 'GEN 1:1', 'rejected')],
      },
      emptyPt9ImportReport(),
    );

    expect(result.phraseAnalysisLinks).toStrictEqual([link('a', 'GEN 1:1', 'rejected')]);
  });
});
