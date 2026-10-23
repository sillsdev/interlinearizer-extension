/// <reference types="jest" />

import type { Book, DraftProject, SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  REANCHOR_INTENT,
  reanchorChangesForBook,
  reanchorChangesForMissingBook,
} from '../../utils/reanchor-changes';
import { FIXTURE_STAMPS, makeTokenLink, makeVerseBook } from '../test-helpers';

// The cases of `reanchor-analysis.test.ts` and `reanchor-draft.test.ts` check these changes against
// the WebView's passes; these check what the changes carry.

/** A book of Genesis 1, one verse per text. */
function genesis(...verses: string[]): Book {
  return makeVerseBook(verses.map((text, index) => ({ sid: `GEN 1:${index + 1}`, text })));
}

/** The ref of the first token of `book` reading `surfaceText`. */
function refOf(book: Book, surfaceText: string): string {
  const token = book.segments.flatMap((s) => s.tokens).find((t) => t.surfaceText === surfaceText);
  if (!token) throw new Error(`fixture missing token ${surfaceText}`);
  return token.ref;
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
      makeTokenLink(`ta-${word}`, refOf(book, word), { surfaceText: word }),
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
    addedStarts: [{ tokenRef: refOf(genesis('alpha beta'), 'beta'), surfaceText: 'beta' }],
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
});

describe('reanchorChangesForMissingBook', () => {
  it('puts the links it stales, named as a re-anchor', () => {
    const changes = reanchorChangesForMissingBook(
      draftOf(glossing(genesis('alpha beta'), ['beta'])),
      'GEN',
    );

    expect(changes?.intent).toBe(REANCHOR_INTENT);
    expect(changes?.tokenAnalysisLinks?.puts.map(({ status }) => status)).toEqual(['stale']);
  });

  it("changes nothing for another book's links", () => {
    expect(
      reanchorChangesForMissingBook(draftOf(glossing(genesis('alpha beta'), ['beta'])), 'EXO'),
    ).toBeUndefined();
  });
});
