/// <reference types="jest" />

import type { DraftProject, TokenAnalysis } from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { applyChangeSet, isEmptyChangeSet, scopeRecordOf } from '../../utils/change-set';
import { FIXTURE_STAMPS } from '../test-helpers';

function payload(id: string, gloss?: string): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText: id, ...(gloss && { gloss: { en: gloss } }) };
}

function draftOf(...tokenAnalyses: TokenAnalysis[]): DraftProject {
  return {
    ...emptyDraft('src'),
    analysisLanguages: ['en'],
    analysis: { ...emptyAnalysis(), tokenAnalyses },
  };
}

describe('scopeRecordOf', () => {
  it("returns the draft's record without its analysis", () => {
    const draft = { ...draftOf(payload('a')), suggestedName: 'Draft' };

    expect(scopeRecordOf(draft)).toStrictEqual({
      sourceProjectId: 'src',
      modelVersion: draft.modelVersion,
      analysisLanguages: ['en'],
      suggestedName: 'Draft',
      dirty: false,
    });
  });
});

describe('applyChangeSet', () => {
  it('puts a new record after those stored, restored by deleting it', () => {
    const { draft, inverse } = applyChangeSet(draftOf(payload('a')), {
      intent: 'add',
      tokenAnalyses: { puts: [payload('b')], deletes: [] },
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([payload('a'), payload('b')]);
    expect(inverse).toStrictEqual({
      intent: 'add',
      tokenAnalyses: { puts: [], deletes: ['b'] },
    });
  });

  it('replaces a stored record in its place, restored by putting it back', () => {
    const { draft, inverse } = applyChangeSet(draftOf(payload('a'), payload('b'), payload('c')), {
      intent: 'edit',
      tokenAnalyses: { puts: [payload('b', 'bee')], deletes: [] },
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([
      payload('a'),
      payload('b', 'bee'),
      payload('c'),
    ]);
    expect(inverse.tokenAnalyses).toStrictEqual({ puts: [payload('b')], deletes: [] });
  });

  it('deletes a stored record, restored by putting it back', () => {
    const { draft, inverse } = applyChangeSet(draftOf(payload('a'), payload('b')), {
      intent: 'delete',
      tokenAnalyses: { puts: [], deletes: ['a'] },
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([payload('b')]);
    expect(inverse.tokenAnalyses).toStrictEqual({ puts: [payload('a')], deletes: [] });
  });

  it('leaves out of the inverse a kind whose changes replaced and added nothing', () => {
    const { inverse } = applyChangeSet(draftOf(payload('a')), {
      intent: 'deleteMissing',
      tokenAnalyses: { puts: [], deletes: ['missing'] },
    });

    expect(inverse).toStrictEqual({ intent: 'deleteMissing' });
  });

  it("puts the scope's record, restored by putting the one it replaced", () => {
    const stored = { ...draftOf(), dirty: true, suggestedName: 'Old' };
    const scope = {
      ...scopeRecordOf(draftOf()),
      segmentation: { removedVerseStarts: ['GEN 1:2'], addedStarts: [] },
    };

    const { draft, inverse } = applyChangeSet(stored, { intent: 'boundaries', scope });

    expect(draft).toStrictEqual({ ...scope, analysis: stored.analysis });
    expect(inverse.scope).toStrictEqual(scopeRecordOf(stored));
  });

  it('leaves the draft it was given as it was', () => {
    const stored = draftOf(payload('a'));

    applyChangeSet(stored, {
      intent: 'edit',
      scope: { ...scopeRecordOf(stored), dirty: true },
      tokenAnalyses: { puts: [payload('a', 'ay'), payload('b')], deletes: [] },
    });

    expect(stored).toStrictEqual(draftOf(payload('a')));
  });

  it('refuses an id both put and deleted', () => {
    expect(() =>
      applyChangeSet(draftOf(payload('a')), {
        intent: 'conflict',
        tokenAnalyses: { puts: [payload('a', 'ay')], deletes: ['a'] },
      }),
    ).toThrow('a change set names token analysis record a more than once');
  });

  it('refuses an id put twice', () => {
    expect(() =>
      applyChangeSet(draftOf(), {
        intent: 'conflict',
        tokenAnalyses: { puts: [payload('a'), payload('a', 'ay')], deletes: [] },
      }),
    ).toThrow('a change set names token analysis record a more than once');
  });

  it("refuses a scope's record of another source project", () => {
    expect(() =>
      applyChangeSet(draftOf(), {
        intent: 'wrongScope',
        scope: { ...scopeRecordOf(draftOf()), sourceProjectId: 'other' },
      }),
    ).toThrow('a change set for source project other cannot apply to the draft of src');
  });

  it('applies the changes of every record kind', () => {
    const link = {
      id: 'link',
      analysisId: 'a',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
    };
    const { draft } = applyChangeSet(draftOf(), {
      intent: 'everyKind',
      segmentAnalyses: { puts: [{ id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'In' }], deletes: [] },
      segmentAnalysisLinks: {
        puts: [{ ...link, id: 'sl', analysisId: 'sa', segmentId: 'GEN 1:1' }],
        deletes: [],
      },
      tokenAnalyses: { puts: [payload('a')], deletes: [] },
      tokenAnalysisLinks: {
        puts: [{ ...link, id: 'tl', token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' } }],
        deletes: [],
      },
      phraseAnalyses: {
        puts: [{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
        deletes: [],
      },
      phraseAnalysisLinks: {
        puts: [
          {
            ...link,
            id: 'pl',
            analysisId: 'pa',
            tokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
          },
        ],
        deletes: [],
      },
    });

    const { analysis } = draft;
    expect(
      [
        analysis.segmentAnalyses,
        analysis.segmentAnalysisLinks,
        analysis.tokenAnalyses,
        analysis.tokenAnalysisLinks,
        analysis.phraseAnalyses,
        analysis.phraseAnalysisLinks,
      ].map((records) => records.map(({ id }) => id)),
    ).toStrictEqual([['sa'], ['sl'], ['a'], ['tl'], ['pa'], ['pl']]);
  });
});

describe('isEmptyChangeSet', () => {
  it('finds a change set naming only its intent empty', () => {
    expect(isEmptyChangeSet({ intent: 'none' })).toBe(true);
  });

  it('finds a change set with record changes not empty', () => {
    expect(isEmptyChangeSet({ intent: 'edit', tokenAnalyses: { puts: [], deletes: ['a'] } })).toBe(
      false,
    );
  });

  it("finds a change set putting the scope's record not empty", () => {
    expect(isEmptyChangeSet({ intent: 'edit', scope: scopeRecordOf(draftOf()) })).toBe(false);
  });
});
