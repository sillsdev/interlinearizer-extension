/** @file Unit tests for utils/suggestion-engine.ts. */
/// <reference types="jest" />

import type { TokenAnalysis } from 'interlinearizer';
import type { ResolvedTokenAnalysis } from '../../utils/suggestion-engine';
import {
  buildPoolIndex,
  deriveTokenSuggestion,
  rankPoolEntries,
  resolvedTokenAnalysisEqual,
} from '../../utils/suggestion-engine';

/**
 * Builds a gloss-only `TokenAnalysis` for the pool-construction tests.
 *
 * @param id - The analysis id.
 * @param surfaceText - The analyzed surface form.
 * @param gloss - The English gloss to attach.
 * @returns A `TokenAnalysis` with the given id, surface text, and English gloss.
 */
function ta(id: string, surfaceText: string, gloss: string): TokenAnalysis {
  return { id, surfaceText, gloss: { en: gloss } };
}

describe('buildPoolIndex', () => {
  it('indexes each approved analysis under its normalized surface form with its frequency', () => {
    const dog = ta('a1', 'dog', 'dog');
    const byId = new Map([['a1', dog]]);
    const counts = new Map([['a1', 3]]);

    const index = buildPoolIndex(byId, counts);

    expect(index.get('dog')).toEqual([{ analysis: dog, frequency: 3 }]);
  });

  it('groups two distinct payloads sharing a surface form under one key (homograph)', () => {
    const riverbank = ta('b1', 'bank', 'riverbank');
    const moneyBank = ta('b2', 'bank', 'money bank');
    const byId = new Map([
      ['b1', riverbank],
      ['b2', moneyBank],
    ]);
    const counts = new Map([
      ['b1', 5],
      ['b2', 2],
    ]);

    const index = buildPoolIndex(byId, counts);

    expect(index.get('bank')).toEqual([
      { analysis: riverbank, frequency: 5 },
      { analysis: moneyBank, frequency: 2 },
    ]);
  });

  it('files distinct surface forms under separate keys', () => {
    const dog = ta('a1', 'dog', 'dog');
    const cat = ta('a2', 'cat', 'cat');
    const byId = new Map([
      ['a1', dog],
      ['a2', cat],
    ]);
    const counts = new Map([
      ['a1', 1],
      ['a2', 1],
    ]);

    const index = buildPoolIndex(byId, counts);

    expect(index.size).toBe(2);
    expect(index.get('dog')).toEqual([{ analysis: dog, frequency: 1 }]);
    expect(index.get('cat')).toEqual([{ analysis: cat, frequency: 1 }]);
  });

  it('normalizes the key so a sentence-initial payload is found by its lowercase form', () => {
    const the = ta('a1', 'The', 'the');
    const byId = new Map([['a1', the]]);
    const counts = new Map([['a1', 4]]);

    const index = buildPoolIndex(byId, counts);

    expect(index.has('The')).toBe(false);
    expect(index.get('the')).toEqual([{ analysis: the, frequency: 4 }]);
  });
});

describe('rankPoolEntries', () => {
  it('orders payloads by descending approval frequency', () => {
    const rare = ta('a1', 'set', 'to place');
    const common = ta('a2', 'set', 'a collection');

    const ranked = rankPoolEntries([
      { analysis: rare, frequency: 1 },
      { analysis: common, frequency: 9 },
    ]);

    expect(ranked.map((e) => e.analysis)).toEqual([common, rare]);
  });

  it('breaks frequency ties by ascending analysis id so the pick never flickers', () => {
    // Three equally-frequent homographs in scrambled id order must sort to ascending id, so the
    // top pick is deterministic regardless of the order they happen to sit in the pool.
    const ranked = rankPoolEntries([
      { analysis: ta('c3', 'set', 'C'), frequency: 3 },
      { analysis: ta('a1', 'set', 'A'), frequency: 3 },
      { analysis: ta('b2', 'set', 'B'), frequency: 3 },
    ]);

    expect(ranked.map((e) => e.analysis.id)).toEqual(['a1', 'b2', 'c3']);
  });

  it('returns a sorted copy without mutating the input array', () => {
    const rare = ta('a1', 'set', 'to place');
    const common = ta('a2', 'set', 'a collection');
    const input = [
      { analysis: rare, frequency: 1 },
      { analysis: common, frequency: 9 },
    ];

    rankPoolEntries(input);

    expect(input.map((e) => e.analysis)).toEqual([rare, common]);
  });
});

describe('deriveTokenSuggestion', () => {
  it('returns no suggestion when the surface form has no approved analysis in the pool', () => {
    const pool = buildPoolIndex(new Map(), new Map());

    expect(deriveTokenSuggestion(pool, 'unseen')).toBeUndefined();
  });

  it('suggests the single matching payload with no candidates', () => {
    const dog = ta('a1', 'dog', 'dog');
    const pool = buildPoolIndex(new Map([['a1', dog]]), new Map([['a1', 2]]));

    expect(deriveTokenSuggestion(pool, 'dog')).toEqual({ suggested: dog, candidates: [] });
  });

  it('elects the most-approved homograph as suggested and the rest as candidates', () => {
    const riverbank = ta('b1', 'bank', 'riverbank');
    const moneyBank = ta('b2', 'bank', 'money bank');
    const pool = buildPoolIndex(
      new Map([
        ['b1', riverbank],
        ['b2', moneyBank],
      ]),
      new Map([
        ['b1', 2],
        ['b2', 7],
      ]),
    );

    expect(deriveTokenSuggestion(pool, 'bank')).toEqual({
      suggested: moneyBank,
      candidates: [riverbank],
    });
  });

  it('matches case-insensitively so a sentence-initial token finds the pooled analysis', () => {
    const the = ta('a1', 'the', 'the');
    const pool = buildPoolIndex(new Map([['a1', the]]), new Map([['a1', 5]]));

    expect(deriveTokenSuggestion(pool, 'The')).toEqual({ suggested: the, candidates: [] });
  });
});

describe('resolvedTokenAnalysisEqual', () => {
  const dog = ta('a1', 'dog', 'dog');
  const cat = ta('a2', 'cat', 'cat');
  const fish = ta('a3', 'fish', 'fish');

  it('treats two undefined results (no decision, no match) as equal', () => {
    expect(resolvedTokenAnalysisEqual(undefined, undefined)).toBe(true);
  });

  it('treats a result and undefined as unequal in either order', () => {
    const approved: ResolvedTokenAnalysis = { status: 'approved', analysis: dog };
    expect(resolvedTokenAnalysisEqual(approved, undefined)).toBe(false);
    expect(resolvedTokenAnalysisEqual(undefined, approved)).toBe(false);
  });

  it('treats two approvals of the same payload as equal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'approved', analysis: dog },
        { status: 'approved', analysis: dog },
      ),
    ).toBe(true);
  });

  it('treats approvals of different payloads as unequal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'approved', analysis: dog },
        { status: 'approved', analysis: cat },
      ),
    ).toBe(false);
  });

  it('treats suggestions with the same pick and candidate list as equal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'suggested', suggested: dog, candidates: [cat, fish] },
        { status: 'suggested', suggested: dog, candidates: [cat, fish] },
      ),
    ).toBe(true);
  });

  it('treats suggestions with a different top pick as unequal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'suggested', suggested: dog, candidates: [] },
        { status: 'suggested', suggested: cat, candidates: [] },
      ),
    ).toBe(false);
  });

  it('treats suggestions differing in candidate count as unequal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'suggested', suggested: dog, candidates: [cat] },
        { status: 'suggested', suggested: dog, candidates: [cat, fish] },
      ),
    ).toBe(false);
  });

  it('treats suggestions differing in a candidate payload as unequal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'suggested', suggested: dog, candidates: [cat] },
        { status: 'suggested', suggested: dog, candidates: [fish] },
      ),
    ).toBe(false);
  });

  it('treats an approval and a suggestion of the same payload as unequal', () => {
    expect(
      resolvedTokenAnalysisEqual(
        { status: 'approved', analysis: dog },
        { status: 'suggested', suggested: dog, candidates: [] },
      ),
    ).toBe(false);
  });
});
