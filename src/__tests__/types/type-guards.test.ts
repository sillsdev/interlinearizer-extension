import { emptyAnalysis } from '../../types/empty-factories';
import { isPt9ImportProvenance, isPt9ImportReport, isTextAnalysis } from '../../types/type-guards';
import { toProjectSummary } from '../../types/interlinear-project-summary';
import { makeStubProject } from '../test-helpers';

/** Stands in for any id space: the boundary never checks which authority a ref names. */
const AUTHORITY = 'x-test';

/** Each morpheme ref field paired with the id field its ref kind requires. */
const MORPHEME_REFS = [
  ['entryRef', 'entryId'],
  ['senseRef', 'senseId'],
  ['allomorphRef', 'allomorphId'],
  ['grammarRef', 'msaId'],
] as const;

function analysisWithTokenFields(fields: object): unknown {
  return { ...emptyAnalysis(), tokenAnalyses: [{ id: 'ta-1', surfaceText: 'word', ...fields }] };
}

function analysisWithMorphemeFields(fields: object): unknown {
  return analysisWithTokenFields({
    morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und', ...fields }],
  });
}

function analysisWithPhraseFields(fields: object): unknown {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [{ id: 'pa-1', surfaceText: 'a phrase', ...fields }],
  };
}

describe('isTextAnalysis', () => {
  it.each(MORPHEME_REFS)('accepts a morpheme %s naming any authority', (field, idField) => {
    expect(
      isTextAnalysis(
        analysisWithMorphemeFields({ [field]: { authority: AUTHORITY, [idField]: 'id-1' } }),
      ),
    ).toBe(true);
  });

  it.each(MORPHEME_REFS)('rejects a morpheme %s that names no authority', (field, idField) => {
    expect(isTextAnalysis(analysisWithMorphemeFields({ [field]: { [idField]: 'id-1' } }))).toBe(
      false,
    );
  });

  it.each(MORPHEME_REFS)('rejects a morpheme %s that carries no id', (field) => {
    expect(isTextAnalysis(analysisWithMorphemeFields({ [field]: { authority: AUTHORITY } }))).toBe(
      false,
    );
  });

  it('accepts a token gloss sense reference naming any authority', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({ glossSenseRef: { authority: AUTHORITY, senseId: 's-1' } }),
      ),
    ).toBe(true);
  });

  it('rejects a token gloss sense reference that names no authority', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: { senseId: 's-1' } }))).toBe(
      false,
    );
  });

  it('accepts a phrase sense reference naming any authority', () => {
    expect(
      isTextAnalysis(
        analysisWithPhraseFields({ senseRef: { authority: AUTHORITY, senseId: 's-1' } }),
      ),
    ).toBe(true);
  });

  it('rejects a phrase sense reference that names no authority', () => {
    expect(isTextAnalysis(analysisWithPhraseFields({ senseRef: { senseId: 's-1' } }))).toBe(false);
  });

  it('rejects a reference whose authority is not a string', () => {
    expect(
      isTextAnalysis(analysisWithTokenFields({ glossSenseRef: { authority: 7, senseId: 's-1' } })),
    ).toBe(false);
  });

  it('accepts a reference carrying a projectId', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({
          glossSenseRef: { authority: AUTHORITY, projectId: 'dataset-1', senseId: 's-1' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a reference whose projectId is not a string', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({
          glossSenseRef: { authority: AUTHORITY, projectId: 7, senseId: 's-1' },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a reference that is not an object', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: 's-1' }))).toBe(false);
  });

  it('rejects a null reference', () => {
    // eslint-disable-next-line no-null/no-null -- stored JSON can carry null where a ref is expected
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: null }))).toBe(false);
  });
});

const PROVENANCE = {
  fileHashes: { 'Lexicon.xml': 'aaaa1111' },
  importedAt: '2026-08-01T00:00:00.000Z',
};

/** A minimal report with one language and one book, valid unless a test breaks a piece of it. */
function makeReport() {
  return {
    languages: [
      {
        rawLanguage: 'en',
        tag: 'en',
        tagIsFallback: false,
        books: [
          {
            bookId: 'MAT',
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
            punctuationEntriesIgnored: 0,
          },
        ],
      },
    ],
    merge: {
      mergedTokenRecords: 0,
      parseConflicts: 0,
      approvedDemotedToCandidate: 0,
      sameTagCollisions: [],
    },
    senses: {
      specificResolved: 0,
      defaultSingleResolved: 0,
      unresolvedGlossText: 0,
      entryRefsResolved: 0,
      entryRefsUnresolved: 0,
      senseRefsResolved: 0,
      senseRefsUnresolved: 0,
    },
    barePayloads: { added: 0, skippedExistingIdentical: 0, droppedUnparseable: 0, droppedEmpty: 0 },
  };
}

describe('isPt9ImportProvenance', () => {
  it('accepts hashes keyed by path with an import timestamp', () => {
    expect(isPt9ImportProvenance(PROVENANCE)).toBe(true);
  });

  it('rejects a missing importedAt', () => {
    expect(isPt9ImportProvenance({ fileHashes: {} })).toBe(false);
  });

  it('rejects a non-string hash value', () => {
    expect(isPt9ImportProvenance({ fileHashes: { 'Lexicon.xml': 5 }, importedAt: 'now' })).toBe(
      false,
    );
  });

  it('rejects a non-object', () => {
    expect(isPt9ImportProvenance('pt9')).toBe(false);
  });
});

describe('isPt9ImportReport', () => {
  it('accepts a conversion report', () => {
    expect(isPt9ImportReport(makeReport())).toBe(true);
  });

  it('rejects a non-object and a missing aggregate section', () => {
    expect(isPt9ImportReport(undefined)).toBe(false);
    expect(isPt9ImportReport({ ...makeReport(), merge: undefined })).toBe(false);
  });

  it('rejects a language without a tag', () => {
    const report = makeReport();
    expect(isPt9ImportReport({ ...report, languages: [{ books: [] }] })).toBe(false);
  });

  it('rejects a book with a non-number count', () => {
    const broken = makeReport();
    const book: Record<string, unknown> = { ...broken.languages[0].books[0] };
    book.clustersTotal = 'two';
    expect(
      isPt9ImportReport({ ...broken, languages: [{ ...broken.languages[0], books: [book] }] }),
    ).toBe(false);
  });

  it('rejects a book with a non-number drop count', () => {
    const report = makeReport();
    const book: Record<string, unknown> = {
      ...report.languages[0].books[0],
      clusterDrops: { verseNotFound: 'many' },
    };
    expect(
      isPt9ImportReport({ ...report, languages: [{ ...report.languages[0], books: [book] }] }),
    ).toBe(false);
  });
});

describe('toProjectSummary', () => {
  it('carries pt9Import through and drops fields outside the summary', () => {
    const summary = toProjectSummary({ ...makeStubProject('import-id'), pt9Import: PROVENANCE });
    expect(summary.pt9Import).toStrictEqual(PROVENANCE);
  });

  it('omits pt9Import when the input has none', () => {
    expect(toProjectSummary(makeStubProject('plain-id'))).not.toHaveProperty('pt9Import');
  });
});
