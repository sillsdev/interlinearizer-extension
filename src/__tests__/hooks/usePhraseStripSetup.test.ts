/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { useLinkLabelValue } from '../../hooks/usePhraseStripSetup';
import { mockKeyAsValueLocalizedStrings } from '../components/test-helpers';
import { makePhraseLink, makeWordToken } from '../test-helpers';

const TOKEN_DOC_ORDER = new Map([
  ['tok-a', 0],
  ['tok-b', 1],
  ['tok-c', 2],
]);

/** Three word tokens whose segment reads `en, el pas`, so a phrase can carry punctuation or a gap. */
const WORD_TOKEN_BY_REF = new Map<string, Token & { type: 'word' }>([
  ['tok-a', makeWordToken('tok-a', 'en')],
  ['tok-b', makeWordToken('tok-b', 'el')],
  ['tok-c', makeWordToken('tok-c', 'pas')],
]);

const GAP_TEXT_BY_WORD_REF = new Map([
  ['tok-b', ', '],
  ['tok-c', ' '],
]);

function linkLabel(
  focusedPhraseLink?: PhraseAnalysisLink,
  focusedFreeToken?: Token & { type: 'word' },
): string {
  const { result } = renderHook(() =>
    useLinkLabelValue(
      focusedPhraseLink,
      focusedFreeToken,
      TOKEN_DOC_ORDER,
      WORD_TOKEN_BY_REF,
      GAP_TEXT_BY_WORD_REF,
    ),
  );
  return result.current;
}

describe('useLinkLabelValue', () => {
  beforeEach(() => {
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_linkButton_link%': 'Link to {phrase}',
      '%interlinearizer_linkButton_linkNoSelection%': 'Link words',
    });
  });

  it('names the phrase the link would join to, punctuation and all', () => {
    expect(linkLabel(makePhraseLink('p1', ['tok-a', 'tok-b']))).toBe('Link to en, el');
  });

  it('marks the gap of a discontiguous phrase', () => {
    expect(linkLabel(makePhraseLink('p1', ['tok-a', 'tok-c']))).toBe('Link to en _ pas');
  });

  it('names a free token on its own', () => {
    expect(linkLabel(undefined, makeWordToken('tok-a', 'en'))).toBe('Link to en');
  });

  it('falls back to the generic label while nothing is selected', () => {
    expect(linkLabel()).toBe('Link words');
  });
});
