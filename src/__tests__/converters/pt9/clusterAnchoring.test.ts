/// <reference types="jest" />

import { anchorVerseClusters, classifyCluster } from '../../../converters/pt9/clusterAnchoring';
import { makePunctToken, makeSegment, makeVerseBook, makeWordToken } from '../../test-helpers';
import { mkCluster } from './test-helpers';

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
    expect(classifyCluster(mkCluster(0, 5, [['Stem:hel'], ['Suffix:lo']])).kind).toBe('wordParse');
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
      const result = anchorVerseClusters([segment], [mkCluster(5, 5, [['Word:hello', 'S1']])]);

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
      const result = anchorVerseClusters(
        [segment],
        [
          mkCluster(0, 5, [['Word:hello', 'S1']]),
          mkCluster(0, 5, [['Stem:hello'], ['Suffix:ing']]),
        ],
      );

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].word).toBeDefined();
      expect(result.groups[0].parse?.lexemes.map((l) => l.key.Form)).toStrictEqual([
        'hello',
        'ing',
      ]);
    });

    it('anchors a parse-only cluster by its concatenated forms', () => {
      const segment = segmentOf('exaucera demain');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 8, [['Stem:exauc'], ['Suffix:era']])],
      );

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.surfaceText).toBe('exaucera');
      expect(result.groups[0].word).toBeUndefined();
    });

    it('keeps only the first of two same-kind clusters at one range', () => {
      const segment = segmentOf('hello');
      const result = anchorVerseClusters(
        [segment],
        [
          mkCluster(0, 5, [['Word:hello', 'S1']]),
          mkCluster(0, 5, [['Word:hello', 'S2']]),
          mkCluster(0, 5, [['Stem:hel'], ['Suffix:lo']]),
          mkCluster(0, 5, [['Stem:he'], ['Suffix:llo']]),
        ],
      );

      expect(result.dropCounts.duplicateCluster).toBe(2);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].word?.lexeme.senseId).toBe('S1');
      expect(result.groups[0].parse?.lexemes.map((l) => l.key.Form)).toStrictEqual(['hel', 'lo']);
    });

    it('drops both facets of an unmatched pair as form mismatches', () => {
      const segment = segmentOf('nothing here');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 3, [['Word:zzz']]), mkCluster(0, 3, [['Stem:zz'], ['Suffix:z']])],
      );

      expect(result.dropCounts.formMismatch).toBe(2);
      expect(result.groups).toHaveLength(0);
    });
  });

  describe('cursor order and disambiguation', () => {
    it('assigns clusters to same-fold tokens monotonically by range order', () => {
      const segment = segmentOf('a b a');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 1, [['Word:a', 'S1']]), mkCluster(4, 1, [['Word:a', 'S2']])],
      );

      expect(result.groups.map((g) => g.token.charStart)).toStrictEqual([0, 4]);
      // The first pick sees both same-fold tokens ahead of the cursor, so it counts as ambiguous
      // even though the prior lands it correctly; the second has one candidate left.
      expect(result.groups.map((g) => g.ambiguous)).toStrictEqual([true, false]);
      expect(result.ambiguousCount).toBe(1);
    });

    it('orders same-index range groups by length', () => {
      const segment = segmentOf('ab abcd');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 4, [['Word:abcd']]), mkCluster(0, 2, [['Word:ab']])],
      );

      expect(result.groups.map((g) => g.token.surfaceText)).toStrictEqual(['ab', 'abcd']);
    });

    it('anchors one of two clusters whose forms run against the text, by the position prior', () => {
      const segment = segmentOf('a b');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 1, [['Word:b']]), mkCluster(4, 1, [['Word:a']])],
      );

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.surfaceText).toBe('a');
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('keeps a footnote cluster from claiming a later token at the cost of the clusters before it', () => {
      // Offsets index `\v 1 In the beginning\f + \ft Or when the Lord began\f* God created the
      // heavens.` as PT9 writes it; the text layer leaves the footnote out.
      const segment = segmentOf('In the beginning God created the heavens.');
      const result = anchorVerseClusters(
        [segment],
        [
          mkCluster(5, 2, [['Word:in', 'S-in']]),
          mkCluster(8, 3, [['Word:the', 'S-the']]),
          mkCluster(12, 9, [['Word:beginning', 'S-beginning']]),
          mkCluster(38, 3, [['Word:the', 'S-note']]),
          mkCluster(56, 3, [['Word:god', 'S-god']]),
          mkCluster(60, 7, [['Word:created', 'S-created']]),
          mkCluster(68, 3, [['Word:the', 'S-the']]),
          mkCluster(72, 7, [['Word:heavens', 'S-heavens']]),
        ],
      );

      expect(result.groups.map((g) => g.word?.lexeme.senseId)).toStrictEqual([
        'S-in',
        'S-the',
        'S-beginning',
        'S-god',
        'S-created',
        'S-the',
        'S-heavens',
      ]);
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('disambiguates repeated surface forms by the proportional-position prior', () => {
      const segment = segmentOf('a b a');
      const result = anchorVerseClusters([segment], [mkCluster(80, 1, [['Word:a', 'S1']])]);

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].token.charStart).toBe(4);
      expect(result.groups[0].ambiguous).toBe(true);
      expect(result.ambiguousCount).toBe(1);
    });

    it('places a repeated form analyzed only early in the verse on its early occurrence', () => {
      const segment = segmentOf('the cat saw the dog');
      const result = anchorVerseClusters([segment], [mkCluster(5, 3, [['Word:the']])]);

      expect(result.groups[0].token.charStart).toBe(0);
    });

    it('places a late range PT9 kept from a since-lengthened verse on the late occurrence', () => {
      // PT9 saved "\v 1 the cat the", putting the last "the" at 13.
      const segment = segmentOf('the very very very very cat the');
      const result = anchorVerseClusters([segment], [mkCluster(13, 3, [['Word:the']])]);

      expect(result.groups[0].token.charStart).toBe(28);
    });

    it('counts an unparseable and a lemma cluster under their own drop reasons', () => {
      const segment = segmentOf('went');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 4, [['Lemma:go']]), mkCluster(0, 4, [['nonsense']])],
      );

      expect(result.dropCounts.lemmaOrOther).toBe(1);
      expect(result.dropCounts.unparseableLexemeId).toBe(1);
    });
  });

  describe('phrase anchoring', () => {
    it('anchors a phrase to the consecutive word tokens folding to its words', () => {
      const segment = segmentOf('Look in the book');
      const result = anchorVerseClusters([segment], [mkCluster(5, 6, [['Phrase:in the', 'S1']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens.map((t) => t.surfaceText)).toStrictEqual(['in', 'the']);
      expect(result.phrases[0].lexeme.senseId).toBe('S1');
      expect(result.phrases[0].ambiguous).toBe(false);
    });

    it('matches phrase words across intervening punctuation tokens', () => {
      const segment = segmentOf('in, the book');
      const result = anchorVerseClusters([segment], [mkCluster(0, 6, [['Phrase:in the']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens.map((t) => t.surfaceText)).toStrictEqual(['in', 'the']);
    });

    it('drops an unmatched phrase as a form mismatch', () => {
      const segment = segmentOf('in the book');
      const result = anchorVerseClusters([segment], [mkCluster(0, 6, [['Phrase:on the']])]);

      expect(result.phrases).toHaveLength(0);
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('drops a phrase whose form folds to no words', () => {
      const segment = segmentOf('in the book');
      const result = anchorVerseClusters([segment], [mkCluster(0, 1, [['Phrase: ']])]);

      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('assigns repeated phrase windows monotonically by range order', () => {
      const segment = segmentOf('in the x in the');
      const result = anchorVerseClusters(
        [segment],
        [mkCluster(0, 6, [['Phrase:in the']]), mkCluster(20, 6, [['Phrase:in the']])],
      );

      expect(result.phrases.map((p) => p.tokens[0].charStart)).toStrictEqual([0, 9]);
      // The first pick sees both windows, so it counts as ambiguous even though the prior lands
      // it correctly; the second has one window left past the cursor.
      expect(result.phrases.map((p) => p.ambiguous)).toStrictEqual([true, false]);
      expect(result.ambiguousCount).toBe(1);
    });

    it('keeps a footnote phrase from claiming a later run at the cost of the phrases before it', () => {
      // Offsets index `\v 1 In the beginning\f + \ft Or the Lord\f* God created and the Lord
      // rested.` as PT9 writes it; the text layer leaves the footnote out.
      const segment = segmentOf('In the beginning God created and the Lord rested.');
      const result = anchorVerseClusters(
        [segment],
        [
          mkCluster(33, 8, [['Phrase:the Lord']]),
          mkCluster(45, 11, [['Phrase:God created']]),
          mkCluster(61, 8, [['Phrase:the Lord']]),
        ],
      );

      expect(result.phrases.map((p) => p.tokens.map((t) => t.surfaceText).join(' '))).toStrictEqual(
        ['God created', 'the Lord'],
      );
      expect(result.dropCounts.formMismatch).toBe(1);
    });

    it('disambiguates a repeated phrase window by the proportional-position prior', () => {
      const segment = segmentOf('in the x in the');
      const result = anchorVerseClusters([segment], [mkCluster(90, 6, [['Phrase:in the']])]);

      expect(result.phrases).toHaveLength(1);
      expect(result.phrases[0].tokens[0].charStart).toBe(9);
      expect(result.phrases[0].ambiguous).toBe(true);
    });
  });

  it('carries the Excluded flag on word, parse, and phrase anchors', () => {
    const segment = segmentOf('hello in the');
    const result = anchorVerseClusters(
      [segment],
      [
        mkCluster(0, 5, [['Word:hello']], true),
        mkCluster(0, 5, [['Stem:hel'], ['Suffix:lo']], true),
        mkCluster(6, 6, [['Phrase:in the']], true),
      ],
    );

    expect(result.groups[0].word?.excluded).toBe(true);
    expect(result.groups[0].parse?.excluded).toBe(true);
    expect(result.phrases[0].excluded).toBe(true);
  });

  it('returns empty results for a verse with no clusters', () => {
    const segment = segmentOf('hello');
    expect(anchorVerseClusters([segment], [])).toStrictEqual({
      groups: [],
      phrases: [],
      dropCounts: {
        verseNotFound: 0,
        formMismatch: 0,
        frontMatter: 0,
        lemmaOrOther: 0,
        duplicateCluster: 0,
        unparseableLexemeId: 0,
      },
      ambiguousCount: 0,
    });
  });

  describe('headings', () => {
    const verseText = 'Grace and peace to you from God our Father.';
    const headingText = 'Thanksgiving and Prayer';
    /** Where PT9's range indexes place the heading: behind the verse's marker and its own. */
    const headingIndex = '\\v 2 '.length + verseText.length + '\n\\s '.length;

    /** PHP 1:2 and the heading filed under it, as the book tokenizes them. */
    function verseWithHeading() {
      return makeVerseBook([
        { sid: 'PHP 1:2', text: verseText },
        { heading: 's', verseId: 'PHP 1:2', text: headingText },
      ]).segments;
    }

    it('anchors a heading cluster filed under the verse onto the heading', () => {
      const result = anchorVerseClusters(verseWithHeading(), [
        mkCluster(5, 5, [['Word:grace']]),
        mkCluster(headingIndex, 12, [['Word:thanksgiving']]),
      ]);

      expect(result.groups.map((g) => g.token.ref)).toEqual(['PHP 1:2:0', 'PHP 1:2/s:0']);
      expect(result.dropCounts.formMismatch).toBe(0);
    });

    it('places a form repeated in the verse and the heading by where the cluster falls', () => {
      const result = anchorVerseClusters(verseWithHeading(), [
        mkCluster(headingIndex + 13, 3, [['Word:and']]),
      ]);

      expect(result.groups[0].token.ref).toBe('PHP 1:2/s:13');
      expect(result.groups[0].ambiguous).toBe(true);
    });

    it('places a repeated verse form by its position in the verse and headings together', () => {
      const text = 'the cat saw the dog';
      const longHeading = 'A heading long enough to outweigh the verse it follows';
      const { segments } = makeVerseBook([
        { sid: 'GEN 1:1', text },
        { heading: 's', verseId: 'GEN 1:1', text: longHeading },
      ]);
      const lastHeadingWord =
        '\\v 1 '.length + text.length + '\n\\s '.length + longHeading.indexOf('follows');

      const result = anchorVerseClusters(segments, [
        mkCluster(5 + 12, 3, [['Word:the']]),
        mkCluster(lastHeadingWord, 7, [['Word:follows']]),
      ]);

      expect(result.groups[0].token.ref).toBe('GEN 1:1:12');
    });

    it('keeps a verse form analyzed alone on the verse rather than the same form in its heading', () => {
      const { segments } = makeVerseBook([
        { sid: 'GEN 1:1', text: 'the' },
        { heading: 's1', verseId: 'GEN 1:1', text: 'the' },
      ]);

      const result = anchorVerseClusters(segments, [mkCluster(5, 3, [['Word:the']])]);

      expect(result.groups[0].token.ref).toBe('GEN 1:1:0');
    });

    it('interleaves a mid-verse heading with the verse text around it', () => {
      const { segments } = makeVerseBook([
        { sid: 'PSA 1:1', text: 'blessed is the man' },
        { heading: 's1', verseId: 'PSA 1:1', text: 'Interlude', charIndex: 18 },
        { sid: 'PSA 1:1', text: 'who walks', charOffset: 19 },
      ]);

      const result = anchorVerseClusters(segments, [
        mkCluster(5, 7, [['Word:blessed']]),
        mkCluster(28, 9, [['Word:interlude']]),
        mkCluster(38, 3, [['Word:who']]),
      ]);

      expect(result.groups.map((g) => g.token.ref)).toEqual([
        'PSA 1:1:0',
        'PSA 1:1/s1:0',
        'PSA 1:1:19',
      ]);
    });

    it('anchors clusters filed under a verse 0 that holds only headings', () => {
      const segments = makeVerseBook([
        { heading: 's1', verseId: 'GEN 1:0', text: 'The Creation' },
        { sid: 'GEN 1:1', text: 'In the beginning.' },
      ]).segments.filter((segment) => segment.heading);

      const result = anchorVerseClusters(segments, [mkCluster(4, 8, [['Word:creation']])]);

      expect(result.groups[0].token.ref).toBe('GEN 1:0/s1:4');
    });

    it('anchors a heading cluster filed under a verse 0 superscription', () => {
      const { segments } = makeVerseBook([
        { sid: 'PSA 3:0', text: 'A psalm by David.' },
        { heading: 's1', verseId: 'PSA 3:0', text: 'David' },
      ]);

      const result = anchorVerseClusters(segments, [mkCluster(22, 5, [['Word:david']])]);

      expect(result.groups[0].token.ref).toBe('PSA 3:0/s1:0');
    });

    it('does not anchor a phrase across the edge of a heading', () => {
      const result = anchorVerseClusters(verseWithHeading(), [
        mkCluster(40, 30, [['Phrase:Father Thanksgiving']]),
      ]);

      expect(result.phrases).toEqual([]);
      expect(result.dropCounts.formMismatch).toBe(1);
    });
  });

  describe('front matter', () => {
    /**
     * The string PT9 indexes chapter 1's verse 0 against: the front matter, then the chapter's
     * opening.
     */
    const pt9Verse = '\\id GEN English \\ip the story of the creation \\c 1 \\s1 The Creation';
    const frontMatter = [
      { marker: 'id', text: 'English' },
      { marker: 'ip', text: 'the story of the creation' },
    ];

    /** Chapter 1's opening heading, filed with the front matter under GEN 1:0. */
    function openingHeading() {
      return makeVerseBook(
        [{ heading: 's1', verseId: 'GEN 1:0', text: 'The Creation' }],
        frontMatter,
      );
    }

    it('keeps clusters over the front matter off the chapter heading that shares their forms', () => {
      const book = openingHeading();

      const result = anchorVerseClusters(
        book.segments,
        [
          mkCluster(pt9Verse.indexOf('the story'), 3, [['Word:the', 'intro']]),
          mkCluster(pt9Verse.indexOf('creation'), 8, [['Word:creation', 'intro']]),
          mkCluster(pt9Verse.indexOf('The Creation'), 3, [['Word:the', 'heading']]),
          mkCluster(pt9Verse.indexOf('Creation'), 8, [['Word:creation', 'heading']]),
        ],
        book.frontMatter,
      );

      expect(result.groups.map((g) => [g.token.ref, g.word?.lexeme.senseId])).toEqual([
        ['GEN 1:0/s1:0', 'heading'],
        ['GEN 1:0/s1:4', 'heading'],
      ]);
      expect(result.dropCounts.frontMatter).toBe(2);
      expect(result.dropCounts.formMismatch).toBe(0);
    });

    it('counts a phrase over the front matter as a front-matter drop', () => {
      const book = openingHeading();

      const result = anchorVerseClusters(
        book.segments,
        [mkCluster(pt9Verse.indexOf('the story'), 9, [['Phrase:the story']])],
        book.frontMatter,
      );

      expect(result.phrases).toEqual([]);
      expect(result.dropCounts.frontMatter).toBe(1);
    });

    it('accounts for front matter filed alone, with no chapter opening', () => {
      const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'In the beginning.' }], frontMatter);

      const result = anchorVerseClusters(
        [],
        [mkCluster(pt9Verse.indexOf('story'), 5, [['Word:story']])],
        book.frontMatter,
      );

      expect(result.groups).toEqual([]);
      expect(result.dropCounts.frontMatter).toBe(1);
    });
  });
});
