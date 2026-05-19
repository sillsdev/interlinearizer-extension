/** @file Unit tests for PhraseBox component. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import { PhraseBox } from '../../components/PhraseBox';

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  default: ({
    gloss,
    onFocus,
    onGlossChange,
    token,
  }: {
    gloss?: string;
    onFocus?: () => void;
    onGlossChange?: (value: string) => void;
    token: Token;
  }) => (
    <span data-testid={`token-${token.id}`}>
      {token.surfaceText}
      <input
        aria-label={`Gloss for ${token.surfaceText}`}
        onChange={(e) => onGlossChange?.(e.target.value)}
        onFocus={onFocus}
        value={gloss ?? ''}
      />
    </span>
  ),
}));

/** Pre-built test token */
const TEST_TOKEN: Token = {
  id: 'token-1',
  surfaceText: 'Hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
};

/** Second test token */
const TEST_TOKEN_2: Token = {
  id: 'token-2',
  surfaceText: 'World',
  writingSystem: 'en',
  type: 'word',
  charStart: 6,
  charEnd: 11,
};

/** Shared props shape used by both helper functions. */
type PhraseBoxTestProps = {
  glosses: Record<string, string>;
  isFocused: boolean;
  onClick?: (index?: number) => void;
  onGlossChange: (tokenId: string, value: string) => void;
  tokens: Token[];
};

/**
 * Minimal required props for PhraseBox. Spread into render calls so tests only need to override
 * what they actually care about.
 *
 * @returns An object containing all required PhraseBox props set to no-op stubs.
 */
function requiredProps(): PhraseBoxTestProps {
  return {
    glosses: {},
    isFocused: false,
    onClick: jest.fn(),
    onGlossChange: jest.fn(),
    tokens: [TEST_TOKEN],
  };
}

/**
 * Props with onClick omitted so the non-interactive span branch is rendered.
 *
 * @returns Props without an onClick handler.
 */
function nonInteractiveProps(): PhraseBoxTestProps {
  return {
    glosses: {},
    isFocused: false,
    onGlossChange: jest.fn(),
    tokens: [TEST_TOKEN],
  };
}

describe('PhraseBox', () => {
  it('renders as a button', () => {
    render(<PhraseBox {...requiredProps()} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('BUTTON');
    expect(phraseBox).toHaveAttribute('type', 'button');
  });

  it('renders tokens using TokenChip components', () => {
    render(<PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />);

    expect(screen.getByTestId('token-token-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-token-2')).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', async () => {
    const mockOnClick = jest.fn();
    render(<PhraseBox {...requiredProps()} onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('applies focused border and background when isFocused is true', () => {
    render(<PhraseBox {...requiredProps()} isFocused />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBox).toHaveClass('tw:border-2');
    expect(phraseBox).toHaveClass('tw:border-white');
    expect(phraseBox).toHaveClass('tw:bg-muted/30');
  });

  it('applies default border and background when isFocused is false', () => {
    render(<PhraseBox {...requiredProps()} isFocused={false} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBox).toHaveClass('tw:border');
    expect(phraseBox).toHaveClass('tw:border-border/40');
    expect(phraseBox).toHaveClass('tw:bg-muted/20');
  });

  it('button has correct focused styling and cursor', () => {
    render(<PhraseBox {...requiredProps()} isFocused />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-focus-state', 'focused');
    expect(button).toHaveClass('tw:border-2');
    expect(button).toHaveClass('tw:cursor-pointer');
    expect(button).toHaveClass('tw:text-left');
  });

  it('button has hover styling', () => {
    render(<PhraseBox {...requiredProps()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('tw:hover:bg-muted/30');
  });

  it('renders multiple tokens in order', () => {
    render(<PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />);

    const tokens = document.querySelectorAll('[data-testid^="token-"]');
    expect(tokens[0]).toHaveAttribute('data-testid', 'token-token-1');
    expect(tokens[1]).toHaveAttribute('data-testid', 'token-token-2');
  });

  it('passes the gloss for each token from the glosses map', () => {
    render(
      <PhraseBox
        {...requiredProps()}
        tokens={[TEST_TOKEN, TEST_TOKEN_2]}
        glosses={{ 'token-1': 'hello', 'token-2': 'world' }}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Gloss for World' })).toHaveValue('world');
  });

  it('passes an undefined gloss when the token id is absent from the glosses map', () => {
    render(<PhraseBox {...requiredProps()} glosses={{}} />);

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('');
  });

  it('calls onGlossChange with the token id and new value when a gloss input changes', async () => {
    const handleGlossChange = jest.fn();
    render(
      <PhraseBox
        {...requiredProps()}
        glosses={{ 'token-1': '' }}
        onGlossChange={handleGlossChange}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for Hello' }), 'hi');

    expect(handleGlossChange).toHaveBeenCalledTimes(2);
    expect(handleGlossChange).toHaveBeenNthCalledWith(1, 'token-1', 'h');
    expect(handleGlossChange).toHaveBeenNthCalledWith(2, 'token-1', 'i');
  });

  it('calls onClick with index when a gloss input receives focus', async () => {
    const handleClick = jest.fn();
    render(<PhraseBox {...requiredProps()} onClick={handleClick} index={2} />);

    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for Hello' }));

    expect(handleClick).toHaveBeenCalledWith(2);
  });

  it('button always has tabIndex -1 so tab focus goes only to gloss inputs', () => {
    render(<PhraseBox {...requiredProps()} />);

    expect(screen.getByRole('button')).toHaveAttribute('tabindex', '-1');
  });

  it('applies base spacing classes to the button', () => {
    render(<PhraseBox {...requiredProps()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('tw:px-1');
    expect(button).toHaveClass('tw:py-0.5');
  });

  describe('non-interactive (no onClick)', () => {
    it('renders as a span when onClick is not provided', () => {
      render(<PhraseBox {...nonInteractiveProps()} />);

      const phraseBox = document.querySelector('[data-phrase-box="true"]');
      expect(phraseBox?.tagName).toBe('SPAN');
    });

    it('applies focused styling to the span when isFocused is true', () => {
      render(<PhraseBox {...nonInteractiveProps()} isFocused />);

      const phraseBox = document.querySelector('[data-phrase-box="true"]');
      expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
      expect(phraseBox).toHaveClass('tw:border-2');
      expect(phraseBox).toHaveClass('tw:border-white');
    });

    it('applies default styling to the span when isFocused is false', () => {
      render(<PhraseBox {...nonInteractiveProps()} isFocused={false} />);

      const phraseBox = document.querySelector('[data-phrase-box="true"]');
      expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
      expect(phraseBox).toHaveClass('tw:border');
      expect(phraseBox).toHaveClass('tw:border-border/40');
    });
  });
});
