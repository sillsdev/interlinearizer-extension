/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { GlossStoreProvider } from '../../components/GlossStore';
import { SegmentView } from '../../components/SegmentView';

// ---------------------------------------------------------------------------
// GlossStore mock — pass-through provider so GlossStore.tsx stays out of scope
// ---------------------------------------------------------------------------

jest.mock('../../components/GlossStore', () => ({
  __esModule: true,
  GlossStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
}));

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  MemoizedInertTokenChip({ token }: Readonly<{ token: Token }>) {
    return <span>{token.surfaceText}</span>;
  },
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    index,
    isFocused = false,
    onFocusPhrase,
    tokens,
  }: Readonly<{
    index?: number;
    isFocused: boolean;
    onFocusPhrase?: (index?: number) => void;
    tokens: Token[];
  }>) => (
    <span data-focus-state={isFocused ? 'focused' : 'default'}>
      {tokens.map((t) => (
        <span key={t.id}>
          {onFocusPhrase ? (
            <button onClick={() => onFocusPhrase(index)} type="button">
              {t.surfaceText}
            </button>
          ) : (
            <span>{t.surfaceText}</span>
          )}
        </span>
      ))}
    </span>
  ),
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
  displayMode: 'token-chip';
  focusedTokenId: string | undefined;
  isActive: boolean;
  onSelect: (ref: ScriptureRef, tokenId?: string) => void;
  segment: Segment;
} {
  return {
    displayMode: 'token-chip',
    focusedTokenId: undefined,
    isActive: false,
    onSelect: jest.fn(),
    segment: WORD_SEGMENT,
  };
}

describe('SegmentView', () => {
  it('renders word token chips in token-chip mode (default)', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} />
      </GlossStoreProvider>,
    );

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} />
      </GlossStoreProvider>,
    );

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </GlossStoreProvider>,
    );

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </GlossStoreProvider>,
    );

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} />
      </GlossStoreProvider>,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    const { container } = render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} isActive />
      </GlossStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is omitted', () => {
    const { container } = render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} />
      </GlossStoreProvider>,
    );

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="true" on the baseline-text button when isActive is true', () => {
    const { container } = render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" isActive />
      </GlossStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />
      </GlossStoreProvider>,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('calls onSelect with the verse ref and token id when a word token is clicked', async () => {
    const handleSelect = jest.fn();
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} onSelect={handleSelect} />
      </GlossStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'In' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(
      <GlossStoreProvider>
        <SegmentView {...requiredProps()} />
      </GlossStoreProvider>,
    );

    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
  });
});
