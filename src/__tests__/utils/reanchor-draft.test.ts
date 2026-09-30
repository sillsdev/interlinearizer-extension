/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { reanchorDraftToBook } from '../../utils/reanchor-draft';
import { FIXTURE_STAMPS, makeVerseBook } from '../test-helpers';

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

    const reanchored = reanchorDraftToBook(verseBook)(content);

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

    const reanchored = reanchorDraftToBook(verseBook)(content);

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

    const reanchored = reanchorDraftToBook(verseBook)(content);

    expect(reanchored.analysis.segmentAnalysisLinks[0].segmentId).toBe('GEN 1:1:10');
  });

  it('returns the content itself when the book still reads as stored', () => {
    const verseBook = makeVerseBook([{ sid: 'GEN 1:1', text: 'alpha beta' }]);
    const analysis = glossedOn('alpha beta', 'beta', 'bêta');
    const segmentation = {
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
    };

    const reanchored = reanchorDraftToBook(verseBook)({ analysis, segmentation });

    expect(reanchored.analysis).toBe(analysis);
    expect(reanchored.segmentation).toBe(segmentation);
  });
});
