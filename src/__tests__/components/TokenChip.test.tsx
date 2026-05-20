/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { GlossStoreProvider } from '../../components/GlossStore';
import { TokenChip } from '../../components/TokenChip';

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

const WORD_TOKEN = {
  id: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

const PUNCT_TOKEN = {
  id: 'GEN 1:1:5',
  surfaceText: '.',
  writingSystem: 'en',
  type: 'punctuation',
  charStart: 5,
  charEnd: 6,
} satisfies Token;

/**
 * Minimal required props for a word-token `TokenChip`. Spread into render calls so tests only need
 * to override what they actually care about.
 *
 * @returns An object with all required word-token props set to no-op stubs.
 */
function requiredWordProps() {
  return {
    token: WORD_TOKEN,
    onFocus: jest.fn(),
  } as const;
}

describe('TokenChip', () => {
  it('renders the surface text for a word token', () => {
    render(
      <GlossStoreProvider>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the surface text for a punctuation token', () => {
    render(
      <GlossStoreProvider>
        <TokenChip token={PUNCT_TOKEN} />
      </GlossStoreProvider>,
    );
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('applies a border class to word tokens', () => {
    render(
      <GlossStoreProvider>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    // The outer container holds the border; the inner span is just the surface text
    const outer = screen.getByText('hello').closest('span')?.parentElement;
    expect(outer?.className).toContain('tw:border');
  });

  it('does not apply a border class to punctuation tokens', () => {
    render(
      <GlossStoreProvider>
        <TokenChip token={PUNCT_TOKEN} />
      </GlossStoreProvider>,
    );
    const span = screen.getByText('.');
    expect(span.className).not.toContain('tw:border');
  });

  it('renders a gloss input for word tokens', () => {
    render(
      <GlossStoreProvider>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toBeInTheDocument();
  });

  it('does not render a gloss input for punctuation tokens', () => {
    render(
      <GlossStoreProvider>
        <TokenChip token={PUNCT_TOKEN} />
      </GlossStoreProvider>,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the current gloss value from the store', () => {
    render(
      <GlossStoreProvider initialGlosses={{ 'GEN 1:1:0': 'in' }}>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('in');
  });

  it('shows an empty string in the input when no gloss has been set', () => {
    render(
      <GlossStoreProvider>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('');
  });

  it('calls the store onGlossChange spy with tokenId and value for each keystroke', async () => {
    const spy = jest.fn();
    render(
      <GlossStoreProvider onGlossChange={spy}>
        <TokenChip {...requiredWordProps()} />
      </GlossStoreProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'GEN 1:1:0', 'i');
    expect(spy).toHaveBeenNthCalledWith(2, 'GEN 1:1:0', 'in');
  });

  it('calls onFocus when the input is focused', async () => {
    const handleFocus = jest.fn();
    render(
      <GlossStoreProvider>
        <TokenChip {...requiredWordProps()} onFocus={handleFocus} />
      </GlossStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });
});
