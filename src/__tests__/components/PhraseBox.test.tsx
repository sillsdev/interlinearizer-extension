/** @file Unit tests for PhraseBox component. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { GlossStoreProvider } from '../../components/GlossStore';
import { PhraseBox } from '../../components/PhraseBox';

// ---------------------------------------------------------------------------
// GlossStore mock — reactive useState-based stub so GlossStore.tsx stays out of scope
// ---------------------------------------------------------------------------

jest.mock('../../components/GlossStore', () => {
  const { createContext, useCallback, useContext, useMemo, useState } =
    jest.requireActual<typeof import('react')>('react');

  type GlossMap = Record<string, string>;
  type MockCtxValue = {
    glosses: GlossMap;
    dispatch: (tokenId: string, value: string) => void;
  };
  const MockCtx = createContext<MockCtxValue>({ glosses: {}, dispatch: () => {} });

  return {
    __esModule: true,
    GlossStoreProvider({
      children,
      initialGlosses,
      onGlossChange,
    }: Readonly<{
      children: ReactNode;
      initialGlosses?: GlossMap;
      onGlossChange?: (tokenId: string, value: string) => void;
    }>) {
      const [glosses, setGlosses] = useState<GlossMap>(initialGlosses ?? {});
      const dispatch = useCallback(
        (tokenId: string, value: string) => {
          setGlosses((prev) => ({ ...prev, [tokenId]: value }));
          onGlossChange?.(tokenId, value);
        },
        [onGlossChange],
      );
      const ctx = useMemo(() => ({ glosses, dispatch }), [glosses, dispatch]);
      return <MockCtx value={ctx}>{children}</MockCtx>;
    },
    useGloss(tokenId: string) {
      return useContext(MockCtx).glosses[tokenId] ?? '';
    },
    useGlossDispatch() {
      return useContext(MockCtx).dispatch;
    },
  };
});

jest.mock('../../components/TokenChip', () => {
  const { useGloss, useGlossDispatch } = jest.requireMock<
    typeof import('../../components/GlossStore')
  >('../../components/GlossStore');
  function MockTokenChip({ onFocus, token }: Readonly<{ onFocus?: () => void; token: Token }>) {
    const gloss = useGloss(token.id);
    const dispatch = useGlossDispatch();
    return (
      <span data-testid={`token-${token.id}`}>
        {token.surfaceText}
        <input
          aria-label={`Gloss for ${token.surfaceText}`}
          onChange={(e) => dispatch(token.id, e.target.value)}
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
  id: 'token-1',
  surfaceText: 'Hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/** Second test token */
const TEST_TOKEN_2 = {
  id: 'token-2',
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
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('LABEL');
  });

  it('renders one TokenChip per token in the tokens array', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </GlossStoreProvider>,
    );

    expect(screen.getByTestId('token-token-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-token-2')).toBeInTheDocument();
  });

  it('clicking the outer container focuses the first gloss input', async () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    await userEvent.click(phraseBox ?? document.body);

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveFocus();
  });

  it('applies focused border and background when isFocused is true', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} isFocused />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBox).toHaveClass('tw:border-2');
    expect(phraseBox).toHaveClass('tw:border-white');
    expect(phraseBox).toHaveClass('tw:bg-muted/30');
  });

  it('applies default border and background when isFocused is false', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} isFocused={false} />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBox).toHaveClass('tw:border');
    expect(phraseBox).toHaveClass('tw:border-border/40');
    expect(phraseBox).toHaveClass('tw:bg-muted/20');
  });

  it('phrase box does not override cursor on gap areas', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} isFocused />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).not.toHaveClass('tw:cursor-text');
  });

  it('renders tokens in the order they appear in the tokens array', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </GlossStoreProvider>,
    );

    const tokens = document.querySelectorAll('[data-testid^="token-"]');
    expect(tokens[0]).toHaveAttribute('data-testid', 'token-token-1');
    expect(tokens[1]).toHaveAttribute('data-testid', 'token-token-2');
  });

  it('passes the gloss for each token from the store', () => {
    render(
      <GlossStoreProvider initialGlosses={{ 'token-1': 'hello', 'token-2': 'world' }}>
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </GlossStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Gloss for World' })).toHaveValue('world');
  });

  it('shows an empty string when the token id is absent from the store', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} />
      </GlossStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('');
  });

  it('updates the store when a gloss input changes', async () => {
    const spy = jest.fn();
    render(
      <GlossStoreProvider onGlossChange={spy}>
        <PhraseBox {...requiredProps()} />
      </GlossStoreProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for Hello' }), 'hi');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'token-1', 'h');
    expect(spy).toHaveBeenNthCalledWith(2, 'token-1', 'hi');
  });

  it('calls onFocusPhrase with index when a gloss input receives focus', async () => {
    const handleFocus = jest.fn();
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} onFocusPhrase={handleFocus} index={2} />
      </GlossStoreProvider>,
    );

    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for Hello' }));

    expect(handleFocus).toHaveBeenCalledWith(2);
  });

  it('phrase box always has padding and gap spacing classes', () => {
    render(
      <GlossStoreProvider>
        <PhraseBox {...requiredProps()} />
      </GlossStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveClass('tw:px-1');
    expect(phraseBox).toHaveClass('tw:py-0.5');
  });
});
