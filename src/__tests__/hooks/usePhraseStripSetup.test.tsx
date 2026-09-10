/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, renderHook, screen } from '@testing-library/react';
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { useLocalizedStrings } from '@papi/frontend/react';
import type { LinkLabel } from '../../components/PhraseStripContext';
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
): LinkLabel {
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

function linkLabelText(
  focusedPhraseLink?: PhraseAnalysisLink,
  focusedFreeToken?: Token & { type: 'word' },
): string {
  return linkLabel(focusedPhraseLink, focusedFreeToken).text;
}

describe('useLinkLabelValue', () => {
  beforeEach(() => {
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_linkButton_link%': 'Link to {phrase}',
      '%interlinearizer_linkButton_linkNoSelection%': 'Link words',
    });
  });

  it('names the phrase the link would join to, punctuation and all', () => {
    expect(linkLabelText(makePhraseLink('p1', ['tok-a', 'tok-b']))).toBe('Link to en, el');
  });

  it('marks the gap of a discontiguous phrase', () => {
    expect(linkLabelText(makePhraseLink('p1', ['tok-a', 'tok-c']))).toBe('Link to en _ pas');
  });

  it('names a free token on its own', () => {
    expect(linkLabelText(undefined, makeWordToken('tok-a', 'en'))).toBe('Link to en');
  });

  it('falls back to the generic label while nothing is selected', () => {
    expect(linkLabelText()).toBe('Link words');
  });

  it('hands the tooltip a phrase it can still set apart', () => {
    // Substituting before handing the wording on would leave no placeholder to fill, and the
    // phrase would read as running text.
    render(<p>{linkLabel(makePhraseLink('p1', ['tok-a', 'tok-b'])).content}</p>);

    expect(screen.getByText('en, el').tagName).toBe('STRONG');
  });

  it('offers no tooltip while the wording is still an unresolved key', () => {
    jest
      .mocked(useLocalizedStrings)
      .mockImplementation((keys) => [Object.fromEntries(keys.map((key) => [key, key])), false]);

    expect(linkLabel(makePhraseLink('p1', ['tok-a', 'tok-b'])).content).toEqual([]);
  });
});
