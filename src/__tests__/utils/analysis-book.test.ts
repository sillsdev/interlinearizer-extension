/// <reference types="jest" />

import type {
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import {
  BOOKLESS_PARTITION,
  bookOfRef,
  dropCrossBookPhrases,
  phraseSpansBooks,
  removeBookFromAnalysis,
  removeBookFromSegmentation,
  splitAnalysisByBook,
} from '../../utils/analysis-book';
import { makePhraseLink, FIXTURE_STAMPS } from '../test-helpers';

/**
 * Creates a minimal {@link TokenAnalysis} payload record fixture, with `surfaceText` defaulting to
 * `id`.
 */
function mkTokenAnalysis(id: string, surfaceText = id): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText };
}

/** Creates a {@link TokenAnalysisLink} joining a token ref to an analysis id. */
function mkTokenLink(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: tokenRef },
  };
}

/**
 * Creates a minimal {@link SegmentAnalysis} payload record fixture, with `surfaceText` defaulting to
 * `id`.
 */
function mkSegmentAnalysis(id: string, surfaceText = id): SegmentAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText };
}

/** Creates a {@link SegmentAnalysisLink} joining a segment id to an analysis id. */
function mkSegmentLink(analysisId: string, segmentId: string): SegmentAnalysisLink {
  return { ...FIXTURE_STAMPS, analysisId, status: 'approved', segmentId };
}

describe('bookOfRef', () => {
  it('extracts the book code from a token ref with a char offset', () => {
    expect(bookOfRef('GEN 1:1:0')).toBe('GEN');
  });

  it('extracts the book code from a verse-level segment id', () => {
    expect(bookOfRef('GEN 1:1')).toBe('GEN');
  });

  it('extracts a numeric-prefixed book code', () => {
    expect(bookOfRef('1JN 2:3:5')).toBe('1JN');
  });

  it('returns the whole string when it contains no space', () => {
    expect(bookOfRef('GEN')).toBe('GEN');
  });
});

describe('splitAnalysisByBook', () => {
  it('gives each book only its own records', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('ta-gen'), mkTokenAnalysis('ta-exo')],
      tokenAnalysisLinks: [mkTokenLink('ta-gen', 'GEN 1:1'), mkTokenLink('ta-exo', 'EXO 1:1')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect([...byBook.keys()].sort()).toEqual(['EXO', 'GEN']);
    expect(byBook.get('GEN')?.tokenAnalyses).toEqual([mkTokenAnalysis('ta-gen')]);
    expect(byBook.get('EXO')?.tokenAnalyses).toEqual([mkTokenAnalysis('ta-exo')]);
  });

  it("partitions a segment analysis by its segment's book", () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      segmentAnalyses: [mkSegmentAnalysis('sa-1')],
      segmentAnalysisLinks: [mkSegmentLink('sa-1', 'MRK 2:3')],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get('MRK')?.segmentAnalysisLinks).toEqual([mkSegmentLink('sa-1', 'MRK 2:3')]);
    expect(byBook.get('MRK')?.segmentAnalyses).toEqual([mkSegmentAnalysis('sa-1')]);
  });

  it('copies a payload shared across books into each book that links it', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('shared')],
      tokenAnalysisLinks: [mkTokenLink('shared', 'GEN 1:1'), mkTokenLink('shared', 'EXO 1:1')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get('GEN')?.tokenAnalyses).toEqual([mkTokenAnalysis('shared')]);
    expect(byBook.get('EXO')?.tokenAnalyses).toEqual([mkTokenAnalysis('shared')]);
  });

  it("partitions a phrase by its tokens' book", () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'pa-1', surfaceText: 'in the' }],
      phraseAnalysisLinks: [makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3'])],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get('GEN')?.phraseAnalysisLinks).toHaveLength(1);
    expect(byBook.get('GEN')?.phraseAnalyses).toEqual([
      { ...FIXTURE_STAMPS, id: 'pa-1', surfaceText: 'in the' },
    ]);
  });

  it('carries a payload once when two links in the same book share it', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('shared')],
      tokenAnalysisLinks: [mkTokenLink('shared', 'GEN 1:1'), mkTokenLink('shared', 'GEN 1:2')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get('GEN')?.tokenAnalyses).toEqual([mkTokenAnalysis('shared')]);
    expect(byBook.get('GEN')?.tokenAnalysisLinks).toHaveLength(2);
  });

  it('keeps a payload no link references out of the linked book’s partition', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('orphan')],
      tokenAnalysisLinks: [mkTokenLink('linked', 'GEN 1:1')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get('GEN')?.tokenAnalyses).toEqual([]);
  });

  it('partitions a payload no link references under the bookless key', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('orphan')],
      tokenAnalysisLinks: [mkTokenLink('linked', 'GEN 1:1')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get(BOOKLESS_PARTITION)?.tokenAnalyses).toEqual([mkTokenAnalysis('orphan')]);
  });

  it('partitions unlinked segment and phrase payloads under the bookless key too', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      segmentAnalyses: [mkSegmentAnalysis('sa-bare')],
      segmentAnalysisLinks: [],
      phraseAnalyses: [mkTokenAnalysis('pa-bare')],
      phraseAnalysisLinks: [],
    };

    const byBook = splitAnalysisByBook(analysis);

    expect(byBook.get(BOOKLESS_PARTITION)?.segmentAnalyses).toEqual([mkSegmentAnalysis('sa-bare')]);
    expect(byBook.get(BOOKLESS_PARTITION)?.phraseAnalyses).toEqual([mkTokenAnalysis('pa-bare')]);
  });

  it('does not file a payload as bookless when another book links it', () => {
    const analysis: TextAnalysis = {
      tokenAnalyses: [mkTokenAnalysis('shared')],
      tokenAnalysisLinks: [mkTokenLink('shared', 'GEN 1:1')],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };

    expect(splitAnalysisByBook(analysis).has(BOOKLESS_PARTITION)).toBe(false);
  });

  it('partitions an analysis whose every payload is unlinked under the bookless key alone', () => {
    const byBook = splitAnalysisByBook({
      tokenAnalyses: [mkTokenAnalysis('ta-1')],
      tokenAnalysisLinks: [],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    });

    expect([...byBook.keys()]).toEqual([BOOKLESS_PARTITION]);
    expect(byBook.get(BOOKLESS_PARTITION)?.tokenAnalyses).toEqual([mkTokenAnalysis('ta-1')]);
  });

  it('returns no partitions for an analysis with neither links nor payloads', () => {
    const byBook = splitAnalysisByBook({
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    });

    expect(byBook.size).toBe(0);
  });

  it('gives the bookless partition a key no book code can collide with', () => {
    expect(bookOfRef(`${BOOKLESS_PARTITION} 1:1`)).not.toBe(BOOKLESS_PARTITION);
  });
});

describe('removeBookFromAnalysis', () => {
  /**
   * Builds a {@link TextAnalysis} spanning two books (GEN and EXO) with:
   *
   * - A GEN token analysis + link and an EXO token analysis + link,
   * - A GEN segment analysis + link and an EXO segment analysis + link,
   * - An EXO-only phrase (should survive) and a GEN-only phrase (should be removed),
   * - An orphan token analysis (`tok-orphan`) referenced only by a GEN link, so removing GEN leaves
   *   the payload unreferenced and it must be dropped by orphan cleanup.
   */
  function makeTwoBookAnalysis(): TextAnalysis {
    return {
      tokenAnalyses: [
        mkTokenAnalysis('tok-gen'),
        mkTokenAnalysis('tok-exo'),
        mkTokenAnalysis('tok-orphan'),
      ],
      tokenAnalysisLinks: [
        mkTokenLink('tok-gen', 'GEN 1:1:0'),
        mkTokenLink('tok-exo', 'EXO 2:2:0'),
        // Only link referencing tok-orphan is a GEN link → removing GEN orphans the payload.
        mkTokenLink('tok-orphan', 'GEN 3:3:0'),
      ],
      segmentAnalyses: [mkSegmentAnalysis('seg-gen'), mkSegmentAnalysis('seg-exo')],
      segmentAnalysisLinks: [
        mkSegmentLink('seg-gen', 'GEN 1:1'),
        mkSegmentLink('seg-exo', 'EXO 2:2'),
      ],
      phraseAnalyses: [mkTokenAnalysis('ph-exo'), mkTokenAnalysis('ph-gen')],
      phraseAnalysisLinks: [
        makePhraseLink('ph-exo', ['EXO 2:2:0', 'EXO 2:2:3']),
        makePhraseLink('ph-gen', ['GEN 5:5:0', 'GEN 5:5:4']),
      ],
    };
  }

  it('drops GEN token links and keeps EXO token links', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.tokenAnalysisLinks.map((l) => l.token.tokenRef)).toEqual(['EXO 2:2:0']);
  });

  it('drops the GEN token analysis payload and keeps the EXO one', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.tokenAnalyses.map((a) => a.id)).toEqual(['tok-exo']);
  });

  it('drops an analysis left unreferenced after its only link is removed (orphan cleanup)', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    // tok-orphan was only referenced by a GEN link, so it must not survive.
    expect(result.tokenAnalyses.map((a) => a.id)).not.toContain('tok-orphan');
  });

  it('drops GEN segment links and keeps EXO segment links', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.segmentAnalysisLinks.map((l) => l.segmentId)).toEqual(['EXO 2:2']);
  });

  it('drops the GEN segment analysis payload and keeps the EXO one', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.segmentAnalyses.map((a) => a.id)).toEqual(['seg-exo']);
  });

  it('drops GEN phrase links and keeps EXO phrase links', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.phraseAnalysisLinks.map((l) => l.analysisId)).toEqual(['ph-exo']);
  });

  it('drops the GEN phrase analysis payload and keeps the EXO one', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.phraseAnalyses.map((a) => a.id)).toEqual(['ph-exo']);
  });

  it('keeps a wholly-EXO phrase when removing GEN', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    const survivor = result.phraseAnalysisLinks.find((l) => l.analysisId === 'ph-exo');
    expect(survivor?.tokens.map((t) => t.tokenRef)).toEqual(['EXO 2:2:0', 'EXO 2:2:3']);
  });

  it('keeps a payload that no link referenced before the wipe', () => {
    const input = makeTwoBookAnalysis();
    input.tokenAnalyses.push(mkTokenAnalysis('bare-word'));

    const result = removeBookFromAnalysis(input, 'GEN');

    expect(result.tokenAnalyses.map((a) => a.id)).toContain('bare-word');
  });

  it('keeps unlinked segment and phrase payloads through a wipe', () => {
    const input = makeTwoBookAnalysis();
    input.segmentAnalyses.push(mkSegmentAnalysis('seg-bare'));
    input.phraseAnalyses.push(mkTokenAnalysis('ph-bare'));

    const result = removeBookFromAnalysis(input, 'GEN');

    expect(result.segmentAnalyses.map((a) => a.id)).toContain('seg-bare');
    expect(result.phraseAnalyses.map((a) => a.id)).toContain('ph-bare');
  });

  it('does not mutate the input analysis object', () => {
    const input = makeTwoBookAnalysis();
    const snapshot = JSON.parse(JSON.stringify(input));
    removeBookFromAnalysis(input, 'GEN');
    expect(input).toEqual(snapshot);
  });

  it('returns a new object and new array references, not the originals', () => {
    const input = makeTwoBookAnalysis();
    const result = removeBookFromAnalysis(input, 'GEN');
    expect(result).not.toBe(input);
    expect(result.tokenAnalysisLinks).not.toBe(input.tokenAnalysisLinks);
    expect(result.segmentAnalysisLinks).not.toBe(input.segmentAnalysisLinks);
    expect(result.phraseAnalysisLinks).not.toBe(input.phraseAnalysisLinks);
  });

  it('returns an empty analysis unchanged in value when no record matches the book code', () => {
    const input = makeTwoBookAnalysis();
    const result = removeBookFromAnalysis(input, 'LEV');
    // Nothing belongs to LEV, so every record survives.
    expect(result.tokenAnalyses.map((a) => a.id)).toEqual(['tok-gen', 'tok-exo', 'tok-orphan']);
    expect(result.segmentAnalyses.map((a) => a.id)).toEqual(['seg-gen', 'seg-exo']);
    expect(result.phraseAnalyses.map((a) => a.id)).toEqual(['ph-exo', 'ph-gen']);
  });
});

describe('phraseSpansBooks', () => {
  it('reports a run wholly within one book as not spanning', () => {
    expect(phraseSpansBooks([{ tokenRef: 'GEN 1:1:0', surfaceText: 'in' }])).toBe(false);
  });

  it('reports a run naming two books as spanning', () => {
    expect(
      phraseSpansBooks([
        { tokenRef: 'GEN 50:26:0', surfaceText: 'in' },
        { tokenRef: 'EXO 1:1:0', surfaceText: 'the' },
      ]),
    ).toBe(true);
  });

  it('reports an empty run as not spanning', () => {
    expect(phraseSpansBooks([])).toBe(false);
  });

  it('reports a run whose books differ past the first pair as spanning', () => {
    expect(
      phraseSpansBooks([
        { tokenRef: 'GEN 1:1:0', surfaceText: 'a' },
        { tokenRef: 'GEN 1:1:2', surfaceText: 'b' },
        { tokenRef: 'EXO 1:1:0', surfaceText: 'c' },
      ]),
    ).toBe(true);
  });
});

describe('dropCrossBookPhrases', () => {
  /**
   * Builds an analysis holding one phrase within GEN and one naming both GEN and EXO, each with its
   * own payload, plus a phrase payload no link references.
   */
  function makeAnalysisWithCrossBookPhrase(): TextAnalysis {
    return {
      tokenAnalyses: [],
      tokenAnalysisLinks: [],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ph-gen', surfaceText: 'in the' },
        { ...FIXTURE_STAMPS, id: 'ph-cross', surfaceText: 'across books' },
        { ...FIXTURE_STAMPS, id: 'ph-bare', surfaceText: 'ne pas' },
      ],
      phraseAnalysisLinks: [
        makePhraseLink('ph-gen', ['GEN 1:1:0', 'GEN 1:1:3']),
        makePhraseLink('ph-cross', ['GEN 50:26:0', 'EXO 1:1:0']),
      ],
    };
  }

  it('drops the link whose tokens name two books and keeps the one-book link', () => {
    const result = dropCrossBookPhrases(makeAnalysisWithCrossBookPhrase());

    expect(result.phraseAnalysisLinks.map((l) => l.analysisId)).toEqual(['ph-gen']);
  });

  it('drops the payload the removed link leaves unreferenced', () => {
    const result = dropCrossBookPhrases(makeAnalysisWithCrossBookPhrase());

    expect(result.phraseAnalyses.map((a) => a.id)).not.toContain('ph-cross');
  });

  it('keeps a payload no link referenced before the removal', () => {
    const result = dropCrossBookPhrases(makeAnalysisWithCrossBookPhrase());

    expect(result.phraseAnalyses.map((a) => a.id)).toEqual(['ph-gen', 'ph-bare']);
  });

  it('keeps a payload a surviving link still shares with the removed one', () => {
    const input = makeAnalysisWithCrossBookPhrase();
    input.phraseAnalysisLinks.push(makePhraseLink('ph-cross', ['EXO 2:2:0', 'EXO 2:2:4']));

    const result = dropCrossBookPhrases(input);

    expect(result.phraseAnalyses.map((a) => a.id)).toContain('ph-cross');
  });

  it('does not mutate the input analysis', () => {
    const input = makeAnalysisWithCrossBookPhrase();

    dropCrossBookPhrases(input);

    expect(input.phraseAnalysisLinks).toHaveLength(2);
    expect(input.phraseAnalyses).toHaveLength(3);
  });

  it('returns the analysis itself when every phrase lies within one book', () => {
    const input = makeAnalysisWithCrossBookPhrase();
    input.phraseAnalysisLinks = [makePhraseLink('ph-gen', ['GEN 1:1:0', 'GEN 1:1:3'])];

    expect(dropCrossBookPhrases(input)).toBe(input);
  });
});

describe('removeBookFromSegmentation', () => {
  it('returns undefined for an undefined delta', () => {
    expect(removeBookFromSegmentation(undefined, 'GEN')).toBeUndefined();
  });

  it('drops the book’s removed-verse-start anchors and keeps other books’', () => {
    const result = removeBookFromSegmentation(
      { removedVerseStarts: ['GEN 1:2:0', 'EXO 3:4:0'], addedStarts: [] },
      'GEN',
    );
    expect(result).toEqual({ removedVerseStarts: ['EXO 3:4:0'], addedStarts: [] });
  });

  it('drops the book’s added-start anchors and keeps other books’', () => {
    const result = removeBookFromSegmentation(
      { removedVerseStarts: [], addedStarts: ['GEN 1:2:5', 'EXO 3:4:5'] },
      'GEN',
    );
    expect(result).toEqual({ removedVerseStarts: [], addedStarts: ['EXO 3:4:5'] });
  });

  it('collapses to undefined when removing the book empties both arrays', () => {
    const result = removeBookFromSegmentation(
      { removedVerseStarts: ['GEN 1:2:0'], addedStarts: ['GEN 1:3:5'] },
      'GEN',
    );
    expect(result).toBeUndefined();
  });

  it('keeps every anchor when no anchor belongs to the book code', () => {
    const result = removeBookFromSegmentation(
      { removedVerseStarts: ['EXO 1:2:0'], addedStarts: ['EXO 1:3:5'] },
      'GEN',
    );
    expect(result).toEqual({ removedVerseStarts: ['EXO 1:2:0'], addedStarts: ['EXO 1:3:5'] });
  });

  it('does not mutate the input delta', () => {
    const input = { removedVerseStarts: ['GEN 1:2:0', 'EXO 3:4:0'], addedStarts: ['GEN 1:3:5'] };
    const snapshot = JSON.parse(JSON.stringify(input));
    removeBookFromSegmentation(input, 'GEN');
    expect(input).toEqual(snapshot);
  });
});
