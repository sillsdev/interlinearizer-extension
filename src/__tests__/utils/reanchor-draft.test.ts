/// <reference types="jest" />

import type { Book, TextAnalysis } from 'interlinearizer';
import type { DraftContent } from '../../hooks/useDraftProject';
import { emptyAnalysis } from '../../types/empty-factories';
import { reanchorDraftToBook, reanchorDraftToMissingBook } from '../../utils/reanchor-draft';
import type { BookPass } from '../../utils/undo-history';
import { expectHostReanchorParity } from '../host-reanchor-parity';
import { FIXTURE_STAMPS, makeVerseBook } from '../test-helpers';

beforeAll(() => {
  // The host's re-anchor is checked against a second run of each pass, which must stamp alike.
  jest.useFakeTimers({ now: new Date('2026-02-01T00:00:00.000Z') });
});

afterAll(() => {
  jest.useRealTimers();
});

/** Runs `pass` over `content` for `bookCode`, checking that the host's re-anchor gives the same. */
function run(pass: BookPass<DraftContent>, bookCode: string, content: DraftContent): DraftContent {
  const reanchored = pass(content);
  expectHostReanchorParity(content, bookCode, pass, reanchored);
  return reanchored;
}

function toBook(verseBook: Book, content: DraftContent): DraftContent {
  return run(reanchorDraftToBook(verseBook), verseBook.bookRef, content);
}

function toMissingBook(bookCode: string, content: DraftContent): DraftContent {
  return run(reanchorDraftToMissingBook(bookCode), bookCode, content);
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
});

describe('reanchorDraftToMissingBook', () => {
  it('stales an approval in the book', () => {
    const content = { analysis: glossedOn('alpha beta', 'beta', 'bêta'), segmentation: undefined };

    const reanchored = toMissingBook('GEN', content);

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

    const reanchored = toMissingBook('GEN', content);

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

    const reanchored = toMissingBook('ZZZ', content);

    expect(reanchored.analysis.segmentAnalysisLinks[0].status).toBe('stale');
  });

  it("leaves another book's approvals approved", () => {
    const content = { analysis: glossedOn('alpha beta', 'beta', 'bêta'), segmentation: undefined };

    const reanchored = toMissingBook('EXO', content);

    expect(reanchored.analysis.tokenAnalysisLinks[0].status).toBe('approved');
  });
});
