/** @file Unit tests for PhraseBox component. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentStatus, Token, TokenSnapshot } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { PhraseBox } from '../../components/PhraseBox';

jest.mock('../../components/AnalysisStore');

jest.mock('../../components/TokenChip', () => {
  const { useGloss, useGlossDispatch } = jest.requireMock<
    typeof import('../../components/AnalysisStore')
  >('../../components/AnalysisStore');
  function MockTokenChip({ onFocus, token }: Readonly<{ onFocus?: () => void; token: Token }>) {
    const gloss = useGloss(token.ref);
    const dispatch = useGlossDispatch();
    return (
      <span data-testid={`token-${token.ref}`}>
        {token.surfaceText}
        <input
          aria-label={`Gloss for ${token.surfaceText}`}
          onChange={(e) => dispatch(token.ref, token.surfaceText, e.target.value)}
          onFocus={onFocus}
          value={gloss}
        />
      </span>
    );
  }
  return { __esModule: true, default: MockTokenChip };
});

/** Pre-built test token */
const TEST_TOKEN = {
  ref: 'token-1',
  surfaceText: 'Hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/** Second test token */
const TEST_TOKEN_2 = {
  ref: 'token-2',
  surfaceText: 'World',
  writingSystem: 'en',
  type: 'word',
  charStart: 6,
  charEnd: 11,
} satisfies Token;

/** Shared props shape used by both helper functions. */
type PhraseBoxTestProps = {
  index: number | undefined;
  isFocused: boolean;
  onFocusPhrase: (index?: number) => void;
  tokens: (Token & { type: 'word' })[];
};

/**
 * Minimal required props for PhraseBox. Spread into render calls so tests only need to override
 * what they actually care about.
 *
 * @returns An object containing all required PhraseBox props set to no-op stubs.
 */
function requiredProps(): PhraseBoxTestProps {
  return {
    index: undefined,
    isFocused: false,
    onFocusPhrase: jest.fn(),
    tokens: [TEST_TOKEN],
  };
}

describe('PhraseBox', () => {
  it('renders as a label', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('LABEL');
  });

  it('renders one TokenChip per token in the tokens array', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('token-token-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-token-2')).toBeInTheDocument();
  });

  it('clicking the outer container focuses the first gloss input', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    await userEvent.click(phraseBox ?? document.body);

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveFocus();
  });

  it('applies focused border and background when isFocused is true', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBox).toHaveClass('tw:border-2');
    expect(phraseBox).toHaveClass('tw:border-white');
    expect(phraseBox).toHaveClass('tw:bg-muted/30');
  });

  it('applies default border and background when isFocused is false', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused={false} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBox).toHaveClass('tw:border');
    expect(phraseBox).toHaveClass('tw:border-border/40');
    expect(phraseBox).toHaveClass('tw:bg-muted/20');
  });

  it('phrase box does not override cursor on gap areas', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).not.toHaveClass('tw:cursor-text');
  });

  it('renders tokens in the order they appear in the tokens array', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    const tokens = document.querySelectorAll('[data-testid^="token-"]');
    expect(tokens[0]).toHaveAttribute('data-testid', 'token-token-1');
    expect(tokens[1]).toHaveAttribute('data-testid', 'token-token-2');
  });

  it('passes the gloss for each token from the store', () => {
    const initialAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'Hello', gloss: { und: 'hello' } },
        { id: 'ta-2', surfaceText: 'World', gloss: { und: 'world' } },
      ],
      tokenAnalysisLinks: [
        {
          analysisId: 'ta-1',
          status: 'approved',
          token: { tokenRef: 'token-1', surfaceText: 'Hello' },
        } satisfies {
          analysisId: string;
          status: AssignmentStatus;
          token: TokenSnapshot;
        },
        {
          analysisId: 'ta-2',
          status: 'approved',
          token: { tokenRef: 'token-2', surfaceText: 'World' },
        } satisfies {
          analysisId: string;
          status: AssignmentStatus;
          token: TokenSnapshot;
        },
      ],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={initialAnalysis} analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Gloss for World' })).toHaveValue('world');
  });

  it('shows an empty string when the token id is absent from the store', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('');
  });

  it('updates the store when a gloss input changes', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for Hello' }), 'hi');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'token-1', 'h');
    expect(spy).toHaveBeenNthCalledWith(2, 'token-1', 'hi');
  });

  it('calls onFocusPhrase with index when a gloss input receives focus', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} onFocusPhrase={handleFocus} index={2} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for Hello' }));

    expect(handleFocus).toHaveBeenCalledWith(2);
  });
});
