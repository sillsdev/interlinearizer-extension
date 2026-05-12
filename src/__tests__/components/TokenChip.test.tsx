/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import type { Token } from 'interlinearizer';
import { TokenChip } from '../../components/TokenChip';

const WORD_TOKEN: Token = {
  id: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
};

const PUNCT_TOKEN: Token = {
  id: 'GEN 1:1:5',
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
    const span = screen.getByText('hello');
    expect(span.className).toContain('tw-border');
  });

  it('does not apply a border class to punctuation tokens', () => {
    render(<TokenChip token={PUNCT_TOKEN} />);
    const span = screen.getByText('.');
    expect(span.className).not.toContain('tw-border');
  });

  it('renders word and punctuation tokens as inline spans', () => {
    const { container: wc } = render(<TokenChip token={WORD_TOKEN} />);
    const { container: pc } = render(<TokenChip token={PUNCT_TOKEN} />);
    expect(wc.querySelector('span')).toBeInTheDocument();
    expect(pc.querySelector('span')).toBeInTheDocument();
  });
});
