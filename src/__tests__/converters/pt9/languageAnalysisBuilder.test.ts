/// <reference types="jest" />

import type { InterlinearData, VerseData } from 'parsers/pt9/interlinearXmlParser';
import { buildLanguageBookAnalyses } from '../../../converters/pt9/languageAnalysisBuilder';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';
import { makeVerseBook } from '../../test-helpers';

/** Builds a one-lexeme word cluster the way the parser shapes one. */
function wordCluster(index: number, length: number, form: string, senseId?: string) {
  const id = `Word:${form}`;
  return {
    TextRange: { Index: index, Length: length },
    Lexemes: [{ LexemeId: id, ...(senseId !== undefined && { SenseId: senseId }) }],
    LexemesId: id,
    Id: `${id}/${index}-${length}`,
    Excluded: false,
  };
}

/** Builds a stem+suffix parse cluster. */
function parseCluster(index: number, length: number, stem: string, suffix: string) {
  const lexemesId = `Stem:${stem}/Suffix:${suffix}`;
  return {
    TextRange: { Index: index, Length: length },
    Lexemes: [{ LexemeId: `Stem:${stem}` }, { LexemeId: `Suffix:${suffix}` }],
    LexemesId: lexemesId,
    Id: `${lexemesId}/${index}-${length}`,
    Excluded: false,
  };
}

/** Wraps verses into an InterlinearData literal. */
function fileOf(verses: Record<string, VerseData>, language = 'en'): InterlinearData {
  return { GlossLanguage: language, BookId: 'GEN', Verses: verses };
}

const LEXICON = {
  Entries: [
    {
      Key: { Type: 'Word', Form: 'hello' },
      Senses: [{ Id: 'S1', Glosses: [{ Language: 'en', Text: 'greeting' }] }],
    },
    {
      Key: { Type: 'Suffix', Form: 'ing' },
      Senses: [{ Id: 'S2', Glosses: [{ Language: 'en', Text: 'PROG' }] }],
    },
  ],
  Analyses: {},
};

describe('buildLanguageBookAnalyses', () => {
  it('builds an approved word+parse record for a hashed verse and resolves glosses', () => {
    const { senses } = emptyPt9ImportReport();
    const book = makeVerseBook([{ sid: 'GEN 1:1', text: 'hello world' }]);
    const build = buildLanguageBookAnalyses({
      file: fileOf({
        'GEN 1:1': {
          Hash: 'ABCD1234',
          Clusters: [wordCluster(0, 5, 'hello', 'S1'), parseCluster(0, 5, 'hell', 'o')],
          Punctuations: [{ TextRange: { Index: 0, Length: 1 }, BeforeText: ',', AfterText: '' }],
        },
      }),
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
      file: fileOf({
        'GEN 1:1': { Clusters: [wordCluster(0, 5, 'hello')], Punctuations: [] },
      }),
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
    const excludedWord = { ...wordCluster(0, 5, 'hello', 'S1'), Excluded: true };
    const mixedParse = parseCluster(0, 5, 'hell', 'o');
    const excludedOnly = { ...wordCluster(6, 5, 'world', 'S9'), Excluded: true };
    const build = buildLanguageBookAnalyses({
      file: fileOf({
        'GEN 1:1': {
          Hash: 'ABCD1234',
          Clusters: [excludedWord, mixedParse, excludedOnly],
          Punctuations: [],
        },
      }),
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
      file: fileOf({
        'GEN 1:1': { Hash: 'AA', Clusters: [wordCluster(0, 5, 'hello', 'S1')], Punctuations: [] },
        'GEN 1:9': {
          Clusters: [wordCluster(0, 5, 'ghost')],
          Punctuations: [{ TextRange: { Index: 0, Length: 1 }, BeforeText: '', AfterText: '' }],
        },
      }),
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
      file: fileOf({
        'GEN 1:1': { Hash: 'AA', Clusters: [wordCluster(0, 5, 'hello', 'S1')], Punctuations: [] },
      }),
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
      TextRange: { Index: index, Length: 6 },
      Lexemes: [{ LexemeId: 'Phrase:in the', SenseId: 'S7' }],
      LexemesId: 'Phrase:in the',
      Id: `Phrase:in the/${index}-6`,
      Excluded: excluded,
    });
    const build = buildLanguageBookAnalyses({
      file: fileOf({
        'GEN 1:1': { Hash: 'AA', Clusters: [phrase(0, false), phrase(17, true)], Punctuations: [] },
      }),
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
