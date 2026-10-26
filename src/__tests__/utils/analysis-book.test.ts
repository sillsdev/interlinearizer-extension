/// <reference types="jest" />

import type {
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import {
  BOOKLESS_PARTITION,
  bookOfRef,
  mergeAnalyses,
  removeBookFromAnalysis,
  removeBookFromSegmentation,
  restoreBookInAnalysis,
  restoreBookInSegmentation,
  splitAnalysisByBook,
} from '../../utils/analysis-book';
import { emptyAnalysis } from '../../types/empty-factories';
import { makePhraseLink, makeTokenLink, FIXTURE_STAMPS } from '../test-helpers';

/**
 * Creates a minimal {@link TokenAnalysis} payload record fixture, with `surfaceText` defaulting to
 * `id`.
 */
function mkTokenAnalysis(id: string, surfaceText = id): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText };
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
  return {
    id: `${segmentId}:${analysisId}`,
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    segmentId,
  };
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
      tokenAnalysisLinks: [makeTokenLink('ta-gen', 'GEN 1:1'), makeTokenLink('ta-exo', 'EXO 1:1')],
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
      tokenAnalysisLinks: [makeTokenLink('shared', 'GEN 1:1'), makeTokenLink('shared', 'EXO 1:1')],
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
      tokenAnalysisLinks: [makeTokenLink('shared', 'GEN 1:1'), makeTokenLink('shared', 'GEN 1:2')],
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
      tokenAnalysisLinks: [makeTokenLink('linked', 'GEN 1:1')],
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
      tokenAnalysisLinks: [makeTokenLink('linked', 'GEN 1:1')],
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
      tokenAnalysisLinks: [makeTokenLink('shared', 'GEN 1:1')],
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

describe('mergeAnalyses', () => {
  const genesis: TextAnalysis = {
    tokenAnalyses: [mkTokenAnalysis('ta-gen'), mkTokenAnalysis('shared')],
    tokenAnalysisLinks: [
      makeTokenLink('ta-gen', 'GEN 1:1:0'),
      makeTokenLink('shared', 'GEN 1:1:3'),
    ],
    segmentAnalyses: [mkSegmentAnalysis('sa-gen')],
    segmentAnalysisLinks: [mkSegmentLink('sa-gen', 'GEN 1:1')],
    phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'pa-gen', surfaceText: 'in the' }],
    phraseAnalysisLinks: [makePhraseLink('pa-gen', ['GEN 1:1:0', 'GEN 1:1:3'])],
  };
  const exodus: TextAnalysis = {
    tokenAnalyses: [mkTokenAnalysis('shared')],
    tokenAnalysisLinks: [makeTokenLink('shared', 'EXO 1:1:0')],
    segmentAnalyses: [mkSegmentAnalysis('sa-exo')],
    segmentAnalysisLinks: [mkSegmentLink('sa-exo', 'EXO 1:1')],
    phraseAnalyses: [],
    phraseAnalysisLinks: [],
  };

  it('concatenates every partition’s links in partition order', () => {
    const merged = mergeAnalyses([genesis, exodus]);

    expect(merged.tokenAnalysisLinks).toEqual([
      ...genesis.tokenAnalysisLinks,
      ...exodus.tokenAnalysisLinks,
    ]);
    expect(merged.segmentAnalysisLinks).toEqual([
      ...genesis.segmentAnalysisLinks,
      ...exodus.segmentAnalysisLinks,
    ]);
    expect(merged.phraseAnalysisLinks).toEqual(genesis.phraseAnalysisLinks);
  });

  it('keeps every payload whose id no earlier partition carried', () => {
    const merged = mergeAnalyses([genesis, exodus]);

    expect(merged.segmentAnalyses).toEqual([
      mkSegmentAnalysis('sa-gen'),
      mkSegmentAnalysis('sa-exo'),
    ]);
    expect(merged.phraseAnalyses).toEqual(genesis.phraseAnalyses);
  });

  it('carries a payload two partitions both hold once', () => {
    const merged = mergeAnalyses([genesis, exodus]);

    expect(merged.tokenAnalyses).toEqual([mkTokenAnalysis('ta-gen'), mkTokenAnalysis('shared')]);
  });

  it('rebuilds the analysis splitAnalysisByBook partitioned', () => {
    const whole = mergeAnalyses([genesis, exodus]);

    expect(mergeAnalyses([...splitAnalysisByBook(whole).values()])).toEqual(whole);
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
        makeTokenLink('tok-gen', 'GEN 1:1:0'),
        makeTokenLink('tok-exo', 'EXO 2:2:0'),
        // Only link referencing tok-orphan is a GEN link → removing GEN orphans the payload.
        makeTokenLink('tok-orphan', 'GEN 3:3:0'),
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
      {
        removedVerseStarts: [],
        addedStarts: [
          { tokenRef: 'GEN 1:2:5', surfaceText: 'word' },
          { tokenRef: 'EXO 3:4:5', surfaceText: 'word' },
        ],
      },
      'GEN',
    );
    expect(result).toEqual({
      removedVerseStarts: [],
      addedStarts: [{ tokenRef: 'EXO 3:4:5', surfaceText: 'word' }],
    });
  });

  it('collapses to undefined when removing the book empties both arrays', () => {
    const result = removeBookFromSegmentation(
      {
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: [{ tokenRef: 'GEN 1:3:5', surfaceText: 'word' }],
      },
      'GEN',
    );
    expect(result).toBeUndefined();
  });

  it('keeps every anchor when no anchor belongs to the book code', () => {
    const result = removeBookFromSegmentation(
      {
        removedVerseStarts: ['EXO 1:2:0'],
        addedStarts: [{ tokenRef: 'EXO 1:3:5', surfaceText: 'word' }],
      },
      'GEN',
    );
    expect(result).toEqual({
      removedVerseStarts: ['EXO 1:2:0'],
      addedStarts: [{ tokenRef: 'EXO 1:3:5', surfaceText: 'word' }],
    });
  });

  it('does not mutate the input delta', () => {
    const input = {
      removedVerseStarts: ['GEN 1:2:0', 'EXO 3:4:0'],
      addedStarts: [{ tokenRef: 'GEN 1:3:5', surfaceText: 'word' }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    removeBookFromSegmentation(input, 'GEN');
    expect(input).toEqual(snapshot);
  });
});

describe('restoreBookInAnalysis', () => {
  /** Builds an analysis that links each token ref to the payload `analysisId`, one payload per id. */
  function analysisOf(...links: [analysisId: string, tokenRef: string][]): TextAnalysis {
    const ids = [...new Set(links.map(([id]) => id))];
    return {
      ...emptyAnalysis(),
      tokenAnalyses: ids.map((id) => mkTokenAnalysis(id)),
      tokenAnalysisLinks: links.map(([id, tokenRef]) => makeTokenLink(id, tokenRef)),
    };
  }

  /** Lists each token link in `analysis` as `tokenRef=analysisId`, sorted. */
  function linksIn(analysis: TextAnalysis): string[] {
    return analysis.tokenAnalysisLinks.map((l) => `${l.token.tokenRef}=${l.analysisId}`).sort();
  }

  it("replaces the book's records with those the source holds for it", () => {
    const result = restoreBookInAnalysis(
      analysisOf(['gen-draft', 'GEN 1:1:0']),
      analysisOf(['gen-saved', 'GEN 1:1:0'], ['exo-saved', 'EXO 2:2:0']),
      'GEN',
    );

    expect(linksIn(result)).toEqual(['GEN 1:1:0=gen-saved']);
    expect(result.tokenAnalyses.map((a) => a.id)).toEqual(['gen-saved']);
  });

  it("keeps other books' records", () => {
    const result = restoreBookInAnalysis(
      analysisOf(['gen-draft', 'GEN 1:1:0'], ['exo-draft', 'EXO 2:2:0']),
      analysisOf(['gen-saved', 'GEN 1:1:0']),
      'GEN',
    );

    expect(linksIn(result)).toEqual(['EXO 2:2:0=exo-draft', 'GEN 1:1:0=gen-saved']);
  });

  it("keeps the analysis's version of a payload the book shares with another book", () => {
    const draft = analysisOf(['shared', 'GEN 1:1:0'], ['shared', 'EXO 2:2:0']);
    draft.tokenAnalyses = [mkTokenAnalysis('shared', 'edited')];
    const saved = analysisOf(['shared', 'GEN 1:1:0'], ['shared', 'EXO 2:2:0']);

    const result = restoreBookInAnalysis(draft, saved, 'GEN');

    expect(result.tokenAnalyses).toEqual([mkTokenAnalysis('shared', 'edited')]);
  });

  it('removes the book when the source holds nothing for it', () => {
    const result = restoreBookInAnalysis(
      analysisOf(['gen-draft', 'GEN 1:1:0'], ['exo-draft', 'EXO 2:2:0']),
      analysisOf(['exo-saved', 'EXO 2:2:0']),
      'GEN',
    );

    expect(linksIn(result)).toEqual(['EXO 2:2:0=exo-draft']);
  });

  it('removes the book when there is no source', () => {
    const result = restoreBookInAnalysis(analysisOf(['gen-draft', 'GEN 1:1:0']), undefined, 'GEN');

    expect(result).toEqual(emptyAnalysis());
  });
});

describe('restoreBookInSegmentation', () => {
  it("replaces the book's anchors with those the source holds for it", () => {
    const savedStart = { tokenRef: 'GEN 1:3:5', surfaceText: 'word' };

    const result = restoreBookInSegmentation(
      { removedVerseStarts: ['GEN 1:2:0', 'EXO 3:4:0'], addedStarts: [] },
      { removedVerseStarts: ['GEN 1:5:0', 'EXO 9:9:0'], addedStarts: [savedStart] },
      'GEN',
    );

    expect(result).toEqual({
      removedVerseStarts: ['EXO 3:4:0', 'GEN 1:5:0'],
      addedStarts: [savedStart],
    });
  });

  it('returns undefined when no anchor remains', () => {
    const result = restoreBookInSegmentation(
      { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] },
      { removedVerseStarts: ['EXO 9:9:0'], addedStarts: [] },
      'GEN',
    );

    expect(result).toBeUndefined();
  });

  it("keeps other books' anchors when there is no source", () => {
    const result = restoreBookInSegmentation(
      { removedVerseStarts: ['GEN 1:2:0', 'EXO 3:4:0'], addedStarts: [] },
      undefined,
      'GEN',
    );

    expect(result).toEqual({ removedVerseStarts: ['EXO 3:4:0'], addedStarts: [] });
  });
});
