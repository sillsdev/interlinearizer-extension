/// <reference types="jest" />

import type { DraftProject, TextAnalysis, TokenAnalysis } from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  applyChangeSet,
  invertChangeSet,
  isEmptyChangeSet,
  mergeChangeSets,
  patchRecord,
  scopeRecordOf,
  touched,
} from '../../utils/change-set';
import {
  creating,
  deleting,
  FIXTURE_STAMPS,
  makePhraseLink,
  makeTokenLink,
  updating,
} from '../test-helpers';

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

describe('patchRecord', () => {
  it('writes each field that differs between before and after', () => {
    const stored = { id: 'a', pos: 'n', surfaceText: 'x' };

    expect(
      patchRecord(stored, {
        before: { id: 'a', pos: 'n', surfaceText: 'a' },
        after: { id: 'a', pos: 'v', surfaceText: 'a' },
      }),
    ).toStrictEqual({ id: 'a', pos: 'v', surfaceText: 'x' });
  });

  it('removes a field that after lacks', () => {
    expect(
      patchRecord<{ id: string; pos?: string }>(
        { id: 'a', pos: 'n' },
        { before: { id: 'a', pos: 'n' }, after: { id: 'a' } },
      ),
    ).toStrictEqual({ id: 'a' });
  });

  it('writes a keyed field key by key, keeping keys that before and after agree on', () => {
    const stored = { id: 'a', gloss: { en: 'one', fr: 'un' } };

    expect(
      patchRecord<{ id: string; gloss: Record<string, string> }>(
        stored,
        { before: { id: 'a', gloss: { en: 'one' } }, after: { id: 'a', gloss: { en: 'two' } } },
        ['gloss'],
      ),
    ).toStrictEqual({ id: 'a', gloss: { en: 'two', fr: 'un' } });
  });

  it('removes a key that after lacks from a keyed field', () => {
    expect(
      patchRecord(
        { id: 'a', gloss: { en: 'one', fr: 'un' } },
        { before: { id: 'a', gloss: { en: 'one' } }, after: { id: 'a', gloss: {} } },
        ['gloss'],
      ),
    ).toStrictEqual({ id: 'a', gloss: { fr: 'un' } });
  });

  it('removes a keyed field left with no keys that after lacks', () => {
    expect(
      patchRecord<{ id: string; gloss?: Record<string, string> }>(
        { id: 'a', gloss: { en: 'one' } },
        { before: { id: 'a', gloss: { en: 'one' } }, after: { id: 'a' } },
        ['gloss'],
      ),
    ).toStrictEqual({ id: 'a' });
  });

  it('removes a key named like an inherited property that after lacks', () => {
    expect(
      patchRecord<{ id: string; features: Record<string, string> }>(
        { id: 'a', features: { toString: 'x', case: 'nom' } },
        { before: { id: 'a', features: { toString: 'x' } }, after: { id: 'a', features: {} } },
        ['features'],
      ),
    ).toStrictEqual({ id: 'a', features: { case: 'nom' } });
  });

  it('writes a `__proto__` key as an own key', () => {
    const after = JSON.parse('{"id":"a","features":{"__proto__":"x"}}');

    const patched = patchRecord({ id: 'a' }, { before: { id: 'a' }, after }, ['features']);

    expect(Object.keys(Reflect.get(patched, 'features'))).toStrictEqual(['__proto__']);
  });

  it('starts a keyed field that the stored record lacks', () => {
    expect(
      patchRecord<{ id: string; gloss?: Record<string, string> }>(
        { id: 'a' },
        { before: { id: 'a' }, after: { id: 'a', gloss: { en: 'one' } } },
        ['gloss'],
      ),
    ).toStrictEqual({ id: 'a', gloss: { en: 'one' } });
  });
});

describe('applyChangeSet', () => {
  it('creates a record after those stored', () => {
    const { draft, applied } = applyChangeSet(draftOf(payload('a')), {
      intent: 'add',
      tokenAnalyses: creating([payload('b')]),
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([payload('a'), payload('b')]);
    expect(applied.tokenAnalyses).toStrictEqual({ puts: [payload('b')], deletes: [] });
  });

  it('creates more records than a function call takes arguments', () => {
    const many = Array.from({ length: 200_000 }, (_, index) => payload(`t${index}`));

    const { draft } = applyChangeSet(draftOf(), { intent: 'add', tokenAnalyses: creating(many) });

    expect(draft.analysis.tokenAnalyses).toHaveLength(many.length);
  });

  it('updates a stored record in its place', () => {
    const { draft } = applyChangeSet(draftOf(payload('a'), payload('b'), payload('c')), {
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('b'), after: payload('b', 'bee') }),
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([
      payload('a'),
      payload('b', 'bee'),
      payload('c'),
    ]);
  });

  it('keeps a field that the update leaves alone as stored, though the update read it otherwise', () => {
    const stored = { ...payload('a', 'one'), pos: 'noun' };

    const { draft, applied } = applyChangeSet(draftOf(stored), {
      intent: 'gloss',
      tokenAnalyses: updating({ before: payload('a', 'one'), after: payload('a', 'two') }),
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([{ ...payload('a', 'two'), pos: 'noun' }]);
    expect(applied.tokenAnalyses?.puts).toStrictEqual([{ ...payload('a', 'two'), pos: 'noun' }]);
  });

  it('keeps a gloss language that the update leaves alone as stored', () => {
    const stored = { ...payload('a'), gloss: { en: 'one', fr: 'un' } };

    const { draft } = applyChangeSet(draftOf(stored), {
      intent: 'gloss',
      tokenAnalyses: updating({ before: payload('a', 'one'), after: payload('a', 'two') }),
    });

    expect(draft.analysis.tokenAnalyses[0].gloss).toStrictEqual({ en: 'two', fr: 'un' });
  });

  it('skips an update of a record not stored', () => {
    const { draft, applied } = applyChangeSet(draftOf(payload('a')), {
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('b'), after: payload('b', 'bee') }),
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([payload('a')]);
    expect(applied).toStrictEqual({ intent: 'edit' });
  });

  it('leaves out of what it applied an update that changes nothing stored', () => {
    const { applied } = applyChangeSet(draftOf(payload('a', 'two')), {
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('a', 'one'), after: payload('a', 'two') }),
    });

    expect(applied).toStrictEqual({ intent: 'edit' });
  });

  it('deletes a stored record', () => {
    const { draft, applied } = applyChangeSet(draftOf(payload('a'), payload('b')), {
      intent: 'delete',
      tokenAnalyses: deleting([payload('a')]),
    });

    expect(draft.analysis.tokenAnalyses).toStrictEqual([payload('b')]);
    expect(applied.tokenAnalyses).toStrictEqual({ puts: [], deletes: ['a'] });
  });

  it('leaves out of what it applied a delete of a record not stored', () => {
    const { applied } = applyChangeSet(draftOf(payload('a')), {
      intent: 'deleteMissing',
      tokenAnalyses: deleting([payload('missing')]),
    });

    expect(applied).toStrictEqual({ intent: 'deleteMissing' });
  });

  it("updates the scope's record field by field", () => {
    const stored = { ...draftOf(), dirty: true, suggestedDescription: 'Old' };
    const segmentation = { removedVerseStarts: ['GEN 1:2'], addedStarts: [] };
    const read = scopeRecordOf(draftOf());

    const { draft, applied } = applyChangeSet(stored, {
      intent: 'boundaries',
      scope: { before: read, after: { ...read, segmentation } },
    });

    const scope = { ...scopeRecordOf(stored), segmentation };
    expect(draft).toStrictEqual({ ...scope, dirty: true, analysis: stored.analysis });
    expect(applied.scope).toStrictEqual(scope);
  });

  it('marks the draft unsaved', () => {
    const { draft } = applyChangeSet(draftOf(payload('a')), {
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('a'), after: payload('a', 'ay') }),
    });

    expect(draft.dirty).toBe(true);
  });

  it('leaves the draft it was given as it was', () => {
    const stored = draftOf(payload('a'));
    const read = scopeRecordOf(stored);

    applyChangeSet(stored, {
      intent: 'edit',
      scope: { before: read, after: { ...read, suggestedDescription: 'New' } },
      tokenAnalyses: {
        creates: [payload('b')],
        updates: [{ before: payload('a'), after: payload('a', 'ay') }],
        deletes: [],
      },
    });

    expect(stored).toStrictEqual(draftOf(payload('a')));
  });

  it('refuses an id both updated and deleted', () => {
    expect(() =>
      applyChangeSet(draftOf(payload('a')), {
        intent: 'conflict',
        tokenAnalyses: {
          creates: [],
          updates: [{ before: payload('a'), after: payload('a', 'ay') }],
          deletes: [payload('a')],
        },
      }),
    ).toThrow('a change set names token analysis record a more than once');
  });

  it('refuses an id created twice', () => {
    expect(() =>
      applyChangeSet(draftOf(), {
        intent: 'conflict',
        tokenAnalyses: creating([payload('a'), payload('a', 'ay')]),
      }),
    ).toThrow('a change set names token analysis record a more than once');
  });

  it('refuses a create of a stored record', () => {
    expect(() =>
      applyChangeSet(draftOf(payload('a')), {
        intent: 'conflict',
        tokenAnalyses: creating([payload('a', 'ay')]),
      }),
    ).toThrow('a change set creates token analysis record a, which is stored');
  });

  it('refuses an update whose before and after name different records', () => {
    expect(() =>
      applyChangeSet(draftOf(payload('a')), {
        intent: 'conflict',
        tokenAnalyses: updating({ before: payload('b'), after: payload('a') }),
      }),
    ).toThrow('an update of token analysis record a reads as record b');
  });

  it("refuses a scope's record of another source project", () => {
    const read = scopeRecordOf(draftOf());

    expect(() =>
      applyChangeSet(draftOf(), {
        intent: 'conflict',
        scope: { before: read, after: { ...read, sourceProjectId: 'other' } },
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
      segmentAnalyses: creating([{ id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'In' }]),
      segmentAnalysisLinks: creating([
        { ...link, id: 'sl', analysisId: 'sa', segmentId: 'GEN 1:1' },
      ]),
      tokenAnalyses: creating([payload('a')]),
      tokenAnalysisLinks: creating([
        { ...link, id: 'tl', token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' } },
      ]),
      phraseAnalyses: creating([{ id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'In the' }]),
      phraseAnalysisLinks: creating([
        {
          ...link,
          id: 'pl',
          analysisId: 'pa',
          tokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
        },
      ]),
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

  it('deletes each link naming an analysis it deletes, reporting the delete', () => {
    const { draft, applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a'), payload('b')], tokenAnalysisLinks: [kept, other] }),
      { intent: 'delete', tokenAnalyses: deleting([payload('a')]) },
    );

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([other]);
    expect(applied.tokenAnalysisLinks).toStrictEqual({ puts: [], deletes: ['kept'] });
  });

  it('deletes the phrase and segment links of the analyses it deletes', () => {
    const phraseLink = makePhraseLink('pa', ['GEN 1:1:0']);
    const phrase = { id: 'pa', ...FIXTURE_STAMPS, surfaceText: 'In' };
    const segment = { id: 'sa', ...FIXTURE_STAMPS, surfaceText: 'In' };
    const segmentLink = {
      id: 'sl',
      analysisId: 'sa',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      segmentId: 'GEN 1:1',
    };

    const { draft, applied } = applyChangeSet(
      draftWith({
        phraseAnalyses: [phrase],
        phraseAnalysisLinks: [phraseLink],
        segmentAnalyses: [segment],
        segmentAnalysisLinks: [segmentLink],
      }),
      {
        intent: 'delete',
        phraseAnalyses: deleting([phrase]),
        segmentAnalyses: deleting([segment]),
      },
    );

    expect(draft.analysis.phraseAnalysisLinks).toStrictEqual([]);
    expect(draft.analysis.segmentAnalysisLinks).toStrictEqual([]);
    expect(applied.phraseAnalysisLinks?.deletes).toStrictEqual(['pa']);
    expect(applied.segmentAnalysisLinks?.deletes).toStrictEqual(['sl']);
  });

  it('leaves alone a link that the changes update, though it names an analysis they delete', () => {
    const moved = { ...kept, status: 'suggested' as const };

    const { draft, applied } = applyChangeSet(
      draftWith({ tokenAnalyses: [payload('a')], tokenAnalysisLinks: [kept] }),
      {
        intent: 'delete',
        tokenAnalyses: deleting([payload('a')]),
        tokenAnalysisLinks: updating({ before: kept, after: moved }),
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
        tokenAnalyses: deleting([payload('a')]),
        tokenAnalysisLinks: deleting([kept]),
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
        tokenAnalyses: deleting([payload('a')]),
        tokenAnalysisLinks: { creates: [added], updates: [], deletes: [other] },
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
      tokenAnalyses: deleting([payload('a')]),
    });

    expect(draft.analysis.tokenAnalysisLinks).toStrictEqual([kept]);
    expect(applied).toStrictEqual({ intent: 'delete' });
  });
});

describe('invertChangeSet', () => {
  it('deletes what the changes created', () => {
    const changes = { intent: 'add', tokenAnalyses: creating([payload('a')]) };

    expect(
      invertChangeSet(changes, {
        intent: 'add',
        tokenAnalyses: { puts: [payload('a')], deletes: [] },
      }),
    ).toStrictEqual({ intent: 'add', tokenAnalyses: deleting([payload('a')]) });
  });

  it('updates back what the changes updated', () => {
    const changes = {
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('a', 'one'), after: payload('a', 'two') }),
    };

    expect(
      invertChangeSet(changes, {
        intent: 'edit',
        tokenAnalyses: { puts: [payload('a', 'two')], deletes: [] },
      }),
    ).toStrictEqual({
      intent: 'edit',
      tokenAnalyses: updating({ before: payload('a', 'two'), after: payload('a', 'one') }),
    });
  });

  it('creates again what the changes deleted', () => {
    const changes = { intent: 'delete', tokenAnalyses: deleting([payload('a')]) };

    expect(
      invertChangeSet(changes, { intent: 'delete', tokenAnalyses: { puts: [], deletes: ['a'] } }),
    ).toStrictEqual({ intent: 'delete', tokenAnalyses: creating([payload('a')]) });
  });

  it('leaves out each change that the apply skipped', () => {
    const changes = {
      intent: 'edit',
      tokenAnalyses: {
        creates: [],
        updates: [{ before: payload('a'), after: payload('a', 'ay') }],
        deletes: [payload('b')],
      },
    };

    expect(invertChangeSet(changes, { intent: 'edit' })).toStrictEqual({ intent: 'edit' });
  });

  it('leaves out a kind left with no changes to undo', () => {
    const changes = { intent: 'delete', tokenAnalyses: deleting([payload('a')]) };

    expect(
      invertChangeSet(changes, { intent: 'delete', tokenAnalyses: { puts: [], deletes: ['b'] } }),
    ).toStrictEqual({ intent: 'delete' });
  });

  it("swaps the scope's update", () => {
    const before = scopeRecordOf(draftOf());
    const after = { ...before, suggestedDescription: 'New' };

    expect(
      invertChangeSet({ intent: 'describe', scope: { before, after } }, { intent: 'describe' })
        .scope,
    ).toStrictEqual({ before: after, after: before });
  });

  it('undoes every record kind', () => {
    const kinds = [
      'segmentAnalyses',
      'segmentAnalysisLinks',
      'tokenAnalyses',
      'tokenAnalysisLinks',
      'phraseAnalyses',
      'phraseAnalysisLinks',
    ] as const;
    const record = { id: 'x' };

    const inverse = invertChangeSet(
      { intent: 'a', ...Object.fromEntries(kinds.map((kind) => [kind, creating([record])])) },
      {
        intent: 'a',
        ...Object.fromEntries(kinds.map((kind) => [kind, { puts: [record], deletes: [] }])),
      },
    );

    expect(inverse).toStrictEqual({
      intent: 'a',
      ...Object.fromEntries(kinds.map((kind) => [kind, deleting([record])])),
    });
  });

  it('undoes the changes when applied after them', () => {
    const stored = draftOf(payload('a', 'one'), payload('b'));
    const changes = {
      intent: 'edit',
      tokenAnalyses: {
        creates: [payload('c')],
        updates: [{ before: payload('a', 'one'), after: payload('a', 'two') }],
        deletes: [payload('b')],
      },
    };
    const { draft, applied } = applyChangeSet(stored, changes);

    const undone = applyChangeSet(draft, invertChangeSet(changes, applied)).draft;

    expect(undone.analysis.tokenAnalyses).toEqual(
      expect.arrayContaining(stored.analysis.tokenAnalyses),
    );
    expect(undone.analysis.tokenAnalyses).toHaveLength(2);
  });
});

describe('isEmptyChangeSet', () => {
  it('finds a change set naming only its intent empty', () => {
    expect(isEmptyChangeSet({ intent: 'none' })).toBe(true);
  });

  it('finds a change set with record changes not empty', () => {
    expect(isEmptyChangeSet({ intent: 'edit', tokenAnalyses: deleting([payload('a')]) })).toBe(
      false,
    );
  });

  it("finds a change set updating the scope's record not empty", () => {
    const scope = scopeRecordOf(draftOf());

    expect(isEmptyChangeSet({ intent: 'edit', scope: { before: scope, after: scope } })).toBe(
      false,
    );
  });
});

describe('mergeChangeSets', () => {
  it('applies as its two change sets applied in turn', () => {
    const draft = draftOf(payload('a'), payload('b'), payload('c'), payload('f'));
    const first = {
      intent: 'first',
      tokenAnalyses: {
        creates: [payload('d'), payload('g')],
        updates: [
          { before: payload('a'), after: payload('a', 'one') },
          { before: payload('f'), after: payload('f', 'one') },
        ],
        deletes: [payload('b')],
      },
    };
    const then = {
      intent: 'then',
      tokenAnalyses: {
        creates: [payload('e')],
        updates: [
          { before: payload('a', 'one'), after: payload('a', 'two') },
          { before: payload('g'), after: payload('g', 'gee') },
        ],
        deletes: [payload('d'), payload('c'), payload('f', 'one')],
      },
    };

    const merged = applyChangeSet(draft, mergeChangeSets(first, then)).draft;
    const inTurn = applyChangeSet(applyChangeSet(draft, first).draft, then).draft;

    expect(merged.analysis.tokenAnalyses).toEqual(
      expect.arrayContaining(inTurn.analysis.tokenAnalyses),
    );
    expect(merged.analysis.tokenAnalyses).toHaveLength(inTurn.analysis.tokenAnalyses.length);
  });

  it('merges two updates of a record into one from the first read to the later edit', () => {
    const merged = mergeChangeSets(
      {
        intent: 'a',
        tokenAnalyses: updating({ before: payload('a'), after: payload('a', 'one') }),
      },
      {
        intent: 'b',
        tokenAnalyses: updating({ before: payload('a', 'one'), after: payload('a', 'two') }),
      },
    );

    expect(merged.tokenAnalyses).toStrictEqual(
      updating({ before: payload('a'), after: payload('a', 'two') }),
    );
  });

  it('merges an update then a delete into a delete of the record as first read', () => {
    const merged = mergeChangeSets(
      {
        intent: 'a',
        tokenAnalyses: updating({ before: payload('a'), after: payload('a', 'one') }),
      },
      { intent: 'b', tokenAnalyses: deleting([payload('a', 'one')]) },
    );

    expect(merged.tokenAnalyses).toStrictEqual(deleting([payload('a')]));
  });

  it('keeps a delete that a later update or delete of the record follows', () => {
    const merged = mergeChangeSets(
      {
        intent: 'a',
        tokenAnalysisLinks: deleting([
          makeTokenLink('a', 'GEN 1:1:0', { id: 'l' }),
          makeTokenLink('a', 'GEN 1:1:1', { id: 'm' }),
        ]),
      },
      {
        intent: 'b',
        tokenAnalysisLinks: {
          creates: [],
          updates: [
            {
              before: makeTokenLink('a', 'GEN 1:1:0', { id: 'l' }),
              after: makeTokenLink('b', 'GEN 1:1:0', { id: 'l' }),
            },
          ],
          deletes: [makeTokenLink('a', 'GEN 1:1:1', { id: 'm' })],
        },
      },
    );

    expect(merged.tokenAnalysisLinks).toStrictEqual(
      deleting([
        makeTokenLink('a', 'GEN 1:1:0', { id: 'l' }),
        makeTokenLink('a', 'GEN 1:1:1', { id: 'm' }),
      ]),
    );
  });

  it('drops a record that the first change set creates and the later one deletes', () => {
    const merged = mergeChangeSets(
      { intent: 'a', tokenAnalyses: creating([payload('a')]) },
      { intent: 'b', tokenAnalyses: deleting([payload('a')]) },
    );

    expect(merged.tokenAnalyses).toStrictEqual({ creates: [], updates: [], deletes: [] });
  });

  it.each(['segmentAnalyses', 'tokenAnalyses', 'phraseAnalyses'] as const)(
    'throws when the later change set creates one of %s that the first deletes',
    (kind) => {
      const first = { intent: 'a', [kind]: deleting([{ id: 'x' }]) };
      const then = { intent: 'b', [kind]: creating([{ id: 'x' }]) };

      expect(() => mergeChangeSets(first, then)).toThrow(/delete and then create .* x/);
    },
  );

  it('throws when the later change set creates a record that the first leaves stored', () => {
    expect(() =>
      mergeChangeSets(
        {
          intent: 'a',
          tokenAnalysisLinks: creating([makeTokenLink('a', 'GEN 1:1:0', { id: 'l' })]),
        },
        {
          intent: 'b',
          tokenAnalysisLinks: creating([makeTokenLink('a', 'GEN 1:1:0', { id: 'l' })]),
        },
      ),
    ).toThrow('cannot merge change sets that create token analysis link l while it is stored');
  });

  it('merges a link that the first change set deletes and the later one creates into an update', () => {
    const link = makeTokenLink('a', 'GEN 1:1:0', { id: 'l' });
    const relinked = makeTokenLink('b', 'GEN 1:1:0', { id: 'l' });

    const merged = mergeChangeSets(
      { intent: 'a', tokenAnalysisLinks: deleting([link]) },
      { intent: 'b', tokenAnalysisLinks: creating([relinked]) },
    );

    expect(merged.tokenAnalysisLinks).toStrictEqual(updating({ before: link, after: relinked }));
  });

  it("is named by the first change set's intent", () => {
    expect(mergeChangeSets({ intent: 'first' }, { intent: 'then' }).intent).toBe('first');
  });

  it("updates the scope's record from the first read to the later edit when both update it", () => {
    const read = scopeRecordOf(draftOf());
    const earlier = { ...read, suggestedDescription: 'Earlier' };
    const later = { ...read, suggestedDescription: 'Later' };

    expect(
      mergeChangeSets(
        { intent: 'a', scope: { before: read, after: earlier } },
        { intent: 'b', scope: { before: earlier, after: later } },
      ).scope,
    ).toStrictEqual({ before: read, after: later });
  });

  it("keeps the first change set's scope update when only it has one", () => {
    const read = scopeRecordOf(draftOf());
    const scope = { before: read, after: { ...read, suggestedDescription: 'Earlier' } };

    expect(mergeChangeSets({ intent: 'a', scope }, { intent: 'b' }).scope).toBe(scope);
  });

  it("keeps the later change set's scope update when only it has one", () => {
    const read = scopeRecordOf(draftOf());
    const scope = { before: read, after: { ...read, suggestedDescription: 'Later' } };

    expect(mergeChangeSets({ intent: 'a' }, { intent: 'b', scope }).scope).toBe(scope);
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
    const deletingIn = (id: string) =>
      Object.fromEntries(kinds.map((kind) => [kind, deleting([{ id }])]));

    const merged = mergeChangeSets(
      { intent: 'a', ...deletingIn('x') },
      { intent: 'b', ...deletingIn('y') },
    );

    expect(merged).toStrictEqual({
      intent: 'a',
      ...Object.fromEntries(kinds.map((kind) => [kind, deleting([{ id: 'x' }, { id: 'y' }])])),
    });
  });

  it('carries each kind that either change set changes, and no other', () => {
    const merged = mergeChangeSets(
      { intent: 'a', tokenAnalyses: creating([payload('a')]) },
      {
        intent: 'b',
        segmentAnalyses: deleting([{ id: 's', ...FIXTURE_STAMPS, surfaceText: 's' }]),
      },
    );

    expect(merged).toStrictEqual({
      intent: 'a',
      tokenAnalyses: creating([payload('a')]),
      segmentAnalyses: deleting([{ id: 's', ...FIXTURE_STAMPS, surfaceText: 's' }]),
    });
  });
});

describe('touched', () => {
  it('lists the applied puts, then the records the inverse creates and updates to', () => {
    const put = { id: 'a' };
    const restored = { id: 'b' };
    const reverted = { id: 'c' };

    expect(
      touched(
        { puts: [put], deletes: ['b'] },
        {
          creates: [restored],
          updates: [{ before: { id: 'c' }, after: reverted }],
          deletes: [put],
        },
      ),
    ).toStrictEqual([put, restored, reverted]);
  });

  it('lists nothing for a kind that neither side changes', () => {
    expect(touched(undefined, undefined)).toStrictEqual([]);
  });
});
