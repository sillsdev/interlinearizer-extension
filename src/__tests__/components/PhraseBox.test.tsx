/** @file Unit tests for PhraseBox component. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import PhraseBox from '../../components/PhraseBox';

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  default: ({ token }: { token: Token }) => (
    <span data-testid={`token-${token.id}`}>{token.surfaceText}</span>
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

describe('PhraseBox', () => {
  it('renders as a span when no onClick handler is provided', () => {
    render(<PhraseBox tokens={[TEST_TOKEN]} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('SPAN');
  });

  it('renders as a button when onClick handler is provided', () => {
    const mockOnClick = jest.fn();
    render(<PhraseBox tokens={[TEST_TOKEN]} onClick={mockOnClick} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('BUTTON');
    expect(phraseBox).toHaveAttribute('type', 'button');
  });

  it('renders tokens using TokenChip components', () => {
    render(<PhraseBox tokens={[TEST_TOKEN, TEST_TOKEN_2]} />);

    expect(screen.getByTestId('token-token-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-token-2')).toBeInTheDocument();
  });

  it('calls onClick when button is clicked', async () => {
    const mockOnClick = jest.fn();
    render(<PhraseBox tokens={[TEST_TOKEN]} onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('applies focused styling when isFocused is true', () => {
    render(<PhraseBox tokens={[TEST_TOKEN]} isFocused />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBox).toHaveClass('tw-border-2');
  });

  it('applies default styling when isFocused is false', () => {
    render(<PhraseBox tokens={[TEST_TOKEN]} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBox).not.toHaveClass('tw-border-2');
  });

  it('applies default styling when isFocused is not provided', () => {
    render(<PhraseBox tokens={[TEST_TOKEN]} />);

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
  });

  it('button has correct focused styling and cursor', () => {
    const mockOnClick = jest.fn();
    render(<PhraseBox tokens={[TEST_TOKEN]} onClick={mockOnClick} isFocused />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-focus-state', 'focused');
    expect(button).toHaveClass('tw-cursor-pointer');
    expect(button).toHaveClass('tw-text-left');
  });

  it('button has hover styling', () => {
    const mockOnClick = jest.fn();
    render(<PhraseBox tokens={[TEST_TOKEN]} onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('hover:tw-bg-muted/30');
  });

  it('renders multiple tokens in order', () => {
    render(<PhraseBox tokens={[TEST_TOKEN, TEST_TOKEN_2]} />);

    const tokens = document.querySelectorAll('[data-testid^="token-"]');
    expect(tokens[0]).toHaveAttribute('data-testid', 'token-token-1');
    expect(tokens[1]).toHaveAttribute('data-testid', 'token-token-2');
  });

  it('applies base spacing classes to both button and span', () => {
    const { rerender } = render(<PhraseBox tokens={[TEST_TOKEN]} />);

    const span = document.querySelector('[data-phrase-box="true"]');
    expect(span).toHaveClass('tw-px-1');
    expect(span).toHaveClass('tw-py-0.5');

    const mockOnClick = jest.fn();
    rerender(<PhraseBox tokens={[TEST_TOKEN]} onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('tw-px-1');
    expect(button).toHaveClass('tw-py-0.5');
  });
});
