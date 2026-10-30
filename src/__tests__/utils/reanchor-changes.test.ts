/// <reference types="jest" />

import type { Book, DraftProject, SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { REANCHOR_INTENT, reanchorChangesForBook } from '../../utils/reanchor-changes';
import { missingBook } from '../../utils/reanchor-analysis';
import { FIXTURE_STAMPS, makeTokenLink, makeVerseBook, tokenRefOf } from '../test-helpers';

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
      suggestedName: 'Named',
      dirty: true,
    };

    const scope = reanchorChangesForBook(draft, genesis('alpha and beta'))?.scope;

    expect(scope).toEqual(
      expect.objectContaining({
        analysisLanguages: ['fr'],
        suggestedName: 'Named',
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
