/// <reference types="jest" />

import type { Pt9InterlinearCluster } from 'platform-scripture';
import { anchorVerseClusters, classifyCluster } from '../../../converters/pt9/clusterAnchoring';
import { makeSegment, makeWordToken, makePunctToken } from '../../test-helpers';

/** Builds a cluster literal the way the platform serves one. */
function mkCluster(
  index: number,
  length: number,
  lexemes: [id: string | undefined, senseId?: string][],
  excluded = false,
): Pt9InterlinearCluster {
  return {
    index,
    length,
    excluded,
    lexemes: lexemes.map(([lexemeId, senseId]) => ({
      ...(lexemeId !== undefined && { lexemeId }),
      ...(senseId !== undefined && { senseId }),
    })),
  };
}

/** A segment whose word tokens carry real offsets within the given text. */
function segmentOf(text: string): ReturnType<typeof makeSegment> {
  const tokens = Array.from(text.matchAll(/[^\s.,]+|[.,]/gu), (match) =>
    /[.,]/.test(match[0])
      ? makePunctToken(`GEN 1:1:${match.index}`, match[0], match.index)
      : makeWordToken(`GEN 1:1:${match.index}`, match[0], match.index),
  );
  return makeSegment('GEN 1:1', text, tokens);
}

describe('classifyCluster', () => {
  it('classifies a single Word lexeme as a word cluster', () => {
    const classified = classifyCluster(mkCluster(0, 5, [['Word:hello', 'S1']]));
    expect(classified.kind).toBe('word');
  });

  it('classifies any stem/suffix/prefix presence as a word parse, even mixed with Word', () => {
    expect(classifyCluster(mkCluster(0, 5, [['Stem:hell'], ['Suffix:o']])).kind).toBe('wordParse');
    expect(classifyCluster(mkCluster(0, 5, [['Word:hello'], ['Prefix:o']])).kind).toBe('wordParse');
  });

  it('classifies a single Phrase lexeme as a phrase cluster', () => {
    expect(classifyCluster(mkCluster(0, 8, [['Phrase:in the']])).kind).toBe('phrase');
  });

  it.each([
    ['a Lemma cluster', mkCluster(0, 4, [['Lemma:go']])],
    ['an empty cluster', mkCluster(0, 4, [])],
    ['a multi-Word cluster', mkCluster(0, 4, [['Word:a'], ['Word:b']])],
  ])('drops %s as lemmaOrOther', (_label, cluster) => {
    expect(classifyCluster(cluster)).toStrictEqual({
      kind: 'drop',
      cluster,
      reason: 'lemmaOrOther',
    });
  });

  it('drops a cluster containing an unparseable lexeme id', () => {
    const cluster = mkCluster(0, 4, [['Stem:ok'], ['garbage']]);
    expect(classifyCluster(cluster)).toStrictEqual({
      kind: 'drop',
      cluster,
      reason: 'unparseableLexemeId',
    });
  });

  it('drops a cluster whose lexeme carries no id', () => {
    const cluster = mkCluster(0, 4, [[undefined]]);
    expect(classifyCluster(cluster)).toStrictEqual({
      kind: 'drop',
      cluster,
      reason: 'unparseableLexemeId',
    });
  });
});

describe('anchorVerseClusters', () => {
  describe('word and parse anchoring', () => {
    it('anchors a word cluster to the token folding to its form', () => {
      const segment = segmentOf('Hello world');
      const result = anchorVerseClusters(segment, [mkCluster(5, 5, [['Word:hello', 'S1']])]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.surfaceText).toBe('Hello');
      expect(result.groups[0].word?.lexeme).toStrictEqual({
        key: { Type: 'Word', Form: 'hello' },
        senseId: 'S1',
      });
      expect(result.groups[0].parse).toBeUndefined();
      expect(result.groups[0].ambiguous).toBe(false);
      expect(result.ambiguousCount).toBe(0);
    });

    it('pairs a word and a parse cluster at the identical range onto one token', () => {
      const segment = segmentOf('hello world');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 5, [['Word:hello', 'S1']]),
        mkCluster(0, 5, [['Stem:hello'], ['Suffix:ing']]),
      ]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].word).toBeDefined();
      expect(result.groups[0].parse?.lexemes.map((l) => l.key.Form)).toStrictEqual([
        'hello',
        'ing',
      ]);
    });

    it('anchors a parse-only cluster by its concatenated forms', () => {
      const segment = segmentOf('exaucera demain');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 8, [['Stem:exauc'], ['Suffix:era']]),
      ]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.surfaceText).toBe('exaucera');
      expect(result.groups[0].word).toBeUndefined();
    });

    it('keeps only the first of two same-kind clusters at one range', () => {
      const segment = segmentOf('hello');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 5, [['Word:hello', 'S1']]),
        mkCluster(0, 5, [['Word:hello', 'S2']]),
        mkCluster(0, 5, [['Stem:hell'], ['Suffix:o']]),
        mkCluster(0, 5, [['Stem:he'], ['Suffix:llo']]),
      ]);

      expect(result.dropCounts.duplicateCluster).toBe(2);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].word?.lexeme.senseId).toBe('S1');
      expect(result.groups[0].parse?.lexemes.map((l) => l.key.Form)).toStrictEqual(['hell', 'o']);
    });

    it('drops both facets of an unmatched pair as form mismatches', () => {
      const segment = segmentOf('nothing here');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 3, [['Word:zzz']]),
        mkCluster(0, 3, [['Stem:zz'], ['Suffix:z']]),
      ]);

      expect(result.dropCounts.formMismatch).toBe(2);
      expect(result.groups).toHaveLength(0);
    });
  });

  describe('cursor order and disambiguation', () => {
    it('assigns clusters to same-fold tokens monotonically by range order', () => {
      const segment = segmentOf('a b a');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 1, [['Word:a', 'S1']]),
        mkCluster(4, 1, [['Word:a', 'S2']]),
      ]);

      expect(result.groups.map((g) => g.token.charStart)).toStrictEqual([0, 4]);
      // The first pick sees both same-fold tokens ahead of the cursor, so it counts as ambiguous
      // even though the prior lands it correctly; the second has one candidate left.
      expect(result.groups.map((g) => g.ambiguous)).toStrictEqual([true, false]);
      expect(result.ambiguousCount).toBe(1);
    });

    it('orders same-index range groups by length', () => {
      const segment = segmentOf('ab abcd');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 4, [['Word:abcd']]),
        mkCluster(0, 2, [['Word:ab']]),
      ]);

      expect(result.groups.map((g) => g.token.surfaceText)).toStrictEqual(['ab', 'abcd']);
    });

    it('drops a cluster whose only match lies behind the cursor', () => {
      const segment = segmentOf('a b');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 1, [['Word:b']]),
        mkCluster(4, 1, [['Word:a']]),
      ]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.surfaceText).toBe('b');
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('disambiguates repeated surface forms by the proportional-position prior', () => {
      const segment = segmentOf('a b a');
      const result = anchorVerseClusters(segment, [mkCluster(80, 1, [['Word:a', 'S1']])]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.charStart).toBe(4);
      expect(result.groups[0].ambiguous).toBe(true);
      expect(result.ambiguousCount).toBe(1);
    });

    it('counts an unparseable and a lemma cluster under their own drop reasons', () => {
      const segment = segmentOf('went');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 4, [['Lemma:go']]),
        mkCluster(0, 4, [['nonsense']]),
      ]);

      expect(result.dropCounts.lemmaOrOther).toBe(1);
      expect(result.dropCounts.unparseableLexemeId).toBe(1);
    });
  });

  describe('phrase anchoring', () => {
    it('anchors a phrase to the consecutive word tokens folding to its words', () => {
      const segment = segmentOf('Look in the book');
      const result = anchorVerseClusters(segment, [mkCluster(5, 6, [['Phrase:in the', 'S1']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens.map((t) => t.surfaceText)).toStrictEqual(['in', 'the']);
      expect(result.phrases[0].lexeme.senseId).toBe('S1');
      expect(result.phrases[0].ambiguous).toBe(false);
    });

    it('matches phrase words across intervening punctuation tokens', () => {
      const segment = segmentOf('in, the book');
      const result = anchorVerseClusters(segment, [mkCluster(0, 6, [['Phrase:in the']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens.map((t) => t.surfaceText)).toStrictEqual(['in', 'the']);
    });

    it('drops an unmatched phrase as a form mismatch', () => {
      const segment = segmentOf('in the book');
      const result = anchorVerseClusters(segment, [mkCluster(0, 6, [['Phrase:on the']])]);

      expect(result.phrases).toHaveLength(0);
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('drops a phrase whose form folds to no words', () => {
      const segment = segmentOf('in the book');
      const result = anchorVerseClusters(segment, [mkCluster(0, 1, [['Phrase: ']])]);

      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('assigns repeated phrase windows monotonically by range order', () => {
      const segment = segmentOf('in the x in the');
      const result = anchorVerseClusters(segment, [
        mkCluster(0, 6, [['Phrase:in the']]),
        mkCluster(20, 6, [['Phrase:in the']]),
      ]);

      expect(result.phrases.map((p) => p.tokens[0].charStart)).toStrictEqual([0, 9]);
      // The first pick sees both windows, so it counts as ambiguous even though the prior lands
      // it correctly; the second has one window left past the cursor.
      expect(result.phrases.map((p) => p.ambiguous)).toStrictEqual([true, false]);
      expect(result.ambiguousCount).toBe(1);
    });

    it('disambiguates a repeated phrase window by the proportional-position prior', () => {
      const segment = segmentOf('in the x in the');
      const result = anchorVerseClusters(segment, [mkCluster(90, 6, [['Phrase:in the']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens[0].charStart).toBe(9);
      expect(result.phrases[0].ambiguous).toBe(true);
    });
  });

  it('carries the Excluded flag on word, parse, and phrase anchors', () => {
    const segment = segmentOf('hello in the');
    const result = anchorVerseClusters(segment, [
      mkCluster(0, 5, [['Word:hello']], true),
      mkCluster(0, 5, [['Stem:hell'], ['Suffix:o']], true),
      mkCluster(6, 6, [['Phrase:in the']], true),
    ]);

    expect(result.groups[0].word?.excluded).toBe(true);
    expect(result.groups[0].parse?.excluded).toBe(true);
    expect(result.phrases[0].excluded).toBe(true);
  });

  it('returns empty results for a verse with no clusters', () => {
    const segment = segmentOf('hello');
    expect(anchorVerseClusters(segment, [])).toStrictEqual({
      groups: [],
      phrases: [],
      dropCounts: {
        verseNotFound: 0,
        formMismatch: 0,
        lemmaOrOther: 0,
        duplicateCluster: 0,
        unparseableLexemeId: 0,
      },
      ambiguousCount: 0,
    });
  });
});
