/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import type { ReactNode } from 'react';
import { emptyAnalysis } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';
import type { AnalysisEditOutcome } from '../../components/AnalysisStore';
import {
  AnalysisStoreProvider,
  useAnalysis,
  useAnalysisDeletionOutcome,
  useAnalysisLanguage,
  useAnalysisRowDispatch,
  useApproveAnalysisDispatch,
  useGloss,
  useGlossDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemeGlossDispatch,
  useMorphemes,
  usePhraseLinkByIdGetter,
  usePhraseLinkByIdMap,
  usePhraseLinkForToken,
  usePhraseLinkMap,
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  useReportGlossEditing,
  useResolvedTokenAnalysis,
  useSuggestionAfterClearing,
  useSegmentFreeTranslation,
  useSegmentFreeTranslationDispatch,
  useShowSuggestions,
} from '../../components/AnalysisStore';
import type { ResolvedTokenAnalysis } from '../../utils/suggestion-engine';

/** Builds a minimal `TextAnalysis` with a single approved `TokenAnalysis` for the given token. */
function makeAnalysisWithGloss(
  tokenRef: string,
  gloss: string,
  surfaceText = 'word',
): TextAnalysis {
  const ta: TokenAnalysis = {
    ...FIXTURE_STAMPS,
    id: `${tokenRef}-analysis`,
    surfaceText,
    gloss: { und: gloss },
  };
  const link: TokenAnalysisLink = {
    ...FIXTURE_STAMPS,
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
 * Builds a `TextAnalysis` where two tokens (`tok-1`, `tok-2`) share one approved `TokenAnalysis`
 * payload, so editing either token must fork the payload to avoid affecting its sibling.
 */
function makeSharedAnalysis(gloss = 'a', surfaceText = 'word'): TextAnalysis {
  const ta: TokenAnalysis = {
    ...FIXTURE_STAMPS,
    id: 'shared-analysis',
    surfaceText,
    gloss: { und: gloss },
  };
  return {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [
      {
        ...FIXTURE_STAMPS,
        analysisId: ta.id,
        status: 'approved',
        token: { tokenRef: 'tok-1', surfaceText },
      },
      {
        ...FIXTURE_STAMPS,
        analysisId: ta.id,
        status: 'approved',
        token: { tokenRef: 'tok-2', surfaceText },
      },
    ],
    phraseAnalyses: [],
    phraseAnalysisLinks: [],
  };
}

/** Renders a component that displays the gloss for a single token, used to assert on `useGloss`. */
function GlossReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const gloss = useGloss(tokenRef);
  return <span data-testid="gloss">{gloss}</span>;
}

/** Renders a component that displays the full analysis as JSON, used to assert on `useAnalysis`. */
function AnalysisReader() {
  const analysis = useAnalysis();
  return <span data-testid="analysis">{JSON.stringify(analysis)}</span>;
}

/** Renders a button that calls `useGlossDispatch` to write a gloss, used to test dispatch. */
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

/**
 * Renders a hook inside an {@link AnalysisStoreProvider} so a test can drive the store's dispatch
 * callbacks and read its selectors directly, without a throwaway button-and-click component.
 * Mirrors the `renderHook` + `wrapper` idiom used elsewhere in the suite.
 *
 * @param useHook - Called inside the provider; whatever it returns becomes `result.current`.
 * @param options - Provider props; `analysisLanguage` defaults to `'und'`.
 */
function renderStoreHook<T>(
  useHook: () => T,
  options: Readonly<{
    analysisLanguage?: string;
    initialAnalysis?: TextAnalysis;
    onSave?: (analysis: TextAnalysis) => void;
    onGlossChange?: (tokenRef: string, value: string) => void;
    showSuggestions?: boolean;
    readOnly?: boolean;
  }> = {},
) {
  const { analysisLanguage = 'und', ...rest } = options;
  const wrapper = ({ children }: Readonly<{ children: ReactNode }>) => (
    <AnalysisStoreProvider analysisLanguage={analysisLanguage} {...rest}>
      {children}
    </AnalysisStoreProvider>
  );
  return renderHook(useHook, { wrapper });
}

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
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'word',
      gloss: { en: 'hi' },
    };
    const link: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
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
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'mot',
      gloss: { fr: 'bonjour' },
    };
    const link: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
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
  it('replaces the existing approved analysis on subsequent writes for the same token', () => {
    const { result } = renderStoreHook(() => ({
      write: useGlossDispatch(),
      analysis: useAnalysis(),
    }));
    act(() => result.current.write('tok-1', 'word', 'hi'));
    act(() => result.current.write('tok-1', 'word', 'hi'));
    const { analysis } = result.current;
    expect(analysis.tokenAnalyses).toHaveLength(1);
    expect(analysis.tokenAnalysisLinks).toHaveLength(1);
    expect(analysis.tokenAnalysisLinks[0].status).toBe('approved');
  });

  it('creates a new approved analysis when writing to a different token', () => {
    const { result } = renderStoreHook(() => ({
      write: useGlossDispatch(),
      analysis: useAnalysis(),
    }));
    act(() => result.current.write('tok-1', 'word', 'hi'));
    act(() => result.current.write('tok-2', 'other', 'bye'));
    const { analysis } = result.current;
    expect(analysis.tokenAnalyses).toHaveLength(2);
    expect(analysis.tokenAnalysisLinks).toHaveLength(2);
  });

  it('does not touch existing suggested analyses on write', () => {
    const suggested: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'suggested-1',
      surfaceText: 'word',
      gloss: { en: 'old' },
    };
    const suggestedLink: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
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
    const { result } = renderStoreHook(
      () => ({ write: useGlossDispatch(), analysis: useAnalysis() }),
      { initialAnalysis: seed },
    );
    act(() => result.current.write('tok-1', 'word', 'new'));
    const { analysis } = result.current;
    expect(analysis.tokenAnalyses).toHaveLength(2);
    const suggestedEntry = analysis.tokenAnalysisLinks.find((l) => l.status === 'suggested');
    const approvedEntry = analysis.tokenAnalysisLinks.find((l) => l.status === 'approved');
    expect(suggestedEntry?.analysisId).toBe('suggested-1');
    expect(approvedEntry?.analysisId).not.toBe('suggested-1');
  });

  it('calls the onGlossChange spy with tokenRef and value', () => {
    const spy = jest.fn();
    const { result } = renderStoreHook(() => useGlossDispatch(), { onGlossChange: spy });
    act(() => result.current('tok-1', 'word', 'hi'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('tok-1', 'hi');
  });

  it('calls onSave with the updated TextAnalysis', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => useGlossDispatch(), { onSave });
    act(() => result.current('tok-1', 'word', 'hi'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses[0].gloss).toStrictEqual({ und: 'hi' });
  });

  it('edits only this token when the payload is shared, forking the sibling off', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(
      () => ({ write: useGlossDispatch(), gloss: useGloss('tok-1') }),
      { initialAnalysis: makeSharedAnalysis(), onSave },
    );
    expect(result.current.gloss).toBe('a');

    act(() => result.current.write('tok-1', 'word', 'b'));

    // tok-1 reads the new 'b'; tok-2 keeps 'a' because editing forked the shared payload.
    expect(result.current.gloss).toBe('b');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.gloss).toStrictEqual({ und: 'b' });
    expect(tok2Analysis?.gloss).toStrictEqual({ und: 'a' });
    expect(tok1Link?.analysisId).not.toBe(tok2Link?.analysisId);
  });

  it('clears a shared gloss for only this token, leaving the sibling untouched', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(
      () => ({ write: useGlossDispatch(), gloss: useGloss('tok-1') }),
      { initialAnalysis: makeSharedAnalysis(), onSave },
    );

    act(() => result.current.write('tok-1', 'word', ''));

    // Clearing forks the shared payload so only tok-1's link goes away; tok-2 keeps the shared 'a'.
    expect(result.current.gloss).toBe('');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1')).toBeUndefined();
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok2Analysis?.gloss).toStrictEqual({ und: 'a' });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useGlossDispatch())).toThrow(
      'useGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/** Approved phrase analysis seed used across phrase hook tests. */
const PHRASE_ANALYSIS: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [{ ...FIXTURE_STAMPS, id: 'phrase-1', surfaceText: 'Hello World' }],
  phraseAnalysisLinks: [
    {
      ...FIXTURE_STAMPS,
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-a', surfaceText: 'Hello' },
        { tokenRef: 'tok-b', surfaceText: 'World' },
      ],
    },
  ],
};

/** Renders a component that displays the phrase link map size, used to assert `usePhraseLinkMap`. */
function PhraseLinkMapReader() {
  const map = usePhraseLinkMap();
  return <span data-testid="map-size">{map.size}</span>;
}

/**
 * Renders a component that displays the phrase link analysisId for a given token ref, used to
 * assert `usePhraseLinkForToken`.
 */
function PhraseLinkReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const link = usePhraseLinkForToken(tokenRef);
  return <span data-testid="link-id">{link?.analysisId ?? 'none'}</span>;
}

/** Renders a component that calls `usePhraseLinkMap` without a provider, to assert it throws. */
function PhraseLinkMapUser() {
  usePhraseLinkMap();
  return undefined;
}

/** Renders a component that calls `usePhraseLinkForToken` without a provider, to assert it throws. */
function PhraseLinkForTokenUser() {
  usePhraseLinkForToken('tok-1');
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

/**
 * Renders a component that displays the phrase-link-by-id map size, used to assert
 * `usePhraseLinkByIdMap`.
 */
function PhraseLinkByIdMapReader() {
  const map = usePhraseLinkByIdMap();
  return <span data-testid="id-map-size">{map.size}</span>;
}

/** Renders a component that calls `usePhraseLinkByIdMap` without a provider, to assert it throws. */
function PhraseLinkByIdMapUser() {
  usePhraseLinkByIdMap();
  return undefined;
}

describe('usePhraseLinkByIdMap', () => {
  it('returns an empty map when no approved phrase links exist', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseLinkByIdMapReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('id-map-size')).toHaveTextContent('0');
  });

  it('returns a map with one entry per approved phrase link (keyed by analysisId)', () => {
    render(
      <AnalysisStoreProvider initialAnalysis={PHRASE_ANALYSIS} analysisLanguage="und">
        <PhraseLinkByIdMapReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('id-map-size')).toHaveTextContent('1');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseLinkByIdMapUser />)).toThrow(
      'usePhraseLinkByIdMap must be used inside an AnalysisStoreProvider',
    );
  });
});

/**
 * Renders a component that reads the phrase-link map through `usePhraseLinkByIdGetter` at render
 * time and displays its size, used to assert the getter resolves current store state.
 */
function PhraseLinkByIdGetterReader() {
  const getPhraseLinkById = usePhraseLinkByIdGetter();
  return <span data-testid="getter-map-size">{getPhraseLinkById().size}</span>;
}

/** Renders a component that calls `usePhraseLinkByIdGetter` without a provider, to assert it throws. */
function PhraseLinkByIdGetterUser() {
  usePhraseLinkByIdGetter();
  return undefined;
}

describe('usePhraseLinkByIdGetter', () => {
  it('returns a getter resolving the current phrase-link-by-id map', () => {
    render(
      <AnalysisStoreProvider initialAnalysis={PHRASE_ANALYSIS} analysisLanguage="und">
        <PhraseLinkByIdGetterReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('getter-map-size')).toHaveTextContent('1');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<PhraseLinkByIdGetterUser />)).toThrow(
      'usePhraseLinkByIdGetter must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('usePhraseDispatch', () => {
  it('createPhrase adds a new phrase and calls onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => usePhraseDispatch(), { onSave });

    act(() => result.current.createPhrase([{ tokenRef: 'tok-x', surfaceText: 'X' }]));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses).toHaveLength(1);
    expect(saved.phraseAnalysisLinks).toHaveLength(1);
  });

  it('updatePhrase modifies the token list and calls onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => usePhraseDispatch(), {
      initialAnalysis: PHRASE_ANALYSIS,
      onSave,
    });

    act(() => result.current.updatePhrase('phrase-1', [{ tokenRef: 'tok-a', surfaceText: 'A' }]));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalysisLinks[0].tokens).toHaveLength(1);
    expect(saved.phraseAnalysisLinks[0].tokens[0].tokenRef).toBe('tok-a');
  });

  it('deletePhrase removes the phrase and calls onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => usePhraseDispatch(), {
      initialAnalysis: PHRASE_ANALYSIS,
      onSave,
    });

    act(() => result.current.deletePhrase('phrase-1'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses).toHaveLength(0);
    expect(saved.phraseAnalysisLinks).toHaveLength(0);
  });

  it('mergePhrases grows the target phrase in one dispatch and calls onSave once', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => usePhraseDispatch(), {
      initialAnalysis: PHRASE_ANALYSIS,
      onSave,
    });

    act(() =>
      result.current.mergePhrases(
        'phrase-1',
        [
          { tokenRef: 'tok-a', surfaceText: 'A' },
          { tokenRef: 'tok-b', surfaceText: 'B' },
        ],
        'phrase-2',
      ),
    );

    // A single dispatch means a single save — the intermediate two-phrase state is never observed.
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalysisLinks[0].tokens.map((t) => t.tokenRef)).toStrictEqual([
      'tok-a',
      'tok-b',
    ]);
    expect(saved.phraseAnalyses[0].surfaceText).toBe('A B');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePhraseDispatch())).toThrow(
      'usePhraseDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/** Renders the phrase gloss for a given phraseId, used to assert on `usePhraseGloss`. */
function PhraseGlossReader({ phraseId }: Readonly<{ phraseId: string }>) {
  const gloss = usePhraseGloss(phraseId);
  return <span data-testid="phrase-gloss">{gloss}</span>;
}

/** Renders a component that calls `usePhraseGloss` without a provider, to assert it throws. */
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
    {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      surfaceText: 'Hello World',
      gloss: { und: 'world beginning' },
    },
  ],
  phraseAnalysisLinks: [
    {
      ...FIXTURE_STAMPS,
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

describe('usePhraseGlossDispatch', () => {
  it('writes the phrase gloss and triggers onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => usePhraseGlossDispatch(), {
      initialAnalysis: PHRASE_ANALYSIS,
      onSave,
    });

    act(() => result.current('phrase-1', 'beginning'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.phraseAnalyses[0].gloss).toStrictEqual({ und: 'beginning' });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePhraseGlossDispatch())).toThrow(
      'usePhraseGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/** A `TextAnalysis` with an approved segment analysis carrying a free translation in `'und'`. */
const SEGMENT_ANALYSIS_WITH_TRANSLATION: TextAnalysis = {
  segmentAnalyses: [
    {
      ...FIXTURE_STAMPS,
      id: 'sa-1',
      surfaceText: 'In the beginning',
      freeTranslation: { und: 'au commencement' },
    },
  ],
  segmentAnalysisLinks: [
    { ...FIXTURE_STAMPS, analysisId: 'sa-1', status: 'approved', segmentId: 'seg-1' },
  ],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

/**
 * Renders the free translation for a given segmentId, used to assert on
 * `useSegmentFreeTranslation`.
 */
function SegmentTranslationReader({ segmentId }: Readonly<{ segmentId: string }>) {
  const value = useSegmentFreeTranslation(segmentId);
  return <span data-testid="segment-translation">{value}</span>;
}

/**
 * Renders a component that calls `useSegmentFreeTranslation` without a provider, to assert it
 * throws.
 */
function SegmentTranslationUser() {
  useSegmentFreeTranslation('seg-1');
  return undefined;
}

describe('useSegmentFreeTranslation', () => {
  it('returns empty string when the segment has no approved analysis', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentTranslationReader segmentId="seg-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('segment-translation')).toHaveTextContent('');
  });

  it('returns the free translation for the active analysis language', () => {
    render(
      <AnalysisStoreProvider
        initialAnalysis={SEGMENT_ANALYSIS_WITH_TRANSLATION}
        analysisLanguage="und"
      >
        <SegmentTranslationReader segmentId="seg-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('segment-translation')).toHaveTextContent('au commencement');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SegmentTranslationUser />)).toThrow(
      'useSegmentFreeTranslation must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useSegmentFreeTranslationDispatch', () => {
  it('writes the segment free translation and triggers onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => useSegmentFreeTranslationDispatch(), { onSave });

    act(() => result.current('seg-1', 'In the beginning', 'au commencement'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.segmentAnalyses[0]).toMatchObject({
      surfaceText: 'In the beginning',
      freeTranslation: { und: 'au commencement' },
    });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSegmentFreeTranslationDispatch())).toThrow(
      'useSegmentFreeTranslationDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/** Renders the morpheme forms for a token, used to assert on `useMorphemes`. */
function MorphemeReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const morphemes = useMorphemes(tokenRef);
  return <span data-testid="morphemes">{morphemes.map((m) => m.form).join(',')}</span>;
}

/** Renders the analysis language, used to assert on `useAnalysisLanguage`. */
function LanguageReader() {
  const lang = useAnalysisLanguage();
  return <span data-testid="lang">{lang}</span>;
}

/** Renders a component that calls `useMorphemes` without a provider, used to test the error. */
function MorphemesUser() {
  useMorphemes('tok-1');
  return undefined;
}

/** Renders a component that calls `useAnalysisLanguage` without a provider, used to test the error. */
function LanguageUser() {
  useAnalysisLanguage();
  return undefined;
}

describe('useMorphemes', () => {
  it('returns empty array when no morphemes exist', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <MorphemeReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('morphemes')).toHaveTextContent('');
  });

  it('returns morphemes from an approved analysis with morphemes', () => {
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und' },
        { id: 'm-2', form: 'believe', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'ta-1',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'unbelievable' },
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
        <MorphemeReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('morphemes')).toHaveTextContent('un-,believe');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<MorphemesUser />)).toThrow(
      'useMorphemes must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useAnalysisLanguage', () => {
  it('returns the analysis language from the provider', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="fr">
        <LanguageReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('fr');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<LanguageUser />)).toThrow(
      'useAnalysisLanguage must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useMorphemeBreakdownDispatch', () => {
  it('writes morphemes and calls onSave', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(
      () => ({ breakdown: useMorphemeBreakdownDispatch(), morphemes: useMorphemes('tok-1') }),
      { onSave },
    );

    act(() => result.current.breakdown('tok-1', 'cat', ['ca', '-t'], 'en'));

    expect(result.current.morphemes.map((m) => m.form)).toStrictEqual(['ca', '-t']);
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(1);
    expect(saved.tokenAnalyses[0].morphemes).toHaveLength(2);
    expect(saved.tokenAnalyses[0].morphemes?.[0].writingSystem).toBe('en');
  });

  it('forks a shared payload so a breakdown edit touches only this token', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(() => useMorphemeBreakdownDispatch(), {
      initialAnalysis: makeSharedAnalysis(),
      onSave,
    });

    act(() => result.current('tok-1', 'word', ['wor', 'd'], 'en'));

    // tok-1's forked copy gains the breakdown; tok-2's original keeps just the gloss.
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok1Link?.analysisId).not.toBe(tok2Link?.analysisId);
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.morphemes?.map((m) => m.form)).toStrictEqual(['wor', 'd']);
    expect(tok2Analysis?.morphemes).toBeUndefined();
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useMorphemeBreakdownDispatch())).toThrow(
      'useMorphemeBreakdownDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useMorphemeDeleteDispatch', () => {
  it('deletes the morpheme breakdown and calls onSave', async () => {
    const onSave = jest.fn();
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cat',
      morphemes: [
        { id: 'm-1', form: 'ca', writingSystem: 'und' },
        { id: 'm-2', form: '-t', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'ta-1',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'cat' },
    };
    const analysis: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [ta],
      tokenAnalysisLinks: [link],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnalysisStoreProvider initialAnalysis={analysis} analysisLanguage="und" onSave={onSave}>
        {children}
      </AnalysisStoreProvider>
    );
    const { result } = renderHook(
      () => ({
        deleteBreakdown: useMorphemeDeleteDispatch(),
        morphemes: useMorphemes('tok-1'),
      }),
      { wrapper },
    );
    expect(result.current.morphemes).toHaveLength(2);

    act(() => result.current.deleteBreakdown('tok-1'));

    expect(result.current.morphemes).toHaveLength(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // The analysis carried no gloss, so the now-empty record and its link are removed entirely.
    expect(saved.tokenAnalyses).toHaveLength(0);
    expect(saved.tokenAnalysisLinks).toHaveLength(0);
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useMorphemeDeleteDispatch())).toThrow(
      'useMorphemeDeleteDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useMorphemeGlossDispatch', () => {
  it('writes a morpheme gloss and calls onSave', () => {
    const onSave = jest.fn();
    const ta: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'cat',
      morphemes: [
        { id: 'm-1', form: 'ca', writingSystem: 'und' },
        { id: 'm-2', form: '-t', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
      ...FIXTURE_STAMPS,
      analysisId: 'ta-1',
      status: 'approved',
      token: { tokenRef: 'tok-1', surfaceText: 'cat' },
    };
    const analysis: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [ta],
      tokenAnalysisLinks: [link],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const { result } = renderStoreHook(() => useMorphemeGlossDispatch(), {
      initialAnalysis: analysis,
      onSave,
    });

    act(() => result.current('tok-1', 'm-1', 'prefix'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ und: 'prefix' });
  });

  it('forks a shared payload so a morpheme-gloss edit touches only this token', () => {
    const onSave = jest.fn();
    const sharedMorpheme: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [
        {
          ...FIXTURE_STAMPS,
          id: 'shared-analysis',
          surfaceText: 'word',
          morphemes: [{ id: 'm1', form: 'word', writingSystem: 'en' }],
        },
      ],
      tokenAnalysisLinks: [
        {
          ...FIXTURE_STAMPS,
          analysisId: 'shared-analysis',
          status: 'approved',
          token: { tokenRef: 'tok-1', surfaceText: 'word' },
        },
        {
          ...FIXTURE_STAMPS,
          analysisId: 'shared-analysis',
          status: 'approved',
          token: { tokenRef: 'tok-2', surfaceText: 'word' },
        },
      ],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    const { result } = renderStoreHook(() => useMorphemeGlossDispatch(), {
      initialAnalysis: sharedMorpheme,
      onSave,
    });

    act(() => result.current('tok-1', 'm1', 'root'));

    // tok-1's forked copy gets the morpheme gloss; tok-2's original morpheme stays bare.
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.morphemes?.[0].gloss).toStrictEqual({ und: 'root' });
    expect(tok2Analysis?.morphemes?.[0].gloss).toBeUndefined();
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useMorphemeGlossDispatch())).toThrow(
      'useMorphemeGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/**
 * Reports its `isEditing` prop through {@link useReportGlossEditing}, used to drive the provider's
 * pending-edits accounting from tests. Renders nothing; it exists only for its hook side effect.
 */
function EditingReporter({ isEditing }: Readonly<{ isEditing: boolean }>) {
  useReportGlossEditing(isEditing);
  return undefined;
}

describe('useReportGlossEditing', () => {
  it('reports true when the first input starts editing and false when it stops', () => {
    const onPendingEditsChange = jest.fn();
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing={false} />
      </AnalysisStoreProvider>,
    );
    // No editor active yet: nothing reported.
    expect(onPendingEditsChange).not.toHaveBeenCalled();

    rerender(
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing />
      </AnalysisStoreProvider>,
    );
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);

    rerender(
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing={false} />
      </AnalysisStoreProvider>,
    );
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
  });

  it('reports only the 0↔non-0 transitions when multiple inputs edit concurrently', () => {
    const onPendingEditsChange = jest.fn();
    const renderWith = (a: boolean, b: boolean) => (
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing={a} />
        <EditingReporter isEditing={b} />
      </AnalysisStoreProvider>
    );
    const { rerender } = render(renderWith(false, false));
    expect(onPendingEditsChange).not.toHaveBeenCalled();

    rerender(renderWith(true, false));
    expect(onPendingEditsChange).toHaveBeenCalledTimes(1);
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);

    // Second input also starts editing: still pending, no new transition reported.
    rerender(renderWith(true, true));
    expect(onPendingEditsChange).toHaveBeenCalledTimes(1);

    // First input stops: one editor remains, so still no transition.
    rerender(renderWith(false, true));
    expect(onPendingEditsChange).toHaveBeenCalledTimes(1);

    // Last editor stops: now we cross back to zero.
    rerender(renderWith(false, false));
    expect(onPendingEditsChange).toHaveBeenCalledTimes(2);
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
  });

  it('reports false when an actively-editing input unmounts', () => {
    const onPendingEditsChange = jest.fn();
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <EditingReporter isEditing />
      </AnalysisStoreProvider>,
    );
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(true);

    rerender(
      <AnalysisStoreProvider analysisLanguage="und" onPendingEditsChange={onPendingEditsChange}>
        <span />
      </AnalysisStoreProvider>,
    );
    expect(onPendingEditsChange).toHaveBeenLastCalledWith(false);
  });

  it('does not throw when no onPendingEditsChange is provided', () => {
    const { rerender } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <EditingReporter isEditing={false} />
      </AnalysisStoreProvider>,
    );
    expect(() =>
      rerender(
        <AnalysisStoreProvider analysisLanguage="und">
          <EditingReporter isEditing />
        </AnalysisStoreProvider>,
      ),
    ).not.toThrow();
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<EditingReporter isEditing={false} />)).toThrow(
      'useReportGlossEditing must be used inside an AnalysisStoreProvider',
    );
  });
});

/**
 * Renders the merged analysis status for a token, used to assert on `useResolvedTokenAnalysis`.
 * Records every render's resolved value so a test can assert referential stability.
 */
function ResolvedReader({
  tokenRef,
  surfaceText,
  enabled = true,
  sink,
}: Readonly<{
  tokenRef: string;
  surfaceText: string;
  enabled?: boolean;
  sink?: (ResolvedTokenAnalysis | undefined)[];
}>) {
  const resolved = useResolvedTokenAnalysis(tokenRef, surfaceText, enabled);
  sink?.push(resolved);
  return <span data-testid="resolved">{resolved?.status ?? 'none'}</span>;
}

describe('useShowSuggestions', () => {
  /** Renders the active show-suggestions flag, used to assert on `useShowSuggestions`. */
  function ShowSuggestionsReader() {
    return <span data-testid="show">{String(useShowSuggestions())}</span>;
  }

  it('defaults to false when the provider does not opt in', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <ShowSuggestionsReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('show')).toHaveTextContent('false');
  });

  it('reflects the provider showSuggestions prop when set', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und" showSuggestions>
        <ShowSuggestionsReader />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('show')).toHaveTextContent('true');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ShowSuggestionsReader />)).toThrow(
      'useShowSuggestions must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useResolvedTokenAnalysis', () => {
  it('returns the approved decision for an approved token', () => {
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'w', 'logos')}
        analysisLanguage="und"
      >
        <ResolvedReader tokenRef="tok-1" surfaceText="logos" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('approved');
  });

  it('derives a suggestion for an unapproved token matching the pool', () => {
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'w', 'logos')}
        analysisLanguage="und"
      >
        <ResolvedReader tokenRef="tok-2" surfaceText="logos" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('suggested');
  });

  it('returns undefined when the token is neither approved nor matches the pool', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <ResolvedReader tokenRef="tok-2" surfaceText="unseen" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('none');
  });

  it('short-circuits to undefined without deriving when disabled', () => {
    // With enabled=false the hook must not resolve even a token that would otherwise be approved.
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'w', 'logos')}
        analysisLanguage="und"
      >
        <ResolvedReader tokenRef="tok-1" surfaceText="logos" enabled={false} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('none');
  });

  it('does not re-render a suggested token when an unrelated token is glossed', async () => {
    const sink: (ResolvedTokenAnalysis | undefined)[] = [];
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'w', 'logos')}
        analysisLanguage="und"
      >
        <ResolvedReader tokenRef="tok-2" surfaceText="logos" sink={sink} />
        <GlossWriter tokenRef="tok-9" surfaceText="cat" value="feline" />
      </AnalysisStoreProvider>,
    );
    const before = sink.length;

    // Glossing 'cat' rebuilds the pool but leaves the 'logos' suggestion referentially stable (via
    // the custom equalityFn), so the reader never re-renders.
    await userEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(sink.length).toBe(before);
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ResolvedReader tokenRef="tok-1" surfaceText="logos" />)).toThrow(
      'useResolvedTokenAnalysis must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useSuggestionAfterClearing', () => {
  /**
   * Renders the status of the cleared-token preview for a token, used to assert on
   * `useSuggestionAfterClearing`.
   */
  function ClearingReader({
    tokenRef,
    surfaceText,
    enabled = true,
  }: Readonly<{ tokenRef: string; surfaceText: string; enabled?: boolean }>) {
    const resolved = useSuggestionAfterClearing(tokenRef, surfaceText, enabled);
    return <span data-testid="cleared">{resolved?.status ?? 'none'}</span>;
  }

  it('previews the pool suggestion as if an approved token were cleared', () => {
    // tok-1 and tok-2 both approve the shared 'word' payload; discounting tok-1's approval still
    // leaves tok-2's, so clearing tok-1 previews the surviving payload as a suggestion.
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis('a', 'word')}
        analysisLanguage="und"
      >
        <ClearingReader tokenRef="tok-1" surfaceText="word" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('cleared')).toHaveTextContent('suggested');
  });

  it('returns undefined without pool work when disabled', () => {
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis('a', 'word')}
        analysisLanguage="und"
      >
        <ClearingReader tokenRef="tok-1" surfaceText="word" enabled={false} />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('cleared')).toHaveTextContent('none');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ClearingReader tokenRef="tok-1" surfaceText="word" />)).toThrow(
      'useSuggestionAfterClearing must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useApproveAnalysisDispatch', () => {
  it('approves the chosen payload for the token, flipping it from suggested to approved', () => {
    const onSave = jest.fn();
    const { result } = renderStoreHook(
      () => ({
        approve: useApproveAnalysisDispatch(),
        resolved: useResolvedTokenAnalysis('tok-2', 'logos', true),
      }),
      { initialAnalysis: makeAnalysisWithGloss('tok-1', 'w', 'logos'), onSave },
    );
    expect(result.current.resolved?.status).toBe('suggested');

    act(() => result.current.approve('tok-2', 'logos', 'tok-1-analysis'));

    expect(result.current.resolved?.status).toBe('approved');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // No new payload — tok-2 links to the existing shared analysis (frequency now 2).
    expect(saved.tokenAnalyses).toHaveLength(1);
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok2Link?.analysisId).toBe('tok-1-analysis');
    expect(tok2Link?.status).toBe('approved');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useApproveAnalysisDispatch())).toThrow(
      'useApproveAnalysisDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

function approvedLink(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    token: { tokenRef, surfaceText: 'ἀρχῇ' },
    status: 'approved',
  };
}

/** Two homographs glossed differently, so editing `ta-1` into `ta-2`'s gloss collapses them. */
function twoHomographs(links: readonly TokenAnalysisLink[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [
      { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { und: 'start' } },
      { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ', gloss: { und: 'beginning' } },
    ],
    tokenAnalysisLinks: [...links],
  };
}

describe('useAnalysisRowDispatch', () => {
  it('reports an ordinary edit as leaving the record standing', () => {
    const { result } = renderStoreHook(() => useAnalysisRowDispatch(), {
      initialAnalysis: twoHomographs([approvedLink('ta-1', 'tok-1')]),
    });

    let outcome: AnalysisEditOutcome | undefined;
    act(() => {
      outcome = result.current.writeGloss('ta-1', 'origin');
    });

    expect(outcome).toStrictEqual({ kind: 'edited' });
  });

  it('reports a collapse onto a sibling, naming the survivor', () => {
    const { result } = renderStoreHook(() => useAnalysisRowDispatch(), {
      initialAnalysis: twoHomographs([
        approvedLink('ta-1', 'tok-1'),
        approvedLink('ta-2', 'tok-2'),
      ]),
    });

    let outcome: AnalysisEditOutcome | undefined;
    act(() => {
      outcome = result.current.writeGloss('ta-1', 'beginning');
    });

    expect(outcome).toStrictEqual({
      kind: 'merged',
      survivingAnalysisId: 'ta-2',
      survivingGloss: 'beginning',
      survivingUsageCount: 2,
    });
  });

  // The case links cannot report: an unlinked record repoints nothing when it collapses.
  it('reports a collapse of a record no token links to', () => {
    const { result } = renderStoreHook(() => useAnalysisRowDispatch(), {
      initialAnalysis: twoHomographs([approvedLink('ta-2', 'tok-2')]),
    });

    let outcome: AnalysisEditOutcome | undefined;
    act(() => {
      outcome = result.current.writeGloss('ta-1', 'beginning');
    });

    expect(outcome).toStrictEqual({
      kind: 'merged',
      survivingAnalysisId: 'ta-2',
      survivingGloss: 'beginning',
      survivingUsageCount: 1,
    });
  });

  it('reports an edit that empties the record as a removal', () => {
    const { result } = renderStoreHook(() => useAnalysisRowDispatch(), {
      initialAnalysis: twoHomographs([approvedLink('ta-1', 'tok-1')]),
    });

    act(() => {
      result.current.writeGloss('ta-1', 'beginning');
    });

    // ta-2 is the survivor the first write recorded, so this checks a stale one is not reported.
    let outcome: AnalysisEditOutcome | undefined;
    act(() => {
      outcome = result.current.writeGloss('ta-2', '');
    });

    expect(outcome).toStrictEqual({ kind: 'removed' });
  });

  it('reports a collapse driven by a morpheme breakdown', () => {
    const analysis = twoHomographs([approvedLink('ta-2', 'tok-2')]);
    const { result } = renderStoreHook(() => useAnalysisRowDispatch(), {
      initialAnalysis: {
        ...analysis,
        // Same gloss apiece, so the records differ only by breakdown.
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { und: 'beginning' } },
          {
            ...FIXTURE_STAMPS,
            id: 'ta-2',
            surfaceText: 'ἀρχῇ',
            gloss: { und: 'beginning' },
            morphemes: [{ ...FIXTURE_STAMPS, id: 'm-1', form: 'ἀρχ', writingSystem: 'el' }],
          },
        ],
      },
    });

    let outcome: AnalysisEditOutcome | undefined;
    act(() => {
      outcome = result.current.writeMorphemes('ta-1', ['ἀρχ'], 'el');
    });

    expect(outcome?.kind).toBe('merged');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAnalysisRowDispatch())).toThrow(
      'useAnalysisRowDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useAnalysisDeletionOutcome', () => {
  it('reports the surviving homograph the affected tokens fall back to', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome(), {
      initialAnalysis: twoHomographs([
        approvedLink('ta-1', 'tok-1'),
        approvedLink('ta-2', 'tok-2'),
      ]),
      showSuggestions: true,
    });

    expect(result.current('ta-1')).toStrictEqual({
      kind: 'fallback',
      usageCount: 1,
      unappliedCount: 0,
      fallbackGloss: 'beginning',
    });
  });

  it('reports that same fallback as blank while suggestions are hidden', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome(), {
      initialAnalysis: twoHomographs([
        approvedLink('ta-1', 'tok-1'),
        approvedLink('ta-2', 'tok-2'),
      ]),
      showSuggestions: false,
    });

    expect(result.current('ta-1')).toStrictEqual({
      kind: 'blank',
      usageCount: 1,
      unappliedCount: 0,
    });
  });

  it('reports a fallback as blank while the analysis is read-only', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome(), {
      initialAnalysis: twoHomographs([
        approvedLink('ta-1', 'tok-1'),
        approvedLink('ta-2', 'tok-2'),
      ]),
      readOnly: true,
      showSuggestions: true,
    });

    expect(result.current('ta-1')).toStrictEqual({
      kind: 'blank',
      usageCount: 1,
      unappliedCount: 0,
    });
  });

  // The suggested link is the unapplied assignment; the two approvals make ta-2 the fallback.
  it('keeps the unapplied count when a fallback is reported as blank', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome(), {
      initialAnalysis: twoHomographs([
        approvedLink('ta-1', 'tok-1'),
        approvedLink('ta-2', 'tok-2'),
        { ...approvedLink('ta-1', 'tok-3'), status: 'suggested' },
      ]),
      showSuggestions: false,
    });

    expect(result.current('ta-1')).toStrictEqual({
      kind: 'blank',
      usageCount: 1,
      unappliedCount: 1,
    });
  });

  it('reports a blank outcome when no homograph survives', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome(), {
      initialAnalysis: makeAnalysisWithGloss('tok-1', 'hello'),
    });

    expect(result.current('tok-1-analysis')).toStrictEqual({
      kind: 'blank',
      usageCount: 1,
      unappliedCount: 0,
    });
  });

  it('returns undefined for an id that resolves to no record', () => {
    const { result } = renderStoreHook(() => useAnalysisDeletionOutcome());

    expect(result.current('ta-missing')).toBeUndefined();
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAnalysisDeletionOutcome())).toThrow(
      'useAnalysisDeletionOutcome must be used inside an AnalysisStoreProvider',
    );
  });
});
