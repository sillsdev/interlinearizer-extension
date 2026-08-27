/// <reference types="jest" />

import type { Pt9InterlinearBook, Pt9InterlinearVerse } from 'platform-scripture';
import { buildLanguageBookAnalyses } from '../../../converters/pt9/languageAnalysisBuilder';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';
import { makeVerseBook } from '../../test-helpers';

/** Builds a one-lexeme word cluster the way the platform serves one. */
function wordCluster(index: number, length: number, form: string, senseId?: string) {
  return {
    index,
    length,
    excluded: false,
    lexemes: [{ lexemeId: `Word:${form}`, ...(senseId !== undefined && { senseId }) }],
  };
}

/** Builds a stem+suffix parse cluster. */
function parseCluster(index: number, length: number, stem: string, suffix: string) {
  return {
    index,
    length,
    excluded: false,
    lexemes: [{ lexemeId: `Stem:${stem}` }, { lexemeId: `Suffix:${suffix}` }],
  };
}

/** Wraps verses into a book of interlinear data. */
function interlinearOf(verses: Pt9InterlinearVerse[]): Pt9InterlinearBook {
  return {
    glossLanguage: 'en',
    bookId: 'GEN',
    verses,
    filePath: 'Interlinear_en/Interlinear_en_GEN.xml',
    isCanonicalPath: true,
  };
}

const LEXICON = {
  entries: [
    {
      id: 'Word:hello',
      type: 'Word',
      form: 'hello',
      homograph: 1,
      senses: [{ id: 'S1', glosses: [{ language: 'en', text: 'greeting' }] }],
    },
    {
      id: 'Suffix:ing',
      type: 'Suffix',
      form: 'ing',
      homograph: 1,
      senses: [{ id: 'S2', glosses: [{ language: 'en', text: 'PROG' }] }],
    },
  ],
  legacyAnalyses: [],
};

describe('buildLanguageBookAnalyses', () => {
  it('builds an approved word+parse record for a hashed verse and resolves glosses', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'hello world' }]);
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        {
          reference: 'GEN 1:1',
          approvedHash: 'ABCD1234',
          clusters: [wordCluster(0, 5, 'hello', 'S1'), parseCluster(0, 5, 'hell', 'o')],
          punctuations: [{ index: 0, length: 1, beforeText: ',' }],
        },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.records).toHaveLength(1);
    const record = build.records[0];
    expect(record.status).toBe('approved');
    expect(record.tag).toBe('en');
    expect(record.tokenRef).toBe('GEN 1:1:0');
    expect(record.tokenSurface).toBe('hello');
    expect(record.word).toStrictEqual({
      key: { Type: 'Word', Form: 'hello' },
      keyId: 'Word:hello',
      senseId: 'S1',
      glossText: 'greeting',
    });
    expect(record.parse?.signature).toBe('Stem:hell/Suffix:o');
    expect(record.parse?.lexemes.map((l) => l.keyId)).toStrictEqual(['Stem:hell', 'Suffix:o']);

    expect(build.bookReport).toStrictEqual({
      bookId: 'GEN',
      bookFound: true,
      versesTotal: 1,
      versesHashed: 1,
      versesNotFound: 0,
      clustersTotal: 2,
      clustersConverted: 2,
      phrasesConverted: 0,
      clusterDrops: {
        verseNotFound: 0,
        formMismatch: 0,
        lemmaOrOther: 0,
        duplicateCluster: 0,
        unparseableLexemeId: 0,
      },
      ambiguousAnchors: 0,
      punctuationEntriesIgnored: 1,
    });
    expect(senses.specificResolved).toBe(1);
    expect(senses.unresolvedGlossText).toBe(2);
  });

  it('marks records from an unhashed verse as suggested', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }]);
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        { reference: 'GEN 1:1', clusters: [wordCluster(0, 5, 'hello')], punctuations: [] },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.records[0].status).toBe('suggested');
    expect(build.records[0].word?.senseId).toBe('S1');
    expect(build.records[0].word?.glossText).toBe('greeting');
    expect(senses.defaultSingleResolved).toBe(1);
  });

  it('marks a record rejected only when every anchored facet is excluded', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'hello world' }]);
    const excludedWord = { ...wordCluster(0, 5, 'hello', 'S1'), excluded: true };
    const mixedParse = parseCluster(0, 5, 'hell', 'o');
    const excludedOnly = { ...wordCluster(6, 5, 'world', 'S9'), excluded: true };
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        {
          reference: 'GEN 1:1',
          approvedHash: 'ABCD1234',
          clusters: [excludedWord, mixedParse, excludedOnly],
          punctuations: [],
        },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.records.map((r) => r.status)).toStrictEqual(['approved', 'rejected']);
  });

  it('counts verses whose key has no segment and drops their clusters', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'hello' }]);
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        {
          reference: 'GEN 1:1',
          approvedHash: 'AA',
          clusters: [wordCluster(0, 5, 'hello', 'S1')],
          punctuations: [],
        },
        {
          reference: 'GEN 1:9',
          clusters: [wordCluster(0, 5, 'ghost')],
          punctuations: [{ index: 0, length: 1 }],
        },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.records).toHaveLength(1);
    expect(build.bookReport.versesTotal).toBe(2);
    expect(build.bookReport.versesNotFound).toBe(1);
    expect(build.bookReport.clusterDrops.verseNotFound).toBe(1);
    expect(build.bookReport.punctuationEntriesIgnored).toBe(1);
  });

  it('treats a missing book as every verse missing', () => {
    const { senses } = emptyPt9ImportReport();
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        {
          reference: 'GEN 1:1',
          approvedHash: 'AA',
          clusters: [wordCluster(0, 5, 'hello', 'S1')],
          punctuations: [],
        },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book: undefined,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.records).toHaveLength(0);
    expect(build.bookReport.bookFound).toBe(false);
    expect(build.bookReport.versesNotFound).toBe(1);
    expect(build.bookReport.versesHashed).toBe(1);
    expect(build.bookReport.clusterDrops.verseNotFound).toBe(1);
  });

  it('builds phrase records with the verse status and Excluded rejection', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'in the beginning in the' }]);
    const phrase = (index: number, excluded: boolean) => ({
      index,
      length: 6,
      excluded,
      lexemes: [{ lexemeId: 'Phrase:in the', senseId: 'S7' }],
    });
    const build = buildLanguageBookAnalyses({
      interlinear: interlinearOf([
        {
          reference: 'GEN 1:1',
          approvedHash: 'AA',
          clusters: [phrase(0, false), phrase(17, true)],
          punctuations: [],
        },
      ]),
      rawLanguage: 'en',
      bookId: 'GEN',
      tag: 'en',
      book,
      glossSource: createPt9GlossSource(LEXICON),
      senses,
    });

    expect(build.phrases).toHaveLength(2);
    expect(build.phrases[0].status).toBe('approved');
    expect(build.phrases[0].tokens.map((t) => t.surface)).toStrictEqual(['in', 'the']);
    expect(build.phrases[1].status).toBe('rejected');
    expect(build.bookReport.phrasesConverted).toBe(2);
  });
});
