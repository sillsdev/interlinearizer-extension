/** @file Unit tests for utils/analysis-book.ts. */
/// <reference types="jest" />

import type {
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { bookOfRef, removeBookFromAnalysis } from '../../utils/analysis-book';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal `TokenAnalysis` payload record fixture.
 *
 * @param id - Analysis id.
 * @param surfaceText - Surface text; defaults to `id` when omitted.
 * @returns A `TokenAnalysis` with the given id.
 */
function mkTokenAnalysis(id: string, surfaceText = id): TokenAnalysis {
  return { id, surfaceText };
}

/**
 * Creates a `TokenAnalysisLink` joining a token ref to an analysis id.
 *
 * @param analysisId - The `TokenAnalysis.id` this link points at.
 * @param tokenRef - The token ref the analysis is attached to.
 * @returns An approved `TokenAnalysisLink`.
 */
function mkTokenLink(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return { analysisId, status: 'approved', token: { tokenRef, surfaceText: tokenRef } };
}

/**
 * Creates a minimal `SegmentAnalysis` payload record fixture.
 *
 * @param id - Analysis id.
 * @param surfaceText - Surface text; defaults to `id` when omitted.
 * @returns A `SegmentAnalysis` with the given id.
 */
function mkSegmentAnalysis(id: string, surfaceText = id): SegmentAnalysis {
  return { id, surfaceText };
}

/**
 * Creates a `SegmentAnalysisLink` joining a segment id to an analysis id.
 *
 * @param analysisId - The `SegmentAnalysis.id` this link points at.
 * @param segmentId - The segment id the analysis is attached to.
 * @returns An approved `SegmentAnalysisLink`.
 */
function mkSegmentLink(analysisId: string, segmentId: string): SegmentAnalysisLink {
  return { analysisId, status: 'approved', segmentId };
}

// ---------------------------------------------------------------------------
// bookOfRef
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// removeBookFromAnalysis
// ---------------------------------------------------------------------------

describe('removeBookFromAnalysis', () => {
  /**
   * Builds a `TextAnalysis` spanning two books (GEN and EXO) with:
   *
   * - A GEN token analysis + link and an EXO token analysis + link,
   * - A GEN segment analysis + link and an EXO segment analysis + link,
   * - An EXO-only phrase (should survive) and a cross-book GEN+EXO phrase (should be removed),
   * - An orphan token analysis (`tok-orphan`) referenced only by a GEN link, so removing GEN leaves
   *   the payload unreferenced and it must be dropped by orphan cleanup.
   *
   * @returns A populated `TextAnalysis` fixture.
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
      phraseAnalyses: [mkTokenAnalysis('ph-exo'), mkTokenAnalysis('ph-cross')],
      phraseAnalysisLinks: [
        // Entirely within EXO → survives.
        makePhraseLink('ph-exo', ['EXO 2:2:0', 'EXO 2:2:3']),
        // Cross-book: an EXO token AND a GEN token → removed when wiping GEN.
        makePhraseLink('ph-cross', ['EXO 4:4:0', 'GEN 5:5:0']),
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

  it('removes a cross-book phrase whose token list contains a GEN token', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.phraseAnalysisLinks.map((l) => l.analysisId)).toEqual(['ph-exo']);
  });

  it('drops the cross-book phrase analysis payload and keeps the EXO-only one', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    expect(result.phraseAnalyses.map((a) => a.id)).toEqual(['ph-exo']);
  });

  it('keeps a wholly-EXO phrase when removing GEN', () => {
    const result = removeBookFromAnalysis(makeTwoBookAnalysis(), 'GEN');
    const survivor = result.phraseAnalysisLinks.find((l) => l.analysisId === 'ph-exo');
    expect(survivor?.tokens.map((t) => t.tokenRef)).toEqual(['EXO 2:2:0', 'EXO 2:2:3']);
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
    expect(result.phraseAnalyses.map((a) => a.id)).toEqual(['ph-exo', 'ph-cross']);
  });
});
