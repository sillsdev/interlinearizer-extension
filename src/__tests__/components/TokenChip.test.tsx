/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import { TokenChip } from '../../components/TokenChip';

const WORD_TOKEN: Token = {
  ref: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
};

const PUNCT_TOKEN: Token = {
  ref: 'GEN 1:1:5',
  surfaceText: '.',
  writingSystem: 'en',
  type: 'punctuation',
  charStart: 5,
  charEnd: 6,
};

describe('TokenChip', () => {
  it('renders the surface text for a word token', () => {
    render(<TokenChip token={WORD_TOKEN} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the surface text for a punctuation token', () => {
    render(<TokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('applies a border class to word tokens', () => {
    render(<TokenChip token={WORD_TOKEN} />);
    // The outer container holds the border; the inner span is just the surface text
    const outer = screen.getByText('hello').closest('span')?.parentElement;
    expect(outer?.className).toContain('tw:border');
  });

  it('does not apply a border class to punctuation tokens', () => {
    render(<TokenChip token={PUNCT_TOKEN} />);
    const span = screen.getByText('.');
    expect(span.className).not.toContain('tw:border');
  });

  it('renders word and punctuation tokens as inline spans', () => {
    const { container: wc } = render(<TokenChip token={WORD_TOKEN} />);
    const { container: pc } = render(<TokenChip token={PUNCT_TOKEN} />);
    expect(wc.querySelector('span')).toBeInTheDocument();
    expect(pc.querySelector('span')).toBeInTheDocument();
  });

  it('renders a gloss input for word tokens', () => {
    render(<TokenChip token={WORD_TOKEN} />);
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toBeInTheDocument();
  });

  it('does not render a gloss input for punctuation tokens', () => {
    render(<TokenChip token={PUNCT_TOKEN} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the current gloss value in the input', () => {
    render(<TokenChip token={WORD_TOKEN} gloss="in" />);
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('in');
  });

  it('shows an empty input when no gloss is provided', () => {
    render(<TokenChip token={WORD_TOKEN} />);
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('');
  });

  it('calls onGlossChange for each keystroke', async () => {
    const handleChange = jest.fn();
    render(<TokenChip token={WORD_TOKEN} onGlossChange={handleChange} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    expect(handleChange).toHaveBeenCalledTimes(2);
    expect(handleChange).toHaveBeenNthCalledWith(1, 'i');
    expect(handleChange).toHaveBeenNthCalledWith(2, 'in');
  });

  it('does not throw when onGlossChange is omitted and the user types', async () => {
    render(<TokenChip token={WORD_TOKEN} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    // No assertion needed — test passes if no error is thrown
  });

  it('calls onFocus when the input is focused', async () => {
    const handleFocus = jest.fn();
    render(<TokenChip token={WORD_TOKEN} onFocus={handleFocus} />);
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onFocus is omitted', async () => {
    render(<TokenChip token={WORD_TOKEN} />);
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    await userEvent.tab();
    // No assertion needed — test passes if no error is thrown
  });
});
