/** @file Unit tests for components/TokenChip.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { InertTokenChip, TokenChip } from '../../components/TokenChip';

// ---------------------------------------------------------------------------
// AnalysisStore mock — reactive useState-based stub so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

jest.mock('../../components/AnalysisStore', () => {
  const { createContext, useCallback, useContext, useMemo, useState } =
    jest.requireActual<typeof import('react')>('react');

  type GlossMap = Record<string, string>;
  type MockCtxValue = {
    glosses: GlossMap;
    dispatch: (tokenRef: string, surfaceText: string, value: string) => void;
  };
  const MockCtx = createContext<MockCtxValue>({ glosses: {}, dispatch: () => {} });

  return {
    __esModule: true,
    AnalysisStoreProvider({
      children,
      initialAnalysis,
      onGlossChange,
    }: Readonly<{
      children: ReactNode;
      initialAnalysis?: {
        tokenAnalyses: { id: string; gloss?: GlossMap }[];
        tokenAnalysisLinks: { analysisId: string; status: string; token: { tokenRef: string } }[];
      };
      onGlossChange?: (tokenRef: string, value: string) => void;
    }>) {
      const byId = new Map((initialAnalysis?.tokenAnalyses ?? []).map((ta) => [ta.id, ta]));
      const seed: GlossMap = (initialAnalysis?.tokenAnalysisLinks ?? [])
        .filter((link) => link.status === 'approved')
        .reduce((acc, link) => {
          const gloss = byId.get(link.analysisId)?.gloss?.en;
          return gloss === undefined ? acc : { ...acc, [link.token.tokenRef]: gloss };
        }, {});
      const [glosses, setGlosses] = useState<GlossMap>(seed);
      const dispatch = useCallback(
        (tokenRef: string, _surfaceText: string, value: string) => {
          setGlosses((prev) => ({ ...prev, [tokenRef]: value }));
          onGlossChange?.(tokenRef, value);
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
  ref: 'GEN 1:1:0',
  surfaceText: 'hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/**
 * Minimal required props for {@link TokenChip}. Spread into render calls so tests only need to
 * override what they actually care about.
 *
 * @returns An object with all required props set to no-op stubs.
 */
function requiredProps(): { token: Token & { type: 'word' }; onFocus: () => void } {
  return {
    token: WORD_TOKEN,
    onFocus: jest.fn(),
  };
}

const PUNCT_TOKEN = {
  ref: 'GEN 1:1:p',
  surfaceText: '.',
  writingSystem: 'en',
  type: 'punctuation',
  charStart: 5,
  charEnd: 6,
} satisfies Token;

describe('InertTokenChip', () => {
  it('renders the surface text', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders as an inline span', () => {
    render(<InertTokenChip token={PUNCT_TOKEN} />);
    expect(screen.getByText('.').tagName).toBe('SPAN');
  });
});

describe('TokenChip', () => {
  it('renders the surface text', () => {
    render(
      <AnalysisStoreProvider>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies a border class to the outer container', () => {
    render(
      <AnalysisStoreProvider>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    const outer = screen.getByText('hello').closest('span')?.parentElement;
    expect(outer?.className).toContain('tw:border');
  });

  it('renders a gloss input', () => {
    render(
      <AnalysisStoreProvider>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toBeInTheDocument();
  });

  it('shows the current gloss value from the store', () => {
    const initialAnalysis = {
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'hello', gloss: { en: 'in' } }],
      tokenAnalysisLinks: [
        {
          analysisId: 'ta-1',
          status: 'approved' as const,
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
        },
      ],
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={initialAnalysis}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('in');
  });

  it('shows an empty string in the input when no gloss has been set', () => {
    render(
      <AnalysisStoreProvider>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Gloss for hello' })).toHaveValue('');
  });

  it('calls the store onGlossChange spy with tokenId and value for each keystroke', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider onGlossChange={spy}>
        <TokenChip {...requiredProps()} />
      </AnalysisStoreProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for hello' }), 'in');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'GEN 1:1:0', 'i');
    expect(spy).toHaveBeenNthCalledWith(2, 'GEN 1:1:0', 'in');
  });

  it('calls onFocus when the input is focused', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider>
        <TokenChip {...requiredProps()} onFocus={handleFocus} />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for hello' }));
    expect(handleFocus).toHaveBeenCalledTimes(1);
  });
});
