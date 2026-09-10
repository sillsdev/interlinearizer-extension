/// <reference types="jest" />

import { phraseSurfaceForm } from '../../utils/phrase-text';
import { makePhraseLink } from '../test-helpers';

const DOC_ORDER = new Map([
  ['tok-a', 0],
  ['tok-b', 1],
  ['tok-c', 2],
  ['tok-d', 3],
]);

describe('phraseSurfaceForm', () => {
  it('joins a contiguous phrase with spaces', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-b'], ['en', 'el']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('en el');
  });

  it('marks each stretch of skipped tokens with a gap filler', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-c'], ['ne', 'pas']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('ne _ pas');
  });

  it('collapses a multi-token gap into one filler', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a', 'tok-d'], ['ne', 'plus']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('ne _ plus');
  });

  it('reads out of order tokens in document order', () => {
    const { tokens } = makePhraseLink('p1', ['tok-b', 'tok-a'], ['el', 'en']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('en el');
  });

  it('renders a single-token phrase as its surface text alone', () => {
    const { tokens } = makePhraseLink('p1', ['tok-a'], ['en']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('en');
  });

  it('marks no gap around a token missing from the document order', () => {
    const { tokens } = makePhraseLink('p1', ['tok-z', 'tok-d'], ['ne', 'plus']);
    expect(phraseSurfaceForm(tokens, DOC_ORDER)).toBe('ne plus');
  });
});
