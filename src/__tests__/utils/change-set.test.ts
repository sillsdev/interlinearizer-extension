/// <reference types="jest" />

import type { DraftProject, TextAnalysis, TokenAnalysis } from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  applyChangeSet,
  isEmptyChangeSet,
  mergeChangeSets,
  scopeRecordOf,
  touched,
} from '../../utils/change-set';
import { FIXTURE_STAMPS, makePhraseLink, makeTokenLink } from '../test-helpers';

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

function draftWith(analysis: Partial<TextAnalysis>): DraftProject {
  return { ...emptyDraft('src'), analysis: { ...emptyAnalysis(), ...analysis } };
}

describe('scopeRecordOf', () => {
  it("returns the draft's record without its analysis or its dirty flag", () => {
    const draft = { ...draftOf(payload('a')), suggestedDescription: 'Draft', dirty: true };

    expect(scopeRecordOf(draft)).toStrictEqual({
      sourceProjectId: 'src',
      modelVersion: draft.modelVersion,
      analysisLanguages: ['en'],
      suggestedDescription: 'Draft',
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
    const stored = { ...draftOf(), dirty: true, suggestedDescription: 'Old' };
    const scope = {
      ...scopeRecordOf(draftOf()),
      segmentation: { removedVerseStarts: ['GEN 1:2'], addedStarts: [] },
    };

    const { draft, inverse } = applyChangeSet(stored, { intent: 'boundaries', scope });

    expect(draft).toStrictEqual({ ...scope, dirty: true, analysis: stored.analysis });
    expect(inverse.scope).toStrictEqual(scopeRecordOf(stored));
  });

  it('marks the draft unsaved, leaving that out of the inverse', () => {
    const { draft, inverse } = applyChangeSet(draftOf(payload('a')), {
      intent: 'edit',
      scope: scopeRecordOf(draftOf()),
      tokenAnalyses: { puts: [payload('a', 'ay')], deletes: [] },
    });

    expect(draft.dirty).toBe(true);
    expect(inverse.scope).not.toHaveProperty('dirty');
  });

  it('leaves the draft it was given as it was', () => {
    const stored = draftOf(payload('a'));

    applyChangeSet(stored, {
      intent: 'edit',
      scope: { ...scopeRecordOf(stored), suggestedDescription: 'New' },
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

describe('applyChangeSet cascade', () => {
  const kept = makeTokenLink('a', 'GEN 1:1:0', { id: 'kept' });
  const other = makeTokenLink('b', 'GEN 1:1:1', { id: 'other' });

  it('deletes each link naming an analysis it deletes, reporting the delete and restoring the link', () => {
    const { draft, inverse, applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a'), payload('b')], tokenAnalysisLinks: [kept, other] }),
      { intent: 'delete', tokenAnalyses: { puts: [], deletes: ['a'] } },
    );

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([other]);
    expect(applied.tokenAnalysisLinks).toStrictEqual({ puts: [], deletes: ['kept'] });
    expect(inverse.tokenAnalysisLinks).toStrictEqual({ puts: [kept], deletes: [] });
  });

  it('deletes the phrase and segment links of the analyses it deletes', () => {
    const phraseLink = makePhraseLink('pa', ['GEN 1:1:0']);
    const segmentLink = {
      id: 'sl',
      analysisId: 'sa',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      segmentId: 'GEN 1:1',
    };

    const { draft, applied } = applyChangeSet(
      draftWith({
        phraseAnalyses: [{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'In' }],
        phraseAnalysisLinks: [phraseLink],
        segmentAnalyses: [{ id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'In' }],
        segmentAnalysisLinks: [segmentLink],
      }),
      {
        intent: 'delete',
        phraseAnalyses: { puts: [], deletes: ['pa'] },
        segmentAnalyses: { puts: [], deletes: ['sa'] },
      },
    );

    expect(draft.analysis.phraseAnalysisLinks).toStrictEqual([]);
    expect(draft.analysis.segmentAnalysisLinks).toStrictEqual([]);
    expect(applied.phraseAnalysisLinks?.deletes).toStrictEqual(['pa']);
    expect(applied.segmentAnalysisLinks?.deletes).toStrictEqual(['sl']);
  });

  it('leaves alone a link that the changes put, though it names an analysis they delete', () => {
    const moved = { ...kept, status: 'suggested' as const };

    const { draft, applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a')], tokenAnalysisLinks: [kept] }),
      {
        intent: 'delete',
        tokenAnalyses: { puts: [], deletes: ['a'] },
        tokenAnalysisLinks: { puts: [moved], deletes: [] },
      },
    );

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([moved]);
    expect(applied.tokenAnalysisLinks).toStrictEqual({ puts: [moved], deletes: [] });
  });

  it('names a link that the changes delete themselves once', () => {
    const { applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a')], tokenAnalysisLinks: [kept] }),
      {
        intent: 'delete',
        tokenAnalyses: { puts: [], deletes: ['a'] },
        tokenAnalysisLinks: { puts: [], deletes: ['kept'] },
      },
    );

    expect(applied.tokenAnalysisLinks).toStrictEqual({ puts: [], deletes: ['kept'] });
  });

  it("adds the links it takes to the changes' own link changes", () => {
    const added = makeTokenLink('b', 'GEN 1:1:2', { id: 'added' });

    const { draft, applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a'), payload('b')], tokenAnalysisLinks: [kept, other] }),
      {
        intent: 'relink',
        tokenAnalyses: { puts: [], deletes: ['a'] },
        tokenAnalysisLinks: { puts: [added], deletes: ['other'] },
      },
    );

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([added]);
    expect(applied.tokenAnalysisLinks).toStrictEqual({
      puts: [added],
      deletes: ['other', 'kept'],
    });
  });

  it('takes no link with a delete of an analysis not stored', () => {
    const { draft, applied } = applyChangeSet(draftWith({ tokenAnalysisLinks: [kept] }), {
      intent: 'delete',
      tokenAnalyses: { puts: [], deletes: ['a'] },
    });

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([kept]);
    expect(applied).toStrictEqual({ intent: 'delete' });
  });
});

describe('applyChangeSet applied', () => {
  it('reports the changes as given when every delete names a stored record', () => {
    const changes = {
      intent: 'edit',
      tokenAnalyses: { puts: [payload('b')], deletes: ['a'] },
    };

    expect(applyChangeSet(draftOf(payload('a')), changes).applied).toStrictEqual(changes);
  });

  it('leaves out each delete of a record not stored', () => {
    const { applied } = applyChangeSet(draftOf(payload('a')), {
      intent: 'edit',
      tokenAnalyses: { puts: [payload('b')], deletes: ['missing'] },
    });

    expect(applied).toStrictEqual({
      intent: 'edit',
      tokenAnalyses: { puts: [payload('b')], deletes: [] },
    });
  });

  it("carries the scope's record the changes put", () => {
    const scope = { ...scopeRecordOf(draftOf()), suggestedDescription: 'Draft' };

    expect(applyChangeSet(draftOf(), { intent: 'describe', scope }).applied).toStrictEqual({
      intent: 'describe',
      scope,
    });
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

describe('mergeChangeSets', () => {
  it('applies as its two change sets applied in turn', () => {
    const draft = draftOf(payload('a'), payload('b'), payload('c'));
    const first = {
      intent: 'first',
      tokenAnalyses: { puts: [payload('a', 'one'), payload('d')], deletes: ['b'] },
    };
    const then = {
      intent: 'then',
      tokenAnalyses: { puts: [payload('a', 'two'), payload('e')], deletes: ['d', 'c'] },
    };

    const merged = applyChangeSet(draft, mergeChangeSets(first, then)).draft;
    const inTurn = applyChangeSet(applyChangeSet(draft, first).draft, then).draft;

    expect(merged.analysis.tokenAnalyses).toEqual(
      expect.arrayContaining(inTurn.analysis.tokenAnalyses),
    );
    expect(merged.analysis.tokenAnalyses).toHaveLength(inTurn.analysis.tokenAnalyses.length);
  });

  it.each(['segmentAnalyses', 'tokenAnalyses', 'phraseAnalyses'] as const)(
    'throws when the later change set puts one of %s that the first deletes',
    (kind) => {
      const first = { intent: 'a', [kind]: { puts: [], deletes: ['x'] } };
      const then = { intent: 'b', [kind]: { puts: [{ id: 'x' }], deletes: [] } };

      expect(() => mergeChangeSets(first, then)).toThrow(/delete and then put .* x/);
    },
  );

  it('merges a link that the first change set deletes and the later one puts', () => {
    const link = makeTokenLink('a', 'GEN 1:1:0', { id: 'l' });

    const merged = mergeChangeSets(
      { intent: 'a', tokenAnalysisLinks: { puts: [], deletes: ['l'] } },
      { intent: 'b', tokenAnalysisLinks: { puts: [link], deletes: [] } },
    );

    expect(merged.tokenAnalysisLinks).toStrictEqual({ puts: [link], deletes: [] });
  });

  it("is named by the first change set's intent", () => {
    expect(mergeChangeSets({ intent: 'first' }, { intent: 'then' }).intent).toBe('first');
  });

  it("keeps the later scope's record when both have one", () => {
    const earlier = scopeRecordOf({ ...draftOf(), suggestedDescription: 'Earlier' });
    const later = scopeRecordOf({ ...draftOf(), suggestedDescription: 'Later' });

    expect(
      mergeChangeSets({ intent: 'a', scope: earlier }, { intent: 'b', scope: later }).scope,
    ).toBe(later);
  });

  it("keeps the earlier scope's record when only it has one", () => {
    const earlier = scopeRecordOf({ ...draftOf(), suggestedDescription: 'Earlier' });

    expect(mergeChangeSets({ intent: 'a', scope: earlier }, { intent: 'b' }).scope).toBe(earlier);
  });

  it('merges every record kind both change sets change', () => {
    const kinds = [
      'segmentAnalyses',
      'segmentAnalysisLinks',
      'tokenAnalyses',
      'tokenAnalysisLinks',
      'phraseAnalyses',
      'phraseAnalysisLinks',
    ] as const;
    const deleting = (id: string) =>
      Object.fromEntries(kinds.map((kind) => [kind, { puts: [], deletes: [id] }]));

    const merged = mergeChangeSets(
      { intent: 'a', ...deleting('x') },
      { intent: 'b', ...deleting('y') },
    );

    expect(merged).toStrictEqual({
      intent: 'a',
      ...Object.fromEntries(kinds.map((kind) => [kind, { puts: [], deletes: ['x', 'y'] }])),
    });
  });

  it('carries each kind that either change set changes, and no other', () => {
    const merged = mergeChangeSets(
      { intent: 'a', tokenAnalyses: { puts: [payload('a')], deletes: [] } },
      { intent: 'b', segmentAnalyses: { puts: [], deletes: ['s'] } },
    );

    expect(merged).toStrictEqual({
      intent: 'a',
      tokenAnalyses: { puts: [payload('a')], deletes: [] },
      segmentAnalyses: { puts: [], deletes: ['s'] },
    });
  });
});

describe('touched', () => {
  it("lists the changes' puts, then the inverse's", () => {
    const put = { id: 'a' };
    const restored = { id: 'b' };

    expect(
      touched({ puts: [put], deletes: ['b'] }, { puts: [restored], deletes: ['a'] }),
    ).toStrictEqual([put, restored]);
  });

  it('lists nothing for a kind that neither side changes', () => {
    expect(touched(undefined, undefined)).toStrictEqual([]);
  });
});
