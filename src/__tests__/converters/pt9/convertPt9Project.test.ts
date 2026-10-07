/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  Pt9InterlinearBook,
  Pt9InterlinearProjectData,
  Pt9InterlinearVerse,
  Pt9Lexicon,
  Pt9LexiconEntry,
} from 'platform-scripture';
import { convertPt9Project } from '../../../converters/pt9';
import type { Pt9LexiconResolver } from '../../../converters/pt9';
import { makeVerseBook } from '../../test-helpers';
import { mkCluster } from './test-helpers';

const STAMP = '2026-08-01T00:00:00.000Z';

/** Wraps books of interlinear data into a project payload with otherwise-empty inventories. */
function dataOf(
  books: Pt9InterlinearBook[],
  rest: Omit<Partial<Pt9InterlinearProjectData>, 'books'> = {},
): Pt9InterlinearProjectData {
  return { setups: [], books, wordAnalyses: [], hasAssociatedLexicalProject: false, ...rest };
}

/** A one-verse book of interlinear data with a single word cluster, at its canonical path. */
function bookWith(
  language: string,
  bookId: string,
  form: string,
  senseId?: string,
  hash?: string,
): Pt9InterlinearBook {
  return {
    glossLanguage: language,
    bookId,
    filePath: `Interlinear_${language}/Interlinear_${language}_${bookId}.xml`,
    isCanonicalPath: true,
    verses: [
      {
        reference: `${bookId} 1:1`,
        ...(hash !== undefined && { approvedHash: hash }),
        clusters: [mkCluster(0, form.length, [[`Word:${form}`, senseId]])],
        punctuations: [],
      },
    ],
  };
}

/** A one-sense lexicon entry carrying the given gloss text per language. */
function entryOf(
  type: string,
  form: string,
  senseId: string,
  glosses: Record<string, string>,
): Pt9LexiconEntry {
  return {
    id: `${type}:${form}`,
    type,
    form,
    homograph: 1,
    senses: [
      {
        id: senseId,
        glosses: Object.entries(glosses).map(([language, text]) => ({ language, text })),
      },
    ],
  };
}

/** Glosses the words and the `in the` phrase in both languages, the `hel`+`lo` parse in fr only. */
const LEXICON: Pt9Lexicon = {
  entries: [
    entryOf('Word', 'hello', 'S1', { en: 'hello', fr: 'salut' }),
    entryOf('Word', 'world', 'S2', { en: 'world', fr: 'monde' }),
    entryOf('Word', 'in', 'S3', { en: 'in', fr: 'dans' }),
    entryOf('Word', 'the', 'S4', { en: 'the', fr: 'le' }),
    entryOf('Phrase', 'in the', 'S5', { en: 'within', fr: 'dans le' }),
    entryOf('Stem', 'hel', 'S6', { fr: 'sal' }),
    entryOf('Suffix', 'lo', 'S7', { fr: 'ut' }),
  ],
  legacyAnalyses: [],
};

/**
 * A GEN 1:1 book of interlinear data in one language with the given clusters, hashed unless not
 * `approved`.
 */
function verseOf(
  language: string,
  clusters: Pt9InterlinearVerse['clusters'],
  approved = true,
): Pt9InterlinearBook {
  return {
    ...bookWith(language, 'GEN', 'hello'),
    verses: [
      {
        reference: 'GEN 1:1',
        ...(approved && { approvedHash: 'AA' }),
        clusters,
        punctuations: [],
      },
    ],
  };
}

/** The analysis languages of an import of `books` against GEN 1:1 reading `text`. */
function languagesOf(text: string, books: Pt9InterlinearBook[]): string[] {
  return convertPt9Project({
    data: dataOf(books, { lexicon: LEXICON }),
    books: [makeVerseBook([{ sid: 'GEN 1:1', text }])],
    importedAt: STAMP,
  }).analysisLanguages;
}

describe('convertPt9Project', () => {
  it('keeps the canonical-path book when a merge-residue twin shares its identity', () => {
    const residue = {
      ...bookWith('en', 'GEN', 'ghost', 'S9', 'AA'),
      filePath: 'Interlinear_en_GEN.xml',
      isCanonicalPath: false,
    };
    const result = convertPt9Project({
      data: dataOf([residue, bookWith('en', 'GEN', 'hello', 'S1', 'AA')]),
      books: [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])],
      importedAt: STAMP,
    });

    expect(result.report.booksDroppedAsDuplicates).toBe(1);
    expect(result.analysis.tokenAnalyses).toHaveLength(1);
    expect(result.analysis.tokenAnalyses[0].surfaceText).toBe('hello');
  });

  it('keeps the first book when duplicates share an identity and none is canonical', () => {
    const first = {
      ...bookWith('en', 'GEN', 'hello', 'S1', 'AA'),
      isCanonicalPath: false,
    };
    const second = {
      ...bookWith('en', 'GEN', 'ghost', 'S9', 'AA'),
      filePath: 'Interlinear_en_GEN.xml',
      isCanonicalPath: false,
    };
    const result = convertPt9Project({
      data: dataOf([first, second]),
      books: [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])],
      importedAt: STAMP,
    });

    expect(result.report.booksDroppedAsDuplicates).toBe(1);
    expect(result.analysis.tokenAnalyses[0].surfaceText).toBe('hello');
  });

  it('merges languages across books and reports a same-tag collision', () => {
    const books = [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])];
    const result = convertPt9Project({
      data: dataOf([
        bookWith('EN', 'GEN', 'hello', 'S1', 'AA'),
        bookWith('en', 'GEN', 'hello', 'S1', 'BB'),
      ]),
      books,
      importedAt: STAMP,
    });

    expect(result.analysisLanguages).toStrictEqual(['en']);
    expect(result.report.merge.sameTagCollisions).toStrictEqual([['EN', 'en']]);
    expect(result.report.languages.map((l) => l.rawLanguage)).toStrictEqual(['EN', 'en']);
    expect(result.analysis.tokenAnalyses).toHaveLength(1);
    expect(result.analysis.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('leads with the tag glossing the most tokens, not the first-listed one', () => {
    const languages = languagesOf('hello world', [
      verseOf('en', [mkCluster(0, 5, [['Word:hello', 'S1']])]),
      verseOf('fr', [mkCluster(0, 5, [['Word:hello', 'S1']]), mkCluster(6, 5, [['Word:world']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('puts a tag whose books converted nothing after one that glossed', () => {
    const languages = languagesOf('hello', [
      bookWith('en', 'EXO', 'hello', 'S1'),
      bookWith('fr', 'GEN', 'hello', 'S1'),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('does not count tokens whose gloss text is unresolved', () => {
    const languages = languagesOf('hello in the world', [
      verseOf('en', [
        mkCluster(0, 5, [['Word:hello', 'S9']]),
        mkCluster(6, 6, [['Phrase:in the', 'S9']]),
      ]),
      verseOf('fr', [mkCluster(13, 5, [['Word:world']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('does not count rejected analyses', () => {
    const languages = languagesOf('hello in the world', [
      verseOf('en', [
        mkCluster(0, 5, [['Word:hello', 'S1']], true),
        mkCluster(6, 6, [['Phrase:in the', 'S5']], true),
      ]),
      verseOf('fr', [mkCluster(13, 5, [['Word:world']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it("does not count a rejected gloss merged into another language's analysis", () => {
    const languages = languagesOf('hello', [
      verseOf('en', [mkCluster(0, 5, [['Word:hello', 'S1']], true)], false),
      verseOf('fr', [mkCluster(0, 5, [['Word:hello', 'S1']])], false),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('counts a token whose parse has a glossed morpheme', () => {
    const languages = languagesOf('hello', [
      verseOf('en', [mkCluster(0, 5, [['Stem:hel'], ['Suffix:lo']])]),
      verseOf('fr', [mkCluster(0, 5, [['Stem:hel'], ['Suffix:lo']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('counts the tokens under a glossed phrase', () => {
    const languages = languagesOf('hello in the', [
      verseOf('en', [mkCluster(0, 5, [['Word:hello']])]),
      verseOf('fr', [mkCluster(6, 6, [['Phrase:in the']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('counts a token glossed by both a word and a phrase once', () => {
    // en glosses two tokens; counting in twice would tie fr at three and keep en first.
    const languages = languagesOf('hello in the', [
      verseOf('en', [mkCluster(6, 2, [['Word:in']]), mkCluster(6, 6, [['Phrase:in the']])]),
      verseOf('fr', [
        mkCluster(0, 5, [['Word:hello']]),
        mkCluster(6, 2, [['Word:in']]),
        mkCluster(9, 3, [['Word:the']]),
      ]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en']);
  });

  it('leads with the tag approved on the most tokens over one glossing more unapproved', () => {
    const languages = languagesOf('hello in the world', [
      verseOf(
        'fr',
        [
          mkCluster(0, 5, [['Word:hello']]),
          mkCluster(6, 2, [['Word:in']]),
          mkCluster(9, 3, [['Word:the']]),
        ],
        false,
      ),
      verseOf('en', [mkCluster(13, 5, [['Word:world']])]),
    ]);

    expect(languages).toStrictEqual(['en', 'fr']);
  });

  it('does not count an approval the cross-language merge withdraws', () => {
    // de's unapproved verse withdraws en's approval of hello and in; de itself glosses nothing.
    const languages = languagesOf('hello in the world', [
      verseOf('en', [mkCluster(0, 5, [['Word:hello']]), mkCluster(6, 2, [['Word:in']])]),
      verseOf('de', [mkCluster(0, 5, [['Word:hello']]), mkCluster(6, 2, [['Word:in']])], false),
      verseOf('fr', [mkCluster(13, 5, [['Word:world']])]),
    ]);

    expect(languages).toStrictEqual(['fr', 'en', 'de']);
  });

  it('keeps tied tags in discovery order and merges records across them', () => {
    const books = [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])];
    const result = convertPt9Project({
      data: dataOf([
        bookWith('fr', 'GEN', 'hello', 'S1', 'AA'),
        bookWith('en', 'GEN', 'hello', 'S1'),
      ]),
      books,
      importedAt: STAMP,
    });

    expect(result.analysisLanguages).toStrictEqual(['fr', 'en']);
    expect(result.report.merge.sameTagCollisions).toStrictEqual([]);
    expect(result.analysis.tokenAnalyses).toHaveLength(1);
    // fr's verse is hashed, en's is not: strict all-hashed merging yields suggested.
    expect(result.analysis.tokenAnalysisLinks[0].status).toBe('suggested');
    expect(result.report.merge.mergedTokenRecords).toBe(1);
  });

  it('shares one payload between tokens analyzed identically', () => {
    const book = bookWith('en', 'GEN', 'hello', 'S1', 'AA');
    const result = convertPt9Project({
      data: dataOf([
        { ...book, verses: [...book.verses, { ...book.verses[0], reference: 'GEN 1:2' }] },
      ]),
      books: [
        makeVerseBook([
          { sid: 'GEN 1:1', text: 'hello' },
          { sid: 'GEN 1:2', text: 'hello' },
        ]),
      ],
      importedAt: STAMP,
    });

    const [analysis] = result.analysis.tokenAnalyses;
    expect(result.analysis.tokenAnalyses).toHaveLength(1);
    expect(result.analysis.tokenAnalysisLinks.map((l) => l.analysisId)).toStrictEqual([
      analysis.id,
      analysis.id,
    ]);
    expect(result.report.merge.identicalPayloadsMerged).toBe(1);
  });

  it('reports a missing book without records', () => {
    const result = convertPt9Project({
      data: dataOf([bookWith('en', 'EXO', 'hello', 'S1')]),
      books: [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])],
      importedAt: STAMP,
    });

    expect(result.report.languages[0].books[0].bookFound).toBe(false);
    expect(result.analysis.tokenAnalyses).toHaveLength(0);
  });

  it('counts and drops a book of interlinear data missing its language or book id', () => {
    const result = convertPt9Project({
      data: dataOf([
        { bookId: 'GEN', verses: [], filePath: 'Interlinear_x.xml', isCanonicalPath: false },
        { glossLanguage: 'en', verses: [], filePath: 'Interlinear_y.xml', isCanonicalPath: false },
        bookWith('en', 'GEN', 'hello', 'S1'),
      ]),
      books: [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])],
      importedAt: STAMP,
    });

    expect(result.report.booksMissingIdentity).toBe(2);
    expect(result.report.languages.map((l) => l.rawLanguage)).toStrictEqual(['en']);
    expect(result.analysis.tokenAnalyses).toHaveLength(1);
  });

  it('resolves refs through a provided resolver', () => {
    const resolver: Pt9LexiconResolver = {
      resolveEntry: () => undefined,
      resolveSense: (key, senseId) => ({ authority: 'test', senseId: `${key.Form}#${senseId}` }),
    };
    const result = convertPt9Project({
      data: dataOf([bookWith('en', 'GEN', 'hello', 'S1', 'AA')]),
      books: [makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }])],
      resolver,
      importedAt: STAMP,
    });

    expect(result.analysis.tokenAnalyses[0].glossSenseRef).toStrictEqual({
      authority: 'test',
      senseId: 'hello#S1',
    });
    expect(result.report.senses.senseRefsResolved).toBe(1);
  });

  it('falls back to the und writing system for bare payloads when no book has a word token', () => {
    const result = convertPt9Project({
      data: dataOf([bookWith('en', 'GEN', 'hello')], {
        wordAnalyses: [{ word: 'x', analyses: [['Stem:x']] }],
      }),
      books: [],
      importedAt: STAMP,
    });

    expect(result.analysis.tokenAnalyses[0].morphemes?.[0].writingSystem).toBe('und');
  });

  describe('against the coherent test-data fixture', () => {
    const data: Pt9InterlinearProjectData = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'test-data', 'Pt9InterlinearProjectData.json'),
        'utf-8',
      ),
    );
    const books = [
      makeVerseBook([
        { sid: 'MAT 1:1', text: 'hello aokaybe abe abc this is a footnote with a note تمان oj' },
        { sid: 'MAT 1:2', text: 'oooo dearly' },
        { sid: 'MAT 1:9', text: 'hello' },
      ]),
    ];
    const result = convertPt9Project({ data, books, importedAt: STAMP });

    it('identifies the language', () => {
      expect(result.analysisLanguages).toStrictEqual(['en']);
    });

    it('converts the covered verses and drops the rest as verse-not-found', () => {
      const [language] = result.report.languages;
      expect(language.tag).toBe('en');
      expect(language.tagIsFallback).toBe(false);
      const [book] = language.books;
      expect(book.bookId).toBe('MAT');
      expect(book.bookFound).toBe(true);
      expect(book.versesTotal).toBe(36);
      expect(book.versesHashed).toBe(6);
      expect(book.versesNotFound).toBe(33);
      expect(book.clustersTotal).toBe(61);
      expect(book.clustersConverted).toBe(24);
      expect(book.clusterDrops).toStrictEqual({
        verseNotFound: 37,
        formMismatch: 0,
        frontMatter: 0,
        lemmaOrOther: 0,
        duplicateCluster: 0,
        unparseableLexemeId: 0,
      });
      expect(book.ambiguousAnchors).toBe(1);
      expect(book.punctuationEntriesIgnored).toBe(1);
      expect(book.phrasesConverted).toBe(0);
    });

    it('merges the hello word and parse pair with lexicon glosses, approved', () => {
      const link = result.analysis.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'MAT 1:1:0');
      expect(link?.status).toBe('approved');
      const analysis = result.analysis.tokenAnalyses.find((a) => a.id === link?.analysisId);
      expect(analysis?.surfaceText).toBe('hello');
      expect(analysis?.gloss).toStrictEqual({ en: 'greeting' });
      expect(analysis?.morphemes).toStrictEqual([
        { id: 'm0', form: 'hello', writingSystem: 'en', gloss: { en: 'greet' } },
        { id: 'm1', form: 'ing', writingSystem: 'en', gloss: { en: 'PROG' } },
      ]);
    });

    it('imports a dangling sense selection without gloss text', () => {
      const link = result.analysis.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'MAT 1:9:0');
      expect(link?.status).toBe('approved');
      const analysis = result.analysis.tokenAnalyses.find((a) => a.id === link?.analysisId);
      expect(analysis?.gloss).toBeUndefined();
    });

    it('marks the proportionally disambiguated token low confidence', () => {
      const ambiguousLinks = result.analysis.tokenAnalysisLinks.filter(
        (l) => l.confidence === 'low',
      );
      expect(ambiguousLinks).toHaveLength(1);
      expect(ambiguousLinks[0].token.surfaceText).toBe('a');
    });

    it('adds bare payloads for unconverted analyses and skips the cluster-identical one', () => {
      const bare = result.analysis.tokenAnalyses.filter(
        (a) => a.producer === 'pt9-import:word-analyses',
      );
      expect(bare.map((a) => a.surfaceText).sort()).toStrictEqual(['aaaa', 'abe', 'helloing']);
      expect(result.report.barePayloads.added).toBe(3);
      expect(result.report.barePayloads.skippedExistingIdentical).toBe(1);

      const helloing = bare.find((a) => a.surfaceText === 'helloing');
      expect(helloing?.morphemes?.map((m) => m.gloss)).toStrictEqual([
        { en: 'greet' },
        { en: 'PROG' },
      ]);
    });

    it('emits fifteen linked token records and no phrases or segment analyses', () => {
      expect(result.analysis.tokenAnalysisLinks).toHaveLength(15);
      expect(result.analysis.phraseAnalyses).toStrictEqual([]);
      expect(result.analysis.segmentAnalyses).toStrictEqual([]);
      expect(result.analysis.tokenAnalyses).toHaveLength(17);
    });

    it('folds the two identically analyzed a tokens onto one payload', () => {
      const ids = result.analysis.tokenAnalysisLinks
        .filter((l) => l.token.surfaceText === 'a')
        .map((l) => l.analysisId);
      expect(ids).toStrictEqual(['pt9:ta:MAT 1:1:30:0', 'pt9:ta:MAT 1:1:30:0']);
      expect(result.report.merge.identicalPayloadsMerged).toBe(1);
    });
  });
});
