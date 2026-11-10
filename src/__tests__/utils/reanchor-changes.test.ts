/// <reference types="jest" />

import type { Book, DraftProject, SegmentationDelta, TextAnalysis } from 'interlinearizer';
import type { BookPass } from '../../types/book-pass';
import type { DraftContent } from '../../types/draft-content';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  REANCHOR_INTENT,
  reanchorChangesForBook,
  reanchorDraftToBook,
} from '../../utils/reanchor-changes';
import { missingBook } from '../../utils/reanchor-analysis';
import { expectHostReanchor } from '../host-reanchor';
import { FIXTURE_STAMPS, makeTokenLink, makeVerseBook, tokenRefOf } from '../test-helpers';

beforeAll(() => {
  // The host's re-anchor is checked against a second run of each pass, which must stamp alike.
  jest.useFakeTimers({ now: new Date('2026-02-01T00:00:00.000Z') });
});

afterAll(() => {
  jest.useRealTimers();
});

/** A book of Genesis 1, one verse per text. */
function genesis(...verses: string[]): Book {
  return makeVerseBook(verses.map((text, index) => ({ sid: `GEN 1:${index + 1}`, text })));
}

/** An analysis glossing each of `words` where `book` has it. */
function glossing(book: Book, words: string[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: words.map((word) => ({
      ...FIXTURE_STAMPS,
      id: `ta-${word}`,
      surfaceText: word,
    })),
    tokenAnalysisLinks: words.map((word) =>
      makeTokenLink(`ta-${word}`, tokenRefOf(book, word), { surfaceText: word }),
    ),
  };
}

function draftOf(analysis: TextAnalysis, segmentation?: SegmentationDelta): DraftProject {
  return { ...emptyDraft('src'), analysis, ...(segmentation && { segmentation }) };
}

/** A split before "beta" in Genesis 1:1 reading `alpha beta`. */
function splitBeforeBeta(): SegmentationDelta {
  return {
    removedVerseStarts: [],
    addedStarts: [{ tokenRef: tokenRefOf(genesis('alpha beta'), 'beta'), surfaceText: 'beta' }],
  };
}

/** Runs `pass` over `content` for `bookCode`, checking that the host's re-anchor gives the same. */
function run(pass: BookPass<DraftContent>, bookCode: string, content: DraftContent): DraftContent {
  const reanchored = pass(content);
  expectHostReanchor(content, bookCode, pass, reanchored);
  return reanchored;
}

function toBook(verseBook: Book, content: DraftContent): DraftContent {
  return run(reanchorDraftToBook(verseBook), verseBook.bookRef, content);
}

/** An analysis approving `gloss` on the sole occurrence of `surfaceText` in a one-verse `text`. */
function glossedOn(text: string, surfaceText: string, gloss: string): TextAnalysis {
  const token = makeVerseBook([{ sid: 'GEN 1:1', text }]).segments[0].tokens.find(
    (t) => t.surfaceText === surfaceText,
  );
  if (!token) throw new Error('fixture missing token');
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText, gloss: { und: gloss } }],
    tokenAnalysisLinks: [
      {
        id: 'tl-1',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef: token.ref, surfaceText },
      },
    ],
  };
}

describe('reanchorDraftToBook', () => {
  it('re-points a gloss whose token the book shifted', () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'it was and unbelievable' }]);
    const content = {
      analysis: glossedOn('it was unbelievable', 'unbelievable', 'incroyable'),
      segmentation: undefined,
    };

    const reanchored = toBook(verseBook, content);

    const moved = verseBook.segments[0].tokens.find((t) => t.surfaceText === 'unbelievable');
    expect(reanchored.analysis.tokenAnalysisLinks[0].token.tokenRef).toBe(moved?.ref);
  });

  it('moves a stored split with the word it starts at', () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha and beta' }]);
    const content = {
      analysis: emptyAnalysis(),
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
      },
    };

    const reanchored = toBook(verseBook, content);

    expect(reanchored.segmentation?.addedStarts).toEqual([
      { tokenRef: 'GEN 1:1:10', surfaceText: 'beta' },
    ]);
  });

  it("moves a split piece's translation along with its split", () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha and beta' }]);
    const content = {
      analysis: {
        ...emptyAnalysis(),
        segmentAnalyses: [{ id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'beta' }],
        segmentAnalysisLinks: [
          {
            id: 'sl-1',
            analysisId: 'sa-1',
            ...FIXTURE_STAMPS,
            status: 'approved' as const,
            segmentId: 'GEN 1:1:6',
          },
        ],
      },
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
      },
    };

    const reanchored = toBook(verseBook, content);

    expect(reanchored.analysis.segmentAnalysisLinks[0].segmentId).toBe('GEN 1:1:10');
  });

  it('returns the content itself when the book still reads as stored', () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha beta' }]);
    const analysis = glossedOn('alpha beta', 'beta', 'bêta');
    const segmentation = {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
    };

    const reanchored = toBook(verseBook, { analysis, segmentation });

    expect(reanchored.analysis).toBe(analysis);
    expect(reanchored.segmentation).toBe(segmentation);
  });

  describe('to a book the text lacks', () => {
    it('stales an approval in the book', () => {
      const content = {
        analysis: glossedOn('alpha beta', 'beta', 'bêta'),
        segmentation: undefined,
      };

      const reanchored = toBook(missingBook('GEN'), content);

      expect(reanchored.analysis.tokenAnalysisLinks[0].status).toBe('stale');
    });

    it('stales a free translation in the book', () => {
      const content = {
        analysis: {
          ...emptyAnalysis(),
          segmentAnalyses: [{ ...FIXTURE_STAMPS, id: 'sa-1', surfaceText: 'alpha beta' }],
          segmentAnalysisLinks: [
            {
              id: 'sl-1',
              ...FIXTURE_STAMPS,
              analysisId: 'sa-1',
              status: 'approved' as const,
              segmentId: 'GEN 1:1',
            },
          ],
        },
        segmentation: undefined,
      };

      const reanchored = toBook(missingBook('GEN'), content);

      expect(reanchored.analysis.segmentAnalysisLinks[0].status).toBe('stale');
    });

    it('stales a free translation in a book outside the canon', () => {
      const content = {
        analysis: {
          ...emptyAnalysis(),
          segmentAnalyses: [{ ...FIXTURE_STAMPS, id: 'sa-1', surfaceText: 'alpha beta' }],
          segmentAnalysisLinks: [
            {
              id: 'sl-1',
              ...FIXTURE_STAMPS,
              analysisId: 'sa-1',
              status: 'approved' as const,
              segmentId: 'ZZZ front1:0',
            },
          ],
        },
        segmentation: undefined,
      };

      const reanchored = toBook(missingBook('ZZZ'), content);

      expect(reanchored.analysis.segmentAnalysisLinks[0].status).toBe('stale');
    });

    it("leaves another book's approvals approved", () => {
      const content = {
        analysis: glossedOn('alpha beta', 'beta', 'bêta'),
        segmentation: undefined,
      };

      const reanchored = toBook(missingBook('EXO'), content);

      expect(reanchored.analysis.tokenAnalysisLinks[0].status).toBe('approved');
    });
  });
});

describe('reanchorChangesForBook', () => {
  it('puts only the links the pass rewrote, named as a re-anchor', () => {
    const draft = draftOf(glossing(genesis('alpha beta', 'gamma'), ['beta', 'gamma']));

    const changes = reanchorChangesForBook(draft, genesis('new alpha beta', 'gamma'));

    expect(changes?.intent).toBe(REANCHOR_INTENT);
    expect(changes?.tokenAnalysisLinks?.puts.map(({ analysisId }) => analysisId)).toEqual([
      'ta-beta',
    ]);
    expect(changes?.tokenAnalysisLinks?.deletes).toEqual([]);
    expect(changes?.tokenAnalyses).toBeUndefined();
    expect(changes?.scope).toBeUndefined();
  });

  it("carries the draft's whole record with a split it moved", () => {
    const draft = {
      ...draftOf(emptyAnalysis(), splitBeforeBeta()),
      analysisLanguages: ['fr'],
      suggestedDescription: 'Named',
      dirty: true,
    };

    const scope = reanchorChangesForBook(draft, genesis('alpha and beta'))?.scope;

    expect(scope).toEqual(
      expect.objectContaining({
        analysisLanguages: ['fr'],
        suggestedDescription: 'Named',
        segmentation: {
          removedVerseStarts: [],
          addedStarts: [{ tokenRef: 'GEN 1:1:10', surfaceText: 'beta' }],
        },
      }),
    );
    expect(scope).not.toHaveProperty('analysis');
    expect(scope).not.toHaveProperty('dirty');
  });

  it('changes nothing when the book reads as the draft was written against', () => {
    const book = genesis('alpha beta');

    expect(
      reanchorChangesForBook(draftOf(glossing(book, ['beta']), splitBeforeBeta()), book),
    ).toBeUndefined();
  });

  it('puts the links into a book the text lacks as stale, named as a re-anchor', () => {
    const changes = reanchorChangesForBook(
      draftOf(glossing(genesis('alpha beta'), ['beta'])),
      missingBook('GEN'),
    );

    expect(changes?.intent).toBe(REANCHOR_INTENT);
    expect(changes?.tokenAnalysisLinks?.puts.map(({ status }) => status)).toEqual(['stale']);
  });

  it("changes nothing for another book's links when a book the text lacks is passed", () => {
    expect(
      reanchorChangesForBook(
        draftOf(glossing(genesis('alpha beta'), ['beta'])),
        missingBook('EXO'),
      ),
    ).toBeUndefined();
  });
});
