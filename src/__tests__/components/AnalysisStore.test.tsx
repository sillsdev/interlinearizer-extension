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
  usePhraseLinkForToken,
  usePhraseLinkMap,
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
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

    /**
     * Renders the current gloss for a token while counting how many times it re-renders, so tests
     * can assert that unrelated gloss changes do not cause extra renders.
     *
     * @param props - Component props.
     * @param props.tokenRef - The token whose approved gloss to read via {@link useGloss}.
     * @returns A span containing the gloss string.
     * @throws When called outside an {@link AnalysisStoreProvider}.
     */
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
  it('replaces the existing approved analysis on subsequent writes for the same token', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <AnalysisReader />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="hi" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(1);
    expect(analysis.tokenAnalysisLinks).toHaveLength(1);
    expect(analysis.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('creates a new approved analysis when writing to a different token', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <AnalysisReader />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="hi" />
        <GlossWriter tokenRef="tok-2" surfaceText="other" value="bye" />
      </AnalysisStoreProvider>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'write' })[0]);
    await userEvent.click(screen.getAllByRole('button', { name: 'write' })[1]);
    const analysis: TextAnalysis = JSON.parse(screen.getByTestId('analysis').textContent ?? '');
    expect(analysis.tokenAnalyses).toHaveLength(2);
    expect(analysis.tokenAnalysisLinks).toHaveLength(2);
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

// ---------------------------------------------------------------------------
// Phrase hooks
// ---------------------------------------------------------------------------

/** Approved phrase analysis seed used across phrase hook tests. */
const PHRASE_ANALYSIS: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [{ id: 'phrase-1', surfaceText: 'Hello World' }],
  phraseAnalysisLinks: [
    {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-a', surfaceText: 'Hello' },
        { tokenRef: 'tok-b', surfaceText: 'World' },
      ],
    },
  ],
};

/**
 * Renders a component that displays the phrase link map size, used to assert `usePhraseLinkMap`.
 *
 * @returns JSX element suitable for passing to `render`.
 */
function PhraseLinkMapReader() {
  const map = usePhraseLinkMap();
  return <span data-testid="map-size">{map.size}</span>;
}

/**
 * Renders a component that displays the phrase link analysisId for a given token ref, used to
 * assert `usePhraseLinkForToken`.
 *
 * @param props - Component props.
 * @param props.tokenRef - Token ref to look up.
 * @returns JSX element suitable for passing to `render`.
 */
function PhraseLinkReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const link = usePhraseLinkForToken(tokenRef);
  return <span data-testid="link-id">{link?.analysisId ?? 'none'}</span>;
}

/**
 * Renders buttons that exercise `usePhraseDispatch`, used to assert phrase dispatch callbacks.
 *
 * @param props - Component props.
 * @param props.phraseId - The phrase id to use for update and delete operations.
 * @returns JSX element suitable for passing to `render`.
 */
function PhraseDispatchUser({ phraseId }: Readonly<{ phraseId: string }>) {
  const { createPhrase, updatePhrase, deletePhrase } = usePhraseDispatch();
  return (
    <>
      <button onClick={() => createPhrase([{ tokenRef: 'tok-x', surfaceText: 'X' }])} type="button">
        create
      </button>
      <button
        onClick={() => updatePhrase(phraseId, [{ tokenRef: 'tok-a', surfaceText: 'A' }])}
        type="button"
      >
        update
      </button>
      <button onClick={() => deletePhrase(phraseId)} type="button">
        delete
      </button>
    </>
  );
}

/**
 * Renders a component that calls `usePhraseLinkMap` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function PhraseLinkMapUser() {
  usePhraseLinkMap();
  return undefined;
}

/**
 * Renders a component that calls `usePhraseLinkForToken` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function PhraseLinkForTokenUser() {
  usePhraseLinkForToken('tok-1');
  return undefined;
}

/**
 * Renders a component that calls `usePhraseDispatch` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function PhraseDispatchOutsideProvider() {
  usePhraseDispatch();
  return undefined;
}

describe('usePhraseLinkMap', () => {
  it('returns an empty map when no approved phrase links exist', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseLinkMapReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('map-size')).toHaveTextContent('0');
  });

  it('returns a map with entries for each token in approved phrase links', () => {
    render(
      <AnalysisStoreProvider initialAnalysis={PHRASE_ANALYSIS} analysisLanguage="und">
        <PhraseLinkMapReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('map-size')).toHaveTextContent('2');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseLinkMapUser />)).toThrow(
      'usePhraseLinkMap must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('usePhraseLinkForToken', () => {
  it('returns undefined for a token not in any phrase', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseLinkReader tokenRef="tok-unknown" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('link-id')).toHaveTextContent('none');
  });

  it('returns the approved phrase link for a token that belongs to a phrase', () => {
    render(
      <AnalysisStoreProvider initialAnalysis={PHRASE_ANALYSIS} analysisLanguage="und">
        <PhraseLinkReader tokenRef="tok-a" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('link-id')).toHaveTextContent('phrase-1');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseLinkForTokenUser />)).toThrow(
      'usePhraseLinkForToken must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('usePhraseDispatch', () => {
  it('createPhrase adds a new phrase and calls onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onSave={onSave}>
        <PhraseDispatchUser phraseId="phrase-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'create' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses).toHaveLength(1);
    expect(saved.phraseAnalysisLinks).toHaveLength(1);
  });

  it('updatePhrase modifies the token list and calls onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={PHRASE_ANALYSIS}
        analysisLanguage="und"
        onSave={onSave}
      >
        <PhraseDispatchUser phraseId="phrase-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'update' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalysisLinks[0].tokens).toHaveLength(1);
    expect(saved.phraseAnalysisLinks[0].tokens[0].tokenRef).toBe('tok-a');
  });

  it('deletePhrase removes the phrase and calls onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={PHRASE_ANALYSIS}
        analysisLanguage="und"
        onSave={onSave}
      >
        <PhraseDispatchUser phraseId="phrase-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'delete' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses).toHaveLength(0);
    expect(saved.phraseAnalysisLinks).toHaveLength(0);
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseDispatchOutsideProvider />)).toThrow(
      'usePhraseDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

// ---------------------------------------------------------------------------
// usePhraseGloss
// ---------------------------------------------------------------------------

/**
 * Renders the phrase gloss for a given phraseId, used to assert on `usePhraseGloss`.
 *
 * @param props - Component props.
 * @param props.phraseId - Phrase id to look up.
 * @returns JSX element.
 */
function PhraseGlossReader({ phraseId }: Readonly<{ phraseId: string }>) {
  const gloss = usePhraseGloss(phraseId);
  return <span data-testid="phrase-gloss">{gloss}</span>;
}

/**
 * Renders a component that calls `usePhraseGloss` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function PhraseGlossUser() {
  usePhraseGloss('p1');
  return undefined;
}

/** A `TextAnalysis` with a phrase that has a gloss in the `'und'` language. */
const PHRASE_ANALYSIS_WITH_GLOSS: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [
    { id: 'phrase-1', surfaceText: 'Hello World', gloss: { und: 'world beginning' } },
  ],
  phraseAnalysisLinks: [
    {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-a', surfaceText: 'Hello' }],
    },
  ],
};

describe('usePhraseGloss', () => {
  it('returns empty string when phraseId is not found', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseGlossReader phraseId="missing" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('phrase-gloss')).toHaveTextContent('');
  });

  it('returns the gloss for the active analysis language', () => {
    render(
      <AnalysisStoreProvider initialAnalysis={PHRASE_ANALYSIS_WITH_GLOSS} analysisLanguage="und">
        <PhraseGlossReader phraseId="phrase-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('phrase-gloss')).toHaveTextContent('world beginning');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseGlossUser />)).toThrow(
      'usePhraseGloss must be used inside an AnalysisStoreProvider',
    );
  });
});

// ---------------------------------------------------------------------------
// usePhraseGlossDispatch
// ---------------------------------------------------------------------------

/**
 * Renders a button that writes a phrase gloss via `usePhraseGlossDispatch`.
 *
 * @param props - Component props.
 * @param props.phraseId - Phrase id to write.
 * @param props.value - Gloss value to write.
 * @returns JSX element.
 */
function PhraseGlossWriter({ phraseId, value }: Readonly<{ phraseId: string; value: string }>) {
  const dispatch = usePhraseGlossDispatch();
  return (
    <button onClick={() => dispatch(phraseId, value)} type="button">
      write
    </button>
  );
}

/**
 * Renders a component that calls `usePhraseGlossDispatch` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function PhraseGlossDispatchUser() {
  usePhraseGlossDispatch();
  return undefined;
}

describe('usePhraseGlossDispatch', () => {
  it('writes the phrase gloss and triggers onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={PHRASE_ANALYSIS}
        analysisLanguage="und"
        onSave={onSave}
      >
        <PhraseGlossWriter phraseId="phrase-1" value="beginning" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses[0].gloss).toStrictEqual({ und: 'beginning' });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseGlossDispatchUser />)).toThrow(
      'usePhraseGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});
