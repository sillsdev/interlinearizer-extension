/** @file Unit tests for components/AnalysisStore.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import {
  AnalysisStoreProvider,
  useAnalysis,
  useGloss,
  useGlossDispatch,
} from '../../components/AnalysisStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal `TextAnalysis` with a single approved `TokenAnalysis` for the given token.
 *
 * @param tokenRef - Token reference string.
 * @param gloss - Gloss value for the `'und'` language key.
 * @param surfaceText - Surface text of the token.
 * @returns A `TextAnalysis` seeded with one approved token analysis.
 */
function makeAnalysisWithGloss(
  tokenRef: string,
  gloss: string,
  surfaceText = 'word',
): TextAnalysis {
  const ta: TokenAnalysis = {
    id: `${tokenRef}-analysis`,
    surfaceText,
    gloss: { und: gloss },
  };
  const link: TokenAnalysisLink = {
    analysisId: ta.id,
    status: 'approved',
    token: { tokenRef, surfaceText },
  };
  return {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [link],
    phraseAnalyses: [],
    phraseAnalysisLinks: [],
  };
}

/**
 * Renders a component that displays the gloss for a single token, used to assert on `useGloss`.
 *
 * @param tokenRef - Token ref to subscribe to.
 * @returns JSX element suitable for passing to `render`.
 */
function GlossReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const gloss = useGloss(tokenRef);
  return <span data-testid="gloss">{gloss}</span>;
}

/**
 * Renders a component that displays the full analysis as JSON, used to assert on `useAnalysis`.
 *
 * @returns JSX element suitable for passing to `render`.
 */
function AnalysisReader() {
  const analysis = useAnalysis();
  return <span data-testid="analysis">{JSON.stringify(analysis)}</span>;
}

/**
 * Renders a component that calls `useGlossDispatch` without a provider, used to assert the hook
 * throws outside an {@link AnalysisStoreProvider}.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function DispatchUser() {
  useGlossDispatch();
  return undefined;
}

/**
 * Renders a button that calls `useGlossDispatch` to write a gloss, used to test dispatch.
 *
 * @param props.tokenRef - Token ref to write.
 * @param props.surfaceText - Surface text of the token.
 * @param props.value - Gloss value to write.
 * @returns JSX element suitable for passing to `render`.
 */
function GlossWriter({
  tokenRef,
  surfaceText,
  value,
}: Readonly<{ tokenRef: string; surfaceText: string; value: string }>) {
  const dispatch = useGlossDispatch();
  return (
    <button onClick={() => dispatch(tokenRef, surfaceText, value)} type="button">
      write
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGloss', () => {
  it('returns an empty string for an unknown token', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <GlossReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('');
  });

  it('returns the approved gloss from initialAnalysis', () => {
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'hello')}
        analysisLanguage="und"
      >
        <GlossReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('hello');
  });

  it('returns empty string for a token with a non-approved link in initialAnalysis', () => {
    const ta: TokenAnalysis = { id: 'ta-1', surfaceText: 'word', gloss: { en: 'hi' } };
    const link: TokenAnalysisLink = {
      analysisId: 'ta-1',
      status: 'suggested',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const analysis: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [ta],
      tokenAnalysisLinks: [link],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={analysis} analysisLanguage="und">
        <GlossReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('');
  });

  it('updates when the subscribed token is glossed via dispatch', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <GlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="world" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(screen.getByTestId('gloss')).toHaveTextContent('world');
  });

  it('does not re-render when a different token is glossed', async () => {
    let renderCount = 0;

    function CountingGlossReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
      renderCount += 1;
      const gloss = useGloss(tokenRef);
      return <span data-testid="gloss">{gloss}</span>;
    }

    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <CountingGlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-2" surfaceText="other" value="other" />
      </AnalysisStoreProvider>,
    );
    const initialRenderCount = renderCount;
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(renderCount).toBe(initialRenderCount);
  });

  it('uses the analysisLanguage prop to resolve the gloss', () => {
    const ta: TokenAnalysis = { id: 'ta-1', surfaceText: 'mot', gloss: { fr: 'bonjour' } };
    const link: TokenAnalysisLink = {
      analysisId: 'ta-1',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'mot' },
    };
    const analysis: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [ta],
      tokenAnalysisLinks: [link],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={analysis} analysisLanguage="fr">
        <GlossReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('gloss')).toHaveTextContent('bonjour');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<GlossReader tokenRef="tok-1" />)).toThrow(
      'useGloss must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useAnalysis', () => {
  it('returns an empty analysis when no initialAnalysis is provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <AnalysisReader />
      </AnalysisStoreProvider>,
    );
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(0);
    expect(analysis.tokenAnalysisLinks).toHaveLength(0);
  });

  it('returns seeded analyses from initialAnalysis', () => {
    const seed = makeAnalysisWithGloss('tok-1', 'hi');
    render(
      <AnalysisStoreProvider initialAnalysis={seed} analysisLanguage="und">
        <AnalysisReader />
      </AnalysisStoreProvider>,
    );
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(1);
    expect(analysis.tokenAnalysisLinks).toHaveLength(1);
  });

  it('updates after a gloss write', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <AnalysisReader />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="world" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(1);
    expect(analysis.tokenAnalyses[0].gloss).toStrictEqual({ und: 'world' });
    expect(analysis.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AnalysisReader />)).toThrow(
      'useAnalysis must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useGlossDispatch', () => {
  it('creates a new approved TokenAnalysis on each write', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <AnalysisReader />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="hi" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(2);
    expect(analysis.tokenAnalysisLinks).toHaveLength(2);
    analysis.tokenAnalysisLinks.forEach((link) => expect(link.status).toBe('approved'));
  });

  it('does not touch existing suggested analyses on write', async () => {
    const suggested: TokenAnalysis = {
      id: 'suggested-1',
      surfaceText: 'word',
      gloss: { en: 'old' },
    };
    const suggestedLink: TokenAnalysisLink = {
      analysisId: 'suggested-1',
      status: 'suggested',
      token: { tokenRef: 'tok-1', surfaceText: 'word' },
    };
    const seed: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [suggested],
      tokenAnalysisLinks: [suggestedLink],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider initialAnalysis={seed} analysisLanguage="und">
        <AnalysisReader />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="new" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(2);
    const suggestedEntry = analysis.tokenAnalysisLinks.find((l) => l.status === 'suggested');
    const approvedEntry = analysis.tokenAnalysisLinks.find((l) => l.status === 'approved');
    expect(suggestedEntry?.analysisId).toBe('suggested-1');
    expect(approvedEntry?.analysisId).not.toBe('suggested-1');
  });

  it('calls the onGlossChange spy with tokenRef and value', async () => {
    const spy = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onGlossChange={spy}>
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="hi" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('tok-1', 'hi');
  });

  it('calls onSave with the updated TextAnalysis', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onSave={onSave}>
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="hi" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses[0].gloss).toStrictEqual({ und: 'hi' });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DispatchUser />)).toThrow(
      'useGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});
