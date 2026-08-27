/// <reference types="jest" />

import { isPt9ImportReport } from '../../../converters/pt9';

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
