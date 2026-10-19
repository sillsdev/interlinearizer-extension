/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { PhraseAnalysisLink, Segment } from 'interlinearizer';
import useStripGroups from '../../hooks/useStripGroups';
import { makePhraseLink, makePunctToken, makeSegment, makeWordToken } from '../test-helpers';

/** Verse `verse` of GEN 1: two words and a full stop. */
function makeVerse(verse: number): Segment {
  return makeSegment(`GEN 1:${verse}`, 'a b.', [
    makeWordToken(`${verse}a`, 'a', 0),
    makeWordToken(`${verse}b`, 'b', 2),
    makePunctToken(`${verse}.`, '.', 3),
  ]);
}

const VERSES = Array.from({ length: 10 }, (_unused, i) => makeVerse(i + 1));

const NO_PHRASES = new Map<string, PhraseAnalysisLink>();

/** Phrase-link lookup joining verse 2's two words. */
function joiningVerse2(): Map<string, PhraseAnalysisLink> {
  const link = makePhraseLink('p', ['2a', '2b']);
  return new Map([
    ['2a', link],
    ['2b', link],
  ]);
}

type Props = { segments: readonly Segment[]; links: Map<string, PhraseAnalysisLink> };

function renderGroups(segments: readonly Segment[], links = NO_PHRASES) {
  return renderHook(({ segments: s, links: l }: Props) => useStripGroups(s, l), {
    initialProps: { segments, links },
  });
}

describe('useStripGroups', () => {
  it("flattens the segments' tokens in order", () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.tokens.map((t) => t.ref)).toEqual(['1a', '1b', '1.', '2a', '2b', '2.']);
  });

  it('groups each word on its own', () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.groups.map((g) => g.tokens.map((t) => t.ref))).toEqual([
      ['1a'],
      ['1b'],
      ['2a'],
      ['2b'],
    ]);
  });

  it("groups a phrase's words together", () => {
    const { result } = renderGroups(VERSES.slice(0, 2), joiningVerse2());

    expect(result.current.groups.map((g) => g.tokens.map((t) => t.ref))).toEqual([
      ['1a'],
      ['1b'],
      ['2a', '2b'],
    ]);
  });

  it('numbers the first groups from zero', () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.first).toBe(0);
  });

  it('indexes every word by its group', () => {
    const { result } = renderGroups(VERSES.slice(0, 2), joiningVerse2());

    expect([...result.current.indexByTokenRef]).toEqual([
      ['1a', 0],
      ['1b', 1],
      ['2a', 2],
      ['2b', 2],
    ]);
  });

  it('keeps every group its index when segments are held before it', () => {
    const { result, rerender } = renderGroups(VERSES.slice(4, 6));
    const before = result.current.indexByTokenRef.get('5a');

    rerender({ segments: VERSES.slice(2, 6), links: NO_PHRASES });

    expect(result.current.indexByTokenRef.get('5a')).toBe(before);
    expect(result.current.first).toBe(-4);
  });

  it('keeps every group its index when segments before it are dropped', () => {
    const { result, rerender } = renderGroups(VERSES.slice(2, 6));
    const before = result.current.indexByTokenRef.get('5a');

    rerender({ segments: VERSES.slice(4, 8), links: NO_PHRASES });

    expect(result.current.indexByTokenRef.get('5a')).toBe(before);
  });

  it('numbers groups past every index used when they share no word with those before', () => {
    const { result, rerender } = renderGroups(VERSES.slice(0, 2));

    rerender({ segments: VERSES.slice(6, 8), links: NO_PHRASES });

    expect(result.current.first).toBeGreaterThan(3);
  });

  it('keeps the groups of a segment held across a change', () => {
    const { result, rerender } = renderGroups(VERSES.slice(2, 4));
    const before = result.current.at(result.current.indexByTokenRef.get('3a') ?? -1);

    rerender({ segments: VERSES.slice(2, 6), links: NO_PHRASES });

    expect(result.current.at(result.current.indexByTokenRef.get('3a') ?? -1)).toBe(before);
  });

  it('regroups the segments when the phrase links change', () => {
    const { result, rerender } = renderGroups(VERSES.slice(0, 2));

    rerender({ segments: VERSES.slice(0, 2), links: joiningVerse2() });

    expect(result.current.groups).toHaveLength(3);
  });

  it('finds the group at an index', () => {
    const { result, rerender } = renderGroups(VERSES.slice(4, 6));
    rerender({ segments: VERSES.slice(2, 6), links: NO_PHRASES });

    expect(result.current.at(result.current.first)?.tokens[0].ref).toBe('3a');
  });

  it('finds no group at an index it does not hold', () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.at(4)).toBeUndefined();
  });

  it("places a group's first token among the tokens", () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.tokenIndexOf(2)).toBe(3);
  });

  it('places the end of the tokens past the last group', () => {
    const { result } = renderGroups(VERSES.slice(0, 2));

    expect(result.current.tokenIndexOf(4)).toBe(6);
  });
});
