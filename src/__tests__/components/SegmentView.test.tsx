/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { SegmentView } from '../../components/SegmentView';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode }>) {
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
        <span key={t.ref}>
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
  focusedTokenRef: string | undefined;
  isActive: boolean;
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  segment: Segment;
} {
  return {
    displayMode: 'token-chip',
    focusedTokenRef: undefined,
    isActive: false,
    onSelect: jest.fn(),
    segment: WORD_SEGMENT,
  };
}

describe('SegmentView', () => {
  it('renders word token chips in token-chip mode (default)', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    const { container } = render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} isActive />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is omitted', () => {
    const { container } = render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="true" on the baseline-text button when isActive is true', () => {
    const { container } = render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" isActive />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('calls onSelect with the verse ref and token id when a word token is clicked', async () => {
    const handleSelect = jest.fn();
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} onSelect={handleSelect} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'In' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(
      <AnalysisStoreProvider>
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
  });
});
