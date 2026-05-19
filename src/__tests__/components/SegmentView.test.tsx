/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { SegmentView } from '../../components/SegmentView';

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    glosses,
    isFocused = false,
    onClick,
    onGlossChange,
    tokens,
  }: {
    glosses: Record<string, string>;
    isFocused: boolean;
    onClick?: () => void;
    onGlossChange: (tokenId: string, value: string) => void;
    tokens: Token[];
  }) => (
    <span data-focus-state={isFocused ? 'focused' : 'default'}>
      {tokens.map((t) => (
        <span key={t.id}>
          {onClick ? (
            <button onClick={onClick} type="button">
              {t.surfaceText}
            </button>
          ) : (
            <span>{t.surfaceText}</span>
          )}
          <input
            aria-label={`Gloss for ${t.surfaceText}`}
            onChange={(e) => onGlossChange?.(t.id, e.target.value)}
            value={glosses?.[t.id] ?? ''}
          />
        </span>
      ))}
    </span>
  ),
}));

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  default: ({ token }: { token: Token }) => <span>{token.surfaceText}</span>,
  TokenChip: ({ token }: { token: Token }) => <span>{token.surfaceText}</span>,
}));

/** A word token segment. */
const WORD_SEGMENT: Segment = {
  id: 'GEN 1:1',
  startRef: { book: 'GEN', chapter: 1, verse: 1 },
  endRef: { book: 'GEN', chapter: 1, verse: 1 },
  baselineText: 'In the beginning.',
  tokens: [
    {
      ref: 'tok-0',
      surfaceText: 'In',
      writingSystem: 'en',
      type: 'word',
      charStart: 0,
      charEnd: 2,
    },
    {
      ref: 'tok-1',
      surfaceText: 'the',
      writingSystem: 'en',
      type: 'word',
      charStart: 3,
      charEnd: 6,
    },
  ],
};

/** A segment with a single punctuation (non-word) token. */
const PUNCT_SEGMENT: Segment = {
  id: 'GEN 1:2',
  startRef: { book: 'GEN', chapter: 1, verse: 2 },
  endRef: { book: 'GEN', chapter: 1, verse: 2 },
  baselineText: '.',
  tokens: [
    {
      ref: 'tok-p',
      surfaceText: '.',
      writingSystem: 'en',
      type: 'punctuation',
      charStart: 0,
      charEnd: 1,
    },
  ],
};

/**
 * Minimal required props for SegmentView. Spread into render calls so tests only need to override
 * what they actually care about.
 *
 * @returns An object containing all required SegmentView props set to no-op stubs.
 */
function requiredProps(): {
  glosses: Record<string, string>;
  onGlossChange: (tokenId: string, value: string) => void;
  onSelect: (ref: ScriptureRef, tokenId?: string) => void;
  segment: Segment;
} {
  return {
    glosses: {},
    onGlossChange: jest.fn(),
    onSelect: jest.fn(),
    segment: WORD_SEGMENT,
  };
}

describe('SegmentView', () => {
  it('renders word token chips in token-chip mode (default)', () => {
    render(<SegmentView {...requiredProps()} />);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(<SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} />);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />);

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />);

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(<SegmentView {...requiredProps()} />);

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    const { container } = render(<SegmentView {...requiredProps()} isActive />);

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is false', () => {
    const { container } = render(<SegmentView {...requiredProps()} isActive={false} />);

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('does not set aria-current when isActive is omitted', () => {
    const { container } = render(<SegmentView {...requiredProps()} />);

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('does not set aria-current on the baseline-text button when isActive is false', () => {
    const { container } = render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" isActive={false} />,
    );

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="true" on the baseline-text button when isActive is true', () => {
    const { container } = render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" isActive />,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('calls onSelect with the verse ref and token id when a word token is clicked', async () => {
    const handleSelect = jest.fn();
    render(<SegmentView {...requiredProps()} onSelect={handleSelect} />);

    await userEvent.click(screen.getByRole('button', { name: 'In' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(<SegmentView {...requiredProps()} />);

    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
  });

  it('passes glosses to word token inputs', () => {
    render(<SegmentView {...requiredProps()} glosses={{ 'tok-0': 'In', 'tok-1': 'the' }} />);

    expect(screen.getByRole('textbox', { name: 'Gloss for In' })).toHaveValue('In');
    expect(screen.getByRole('textbox', { name: 'Gloss for the' })).toHaveValue('the');
  });

  it('calls onGlossChange with the token id and new value when a gloss changes', async () => {
    const handleGlossChange = jest.fn();
    render(
      <SegmentView
        {...requiredProps()}
        glosses={{ 'tok-0': '' }}
        onGlossChange={handleGlossChange}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for In' }), 'In');

    expect(handleGlossChange).toHaveBeenCalledTimes(2);
    expect(handleGlossChange).toHaveBeenNthCalledWith(1, 'tok-0', 'I');
    expect(handleGlossChange).toHaveBeenNthCalledWith(2, 'tok-0', 'n');
  });
});
