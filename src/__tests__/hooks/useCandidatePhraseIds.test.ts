/** @file Unit tests for hooks/useCandidatePhraseIds.ts. */
/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import { useCandidatePhraseIds } from '../../hooks/useCandidatePhraseIds';

/**
 * Builds an approved `PhraseAnalysisLink` fixture.
 *
 * @param phraseId - Phrase id.
 * @param tokenRefs - Token refs in the phrase.
 * @returns An approved `PhraseAnalysisLink`.
 */
function makePhraseLink(phraseId: string, tokenRefs: string[]): PhraseAnalysisLink {
  return {
    analysisId: phraseId,
    status: 'approved',
    tokens: tokenRefs.map((ref) => ({ tokenRef: ref, surfaceText: ref })),
  };
}

describe('useCandidatePhraseIds', () => {
  it('returns an empty set when candidateTokenRefs is empty', () => {
    const phraseLinkByRef = new Map([['tok-a', makePhraseLink('p1', ['tok-a'])]]);
    const { result } = renderHook(() => useCandidatePhraseIds(new Set(), phraseLinkByRef));
    expect(result.current.size).toBe(0);
  });

  it('returns phrase ids whose tokens intersect candidateTokenRefs', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const phraseLinkByRef = new Map([
      ['tok-a', link],
      ['tok-b', link],
    ]);
    const { result } = renderHook(() => useCandidatePhraseIds(new Set(['tok-a']), phraseLinkByRef));
    expect(result.current.has('p1')).toBe(true);
  });

  it('returns an empty set when no phrase token intersects candidateTokenRefs', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const phraseLinkByRef = new Map([
      ['tok-a', link],
      ['tok-b', link],
    ]);
    const { result } = renderHook(() => useCandidatePhraseIds(new Set(['tok-c']), phraseLinkByRef));
    expect(result.current.size).toBe(0);
  });

  it('can return multiple phrase ids', () => {
    const link1 = makePhraseLink('p1', ['tok-a']);
    const link2 = makePhraseLink('p2', ['tok-b']);
    const phraseLinkByRef = new Map([
      ['tok-a', link1],
      ['tok-b', link2],
    ]);
    const { result } = renderHook(() =>
      useCandidatePhraseIds(new Set(['tok-a', 'tok-b']), phraseLinkByRef),
    );
    expect(result.current.has('p1')).toBe(true);
    expect(result.current.has('p2')).toBe(true);
  });
});
