/// <reference types="jest" />

import type { Token } from 'interlinearizer';
import { phraseSurfaceForm, type PhraseTextIndexes } from '../../utils/phrase-text';
import { makePhraseLink, makeWordToken } from '../test-helpers';

const DOC_ORDER = new Map([
  ['tok-a', 0],
  ['tok-b', 1],
  ['tok-c', 2],
  ['tok-d', 3],
]);

/**
 * Builds the lookups {@link phraseSurfaceForm} reads, from a live surface text and a preceding gap
 * per word ref. A ref given no live text stands for one stranded by a re-tokenized baseline, which
 * no longer resolves to a token of the loaded book.
 */
function indexes(
  live: Record<string, string>,
  gaps: Record<string, string> = {},
): PhraseTextIndexes {
  const wordTokenByRef = new Map<string, Token & { type: 'word' }>(
    Object.entries(live).map(([ref, text]) => [ref, makeWordToken(ref, text)]),
  );
  return {
    tokenDocOrder: DOC_ORDER,
    wordTokenByRef,
    gapTextByWordRef: new Map(Object.entries(gaps)),
  };
}

describe('phraseSurfaceForm', () => {
  it('separates contiguous tokens with the baseline text between them', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'en', 'tok-b': 'el' }, { 'tok-b': ' ' })),
    ).toBe('en el');
  });

  it('keeps punctuation sitting between two tokens of the phrase', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'en', 'tok-b': 'el' }, { 'tok-b': ', ' })),
    ).toBe('en, el');
  });

  it('runs tokens together where the baseline separates them with nothing', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'ก', 'tok-b': 'ข' }, { 'tok-b': '' })),
    ).toBe('กข');
  });

  it('marks a stretch of skipped tokens, hiding whatever it contains', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-c']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'ne', 'tok-c': 'pas' }, { 'tok-c': ', ' })),
    ).toBe('ne _ pas');
  });

  it('collapses a multi-token gap into one mark', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-d']);
    expect(phraseSurfaceForm(tokens, indexes({ 'tok-a': 'ne', 'tok-d': 'plus' }))).toBe(
      'ne _ plus',
    );
  });

  it('leaves out a token the book no longer has, as the strip does', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-z'], ['A', 'B', 'C']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'A', 'tok-b': 'B' }, { 'tok-b': ' ' })),
    ).toBe('A B');
  });

  it('still marks a gap the dropped token was sitting in', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-z', 'tok-c'], ['A', 'Z', 'C']);
    expect(
      phraseSurfaceForm(
        tokens,
        indexes({ 'tok-a': 'A', 'tok-c': 'C' }, { 'tok-b': ' ', 'tok-c': ' ' }),
      ),
    ).toBe('A _ C');
  });

  it('names nothing for a phrase the book has lost entirely', () => {
    const { tokens } = makePhraseLink('p1', ['tok-y', 'tok-z'], ['A', 'B']);
    expect(phraseSurfaceForm(tokens, indexes({}))).toBe('');
  });

  it('renders a single-token phrase as its surface text alone', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a']);
    expect(phraseSurfaceForm(tokens, indexes({ 'tok-a': 'en' }))).toBe('en');
  });

  it('prefers the live surface text over a snapshot that has drifted', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b'], ['en', 'el']);
    expect(
      phraseSurfaceForm(tokens, indexes({ 'tok-a': 'un', 'tok-b': 'el' }, { 'tok-b': ' ' })),
    ).toBe('un el');
  });

  it('joins with a space where no baseline slice separates the two', () => {
    // A phrase spanning a segment boundary, which the model permits though the app never makes
    // one: the second word opens its segment, so no slice reaches back across the boundary.
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b'], ['en', 'el']);
    expect(phraseSurfaceForm(tokens, indexes({ 'tok-a': 'en', 'tok-b': 'el' }))).toBe('en el');
  });
});
