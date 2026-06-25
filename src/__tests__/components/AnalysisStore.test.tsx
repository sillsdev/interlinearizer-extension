/** @file Unit tests for components/AnalysisStore.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import {
  AnalysisStoreProvider,
  useAnalysis,
  useAnalysisLanguage,
  useApproveAnalysisDispatch,
  useGloss,
  useGlossDispatch,
  useMorphemeBreakdownDispatch,
  useMorphemeDeleteDispatch,
  useMorphemeGlossDispatch,
  useMorphemes,
  usePhraseLinkByIdMap,
  usePhraseLinkForToken,
  usePhraseLinkMap,
  usePhraseDispatch,
  usePhraseGloss,
  usePhraseGlossDispatch,
  useReportGlossEditing,
  useResolvedTokenAnalysis,
  useSegmentFreeTranslation,
  useSegmentFreeTranslationDispatch,
  useShowSuggestions,
} from '../../components/AnalysisStore';
import type { ResolvedTokenAnalysis } from '../../utils/suggestion-engine';

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
 * Builds a `TextAnalysis` where two tokens (`tok-1`, `tok-2`) share one approved `TokenAnalysis`
 * payload, so editing either token is a global edit. Used to exercise the confirmation gate.
 *
 * @param gloss - Gloss value shared by both tokens for the `'und'` language key.
 * @param surfaceText - Surface text of both tokens.
 * @returns A `TextAnalysis` with one payload referenced by two approved links.
 */
function makeSharedAnalysis(gloss = 'a', surfaceText = 'word'): TextAnalysis {
  const ta: TokenAnalysis = { id: 'shared-analysis', surfaceText, gloss: { und: gloss } };
  return {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [ta],
    tokenAnalysisLinks: [
      { analysisId: ta.id, status: 'approved', token: { tokenRef: 'tok-1', surfaceText } },
      { analysisId: ta.id, status: 'approved', token: { tokenRef: 'tok-2', surfaceText } },
    ],
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

describe('useGlossDispatch — global-edit confirmation', () => {
  // The confirmation modal renders real localized strings; `resetMocks` wipes the default
  // implementation, so re-establish a key→label map (tests assert via test ids, not copy).
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([
      {
        '%interlinearizer_globalEdit_title%': 'Used by {count} tokens',
        '%interlinearizer_globalEdit_body%': 'Shared by {count} tokens',
        '%interlinearizer_globalEdit_updateAll%': 'Update all {count}',
        '%interlinearizer_globalEdit_fork%': 'Make a separate analysis',
        '%interlinearizer_globalEdit_cancel%': 'Cancel',
      },
      false,
    ]);
  });

  it('holds the edit and prompts before a global edit, updating every token on "update all"', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <GlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="b" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    // The edit is held: the gloss is unchanged and nothing is saved until the user confirms.
    expect(screen.getByTestId('gloss')).toHaveTextContent('a');
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('global-edit-update-all'));

    expect(screen.getByTestId('gloss')).toHaveTextContent('b');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // One shared payload, now glossed 'b' — both tokens still point at it.
    expect(saved.tokenAnalyses).toHaveLength(1);
    expect(saved.tokenAnalyses[0].gloss).toStrictEqual({ und: 'b' });
  });

  it('forks a private copy on "make a separate analysis", changing only this token', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="b" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    await userEvent.click(screen.getByTestId('global-edit-fork'));

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // Two payloads now: the original 'a' kept by tok-2, and a fork 'b' for tok-1 alone.
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.gloss).toStrictEqual({ und: 'b' });
    expect(tok2Analysis?.gloss).toStrictEqual({ und: 'a' });
    expect(tok1Link?.analysisId).not.toBe(tok2Link?.analysisId);
  });

  it('leaves the analysis untouched and closes the modal on cancel', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <GlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="b" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));
    expect(screen.getByTestId('global-edit-cancel')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('global-edit-cancel'));

    expect(screen.queryByTestId('global-edit-cancel')).not.toBeInTheDocument();
    expect(screen.getByTestId('gloss')).toHaveTextContent('a');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not prompt when confirmGlobalEdits is on but the payload is not shared', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'a')}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <GlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="b" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(screen.queryByTestId('global-edit-update-all')).not.toBeInTheDocument();
    expect(screen.getByTestId('gloss')).toHaveTextContent('b');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('commits a shared-payload edit immediately when confirmGlobalEdits is off', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
      >
        <GlossReader tokenRef="tok-1" />
        <GlossWriter tokenRef="tok-1" surfaceText="word" value="b" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(screen.queryByTestId('global-edit-update-all')).not.toBeInTheDocument();
    expect(screen.getByTestId('gloss')).toHaveTextContent('b');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(1);
    expect(saved.tokenAnalyses[0].gloss).toStrictEqual({ und: 'b' });
  });
});

describe('morpheme edits — global-edit confirmation', () => {
  // The confirmation modal renders real localized strings; `resetMocks` wipes the default, so
  // re-establish a key→label map (tests assert via test ids, not copy).
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([
      {
        '%interlinearizer_globalEdit_title%': 'Used by {count} tokens',
        '%interlinearizer_globalEdit_body%': 'Shared by {count} tokens',
        '%interlinearizer_globalEdit_updateAll%': 'Update all {count}',
        '%interlinearizer_globalEdit_fork%': 'Make a separate analysis',
        '%interlinearizer_globalEdit_cancel%': 'Cancel',
      },
      false,
    ]);
  });

  it('prompts before a shared morpheme-breakdown edit and applies it to all on "update all"', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <MorphemeWriter
          tokenRef="tok-1"
          surfaceText="word"
          forms={['wor', 'd']}
          writingSystem="en"
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'break' }));
    expect(onSave).not.toHaveBeenCalled(); // held for confirmation

    await userEvent.click(screen.getByTestId('global-edit-update-all'));

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // One shared payload, now carrying the breakdown for both tokens.
    expect(saved.tokenAnalyses).toHaveLength(1);
    expect(saved.tokenAnalyses[0].morphemes?.map((m) => m.form)).toStrictEqual(['wor', 'd']);
  });

  it('forks a private copy on "make a separate analysis" for a morpheme-breakdown edit', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeSharedAnalysis()}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <MorphemeWriter
          tokenRef="tok-1"
          surfaceText="word"
          forms={['wor', 'd']}
          writingSystem="en"
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'break' }));
    await userEvent.click(screen.getByTestId('global-edit-fork'));

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // Two payloads: tok-1's forked copy gains the breakdown; tok-2's original keeps just the gloss.
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok1Link?.analysisId).not.toBe(tok2Link?.analysisId);
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.morphemes?.map((m) => m.form)).toStrictEqual(['wor', 'd']);
    expect(tok2Analysis?.morphemes).toBeUndefined();
  });

  it('forks a private copy on "make a separate analysis" for a morpheme-gloss edit', async () => {
    const onSave = jest.fn();
    const sharedMorpheme: TextAnalysis = {
      segmentAnalyses: [],
      segmentAnalysisLinks: [],
      tokenAnalyses: [
        {
          id: 'shared-analysis',
          surfaceText: 'word',
          morphemes: [{ id: 'm1', form: 'word', writingSystem: 'en' }],
        },
      ],
      tokenAnalysisLinks: [
        {
          analysisId: 'shared-analysis',
          status: 'approved',
          token: { tokenRef: 'tok-1', surfaceText: 'word' },
        },
        {
          analysisId: 'shared-analysis',
          status: 'approved',
          token: { tokenRef: 'tok-2', surfaceText: 'word' },
        },
      ],
      phraseAnalyses: [],
      phraseAnalysisLinks: [],
    };
    render(
      <AnalysisStoreProvider
        initialAnalysis={sharedMorpheme}
        analysisLanguage="und"
        onSave={onSave}
        confirmGlobalEdits
      >
        <MorphemeGlossWriter tokenRef="tok-1" morphemeId="m1" value="root" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'gloss' }));
    await userEvent.click(screen.getByTestId('global-edit-fork'));

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // Two payloads: tok-1's forked copy gets the morpheme gloss; tok-2's original morpheme stays bare.
    expect(saved.tokenAnalyses).toHaveLength(2);
    const tok1Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-1');
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    const tok1Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok1Link?.analysisId);
    const tok2Analysis = saved.tokenAnalyses.find((ta) => ta.id === tok2Link?.analysisId);
    expect(tok1Analysis?.morphemes?.[0].gloss).toStrictEqual({ und: 'root' });
    expect(tok2Analysis?.morphemes?.[0].gloss).toBeUndefined();
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
  const { createPhrase, updatePhrase, deletePhrase, mergePhrases } = usePhraseDispatch();
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
      <button
        onClick={() =>
          mergePhrases(
            phraseId,
            [
              { tokenRef: 'tok-a', surfaceText: 'A' },
              { tokenRef: 'tok-b', surfaceText: 'B' },
            ],
            'phrase-2',
          )
        }
        type="button"
      >
        merge
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

/**
 * Renders a component that displays the phrase-link-by-id map size, used to assert
 * `usePhraseLinkByIdMap`.
 *
 * @returns JSX element suitable for passing to `render`.
 */
function PhraseLinkByIdMapReader() {
  const map = usePhraseLinkByIdMap();
  return <span data-testid="id-map-size">{map.size}</span>;
}

/**
 * Renders a component that calls `usePhraseLinkByIdMap` without a provider, to assert it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
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

  it('mergePhrases grows the target phrase in one dispatch and calls onSave once', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'merge' }));

    // A single dispatch means a single save — the intermediate state where tokens belonged to two
    // phrases is never observed.
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

// ---------------------------------------------------------------------------
// useSegmentFreeTranslation
// ---------------------------------------------------------------------------

/** A `TextAnalysis` with an approved segment analysis carrying a free translation in `'und'`. */
const SEGMENT_ANALYSIS_WITH_TRANSLATION: TextAnalysis = {
  segmentAnalyses: [
    { id: 'sa-1', surfaceText: 'In the beginning', freeTranslation: { und: 'au commencement' } },
  ],
  segmentAnalysisLinks: [{ analysisId: 'sa-1', status: 'approved', segmentId: 'seg-1' }],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

/**
 * Renders the free translation for a given segmentId, used to assert on
 * `useSegmentFreeTranslation`.
 *
 * @param props - Component props.
 * @param props.segmentId - Segment id to look up.
 * @returns JSX element.
 */
function SegmentTranslationReader({ segmentId }: Readonly<{ segmentId: string }>) {
  const value = useSegmentFreeTranslation(segmentId);
  return <span data-testid="segment-translation">{value}</span>;
}

/**
 * Renders a component that calls `useSegmentFreeTranslation` without a provider, to assert it
 * throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
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

// ---------------------------------------------------------------------------
// useSegmentFreeTranslationDispatch
// ---------------------------------------------------------------------------

/**
 * Renders a button that writes a segment free translation via `useSegmentFreeTranslationDispatch`.
 *
 * @param props - Component props.
 * @param props.segmentId - Segment id to write.
 * @param props.surfaceText - Segment baseline text to store.
 * @param props.value - Free-translation value to write.
 * @returns JSX element.
 */
function SegmentTranslationWriter({
  segmentId,
  surfaceText,
  value,
}: Readonly<{ segmentId: string; surfaceText: string; value: string }>) {
  const dispatch = useSegmentFreeTranslationDispatch();
  return (
    <button onClick={() => dispatch(segmentId, surfaceText, value)} type="button">
      write
    </button>
  );
}

/**
 * Renders a component that calls `useSegmentFreeTranslationDispatch` without a provider, to assert
 * it throws.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function SegmentTranslationDispatchUser() {
  useSegmentFreeTranslationDispatch();
  return undefined;
}

describe('useSegmentFreeTranslationDispatch', () => {
  it('writes the segment free translation and triggers onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onSave={onSave}>
        <SegmentTranslationWriter
          segmentId="seg-1"
          surfaceText="In the beginning"
          value="au commencement"
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'write' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.segmentAnalyses[0]).toMatchObject({
      surfaceText: 'In the beginning',
      freeTranslation: { und: 'au commencement' },
    });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SegmentTranslationDispatchUser />)).toThrow(
      'useSegmentFreeTranslationDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

// ---------------------------------------------------------------------------
// Morpheme hooks
// ---------------------------------------------------------------------------

/**
 * Renders the morpheme forms for a token, used to assert on `useMorphemes`.
 *
 * @param props.tokenRef - Token ref to subscribe to.
 * @returns JSX element with joined morpheme forms.
 */
function MorphemeReader({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const morphemes = useMorphemes(tokenRef);
  return <span data-testid="morphemes">{morphemes.map((m) => m.form).join(',')}</span>;
}

/**
 * Renders the analysis language, used to assert on `useAnalysisLanguage`.
 *
 * @returns JSX element with the analysis language string.
 */
function LanguageReader() {
  const lang = useAnalysisLanguage();
  return <span data-testid="lang">{lang}</span>;
}

/**
 * Renders a button that dispatches a morpheme breakdown, used to test
 * `useMorphemeBreakdownDispatch`.
 *
 * @param props.tokenRef - Token ref to write.
 * @param props.surfaceText - Surface text of the token.
 * @param props.forms - Morpheme forms to write.
 * @param props.writingSystem - Writing system of the token's surface text.
 * @returns JSX element suitable for passing to `render`.
 */
function MorphemeWriter({
  tokenRef,
  surfaceText,
  forms,
  writingSystem,
}: Readonly<{ tokenRef: string; surfaceText: string; forms: string[]; writingSystem: string }>) {
  const dispatch = useMorphemeBreakdownDispatch();
  return (
    <button onClick={() => dispatch(tokenRef, surfaceText, forms, writingSystem)} type="button">
      break
    </button>
  );
}

/**
 * Renders a button that dispatches a morpheme breakdown deletion, used to test
 * `useMorphemeDeleteDispatch`.
 *
 * @param props.tokenRef - Token ref whose breakdown to delete.
 * @returns JSX element suitable for passing to `render`.
 */
function MorphemeDeleter({ tokenRef }: Readonly<{ tokenRef: string }>) {
  const dispatch = useMorphemeDeleteDispatch();
  return (
    <button onClick={() => dispatch(tokenRef)} type="button">
      delete-morphemes
    </button>
  );
}

/**
 * Renders a button that dispatches a morpheme gloss, used to test `useMorphemeGlossDispatch`.
 *
 * @param props.tokenRef - Token ref to write.
 * @param props.morphemeId - Morpheme id to gloss.
 * @param props.value - Gloss value.
 * @returns JSX element suitable for passing to `render`.
 */
function MorphemeGlossWriter({
  tokenRef,
  morphemeId,
  value,
}: Readonly<{ tokenRef: string; morphemeId: string; value: string }>) {
  const dispatch = useMorphemeGlossDispatch();
  return (
    <button onClick={() => dispatch(tokenRef, morphemeId, value)} type="button">
      gloss
    </button>
  );
}

/**
 * Renders a component that calls `useMorphemes` without a provider, used to test the error.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function MorphemesUser() {
  useMorphemes('tok-1');
  return undefined;
}

/**
 * Renders a component that calls `useAnalysisLanguage` without a provider, used to test the error.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function LanguageUser() {
  useAnalysisLanguage();
  return undefined;
}

/**
 * Renders a component that calls `useMorphemeBreakdownDispatch` without a provider.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function MorphemeBreakdownDispatchUser() {
  useMorphemeBreakdownDispatch();
  return undefined;
}

/**
 * Renders a component that calls `useMorphemeGlossDispatch` without a provider.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function MorphemeGlossDispatchUser() {
  useMorphemeGlossDispatch();
  return undefined;
}

/**
 * Renders a component that calls `useMorphemeDeleteDispatch` without a provider.
 *
 * @returns Nothing — only mounted to trigger the throw.
 */
function MorphemeDeleteDispatchUser() {
  useMorphemeDeleteDispatch();
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
      id: 'ta-1',
      surfaceText: 'unbelievable',
      morphemes: [
        { id: 'm-1', form: 'un-', writingSystem: 'und' },
        { id: 'm-2', form: 'believe', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
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
  it('writes morphemes and calls onSave', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und" onSave={onSave}>
        <MorphemeWriter
          tokenRef="tok-1"
          surfaceText="cat"
          forms={['ca', '-t']}
          writingSystem="en"
        />
        <MorphemeReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'break' }));

    expect(screen.getByTestId('morphemes')).toHaveTextContent('ca,-t');
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses).toHaveLength(1);
    expect(saved.tokenAnalyses[0].morphemes).toHaveLength(2);
    expect(saved.tokenAnalyses[0].morphemes?.[0].writingSystem).toBe('en');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<MorphemeBreakdownDispatchUser />)).toThrow(
      'useMorphemeBreakdownDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useMorphemeDeleteDispatch', () => {
  it('removes the morpheme breakdown and calls onSave', async () => {
    const onSave = jest.fn();
    const ta: TokenAnalysis = {
      id: 'ta-1',
      surfaceText: 'cat',
      morphemes: [
        { id: 'm-1', form: 'ca', writingSystem: 'und' },
        { id: 'm-2', form: '-t', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
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
    render(
      <AnalysisStoreProvider initialAnalysis={analysis} analysisLanguage="und" onSave={onSave}>
        <MorphemeDeleter tokenRef="tok-1" />
        <MorphemeReader tokenRef="tok-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'delete-morphemes' }));

    expect(screen.getByTestId('morphemes')).toHaveTextContent('');
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // The analysis carried no gloss, so the now-empty record and its link are removed entirely.
    expect(saved.tokenAnalyses).toHaveLength(0);
    expect(saved.tokenAnalysisLinks).toHaveLength(0);
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<MorphemeDeleteDispatchUser />)).toThrow(
      'useMorphemeDeleteDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

describe('useMorphemeGlossDispatch', () => {
  it('writes a morpheme gloss and calls onSave', async () => {
    const onSave = jest.fn();
    const ta: TokenAnalysis = {
      id: 'ta-1',
      surfaceText: 'cat',
      morphemes: [
        { id: 'm-1', form: 'ca', writingSystem: 'und' },
        { id: 'm-2', form: '-t', writingSystem: 'und' },
      ],
    };
    const link: TokenAnalysisLink = {
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
    render(
      <AnalysisStoreProvider initialAnalysis={analysis} analysisLanguage="und" onSave={onSave}>
        <MorphemeGlossWriter tokenRef="tok-1" morphemeId="m-1" value="prefix" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'gloss' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ und: 'prefix' });
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<MorphemeGlossDispatchUser />)).toThrow(
      'useMorphemeGlossDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});

/**
 * Reports its `isEditing` prop through {@link useReportGlossEditing}, used to drive the provider's
 * pending-edits accounting from tests.
 *
 * @param props - Component props.
 * @param props.isEditing - Whether this stand-in input currently holds uncommitted text.
 * @returns An empty fragment; the component exists only for its hook side effect.
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
 *
 * @param props.tokenRef - Token ref to resolve.
 * @param props.surfaceText - The token's surface text.
 * @param props.sink - Array each render appends its resolved value to (for render-count
 *   assertions).
 * @returns JSX element suitable for passing to `render`.
 */
function ResolvedReader({
  tokenRef,
  surfaceText,
  sink,
}: Readonly<{
  tokenRef: string;
  surfaceText: string;
  sink?: (ResolvedTokenAnalysis | undefined)[];
}>) {
  const resolved = useResolvedTokenAnalysis(tokenRef, surfaceText);
  sink?.push(resolved);
  return <span data-testid="resolved">{resolved?.status ?? 'none'}</span>;
}

/**
 * Renders a button that approves a chosen analysis for a token, used to test
 * `useApproveAnalysisDispatch`.
 *
 * @param props.tokenRef - Token ref to approve for.
 * @param props.surfaceText - Surface text snapshotted on the new link.
 * @param props.analysisId - Payload id to approve.
 * @returns JSX element suitable for passing to `render`.
 */
function Approver({
  tokenRef,
  surfaceText,
  analysisId,
}: Readonly<{ tokenRef: string; surfaceText: string; analysisId: string }>) {
  const approve = useApproveAnalysisDispatch();
  return (
    <button onClick={() => approve(tokenRef, surfaceText, analysisId)} type="button">
      approve
    </button>
  );
}

describe('useShowSuggestions', () => {
  /**
   * Renders the active show-suggestions flag, used to assert on `useShowSuggestions`.
   *
   * @returns JSX element suitable for passing to `render`.
   */
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

    // Glossing 'cat' rebuilds the pool but leaves the 'logos' suggestion untouched; the custom
    // equalityFn keeps the selected value referentially stable so the reader never re-renders.
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

describe('useApproveAnalysisDispatch', () => {
  it('approves the chosen payload for the token, flipping it from suggested to approved', async () => {
    const onSave = jest.fn();
    render(
      <AnalysisStoreProvider
        initialAnalysis={makeAnalysisWithGloss('tok-1', 'w', 'logos')}
        analysisLanguage="und"
        onSave={onSave}
      >
        <ResolvedReader tokenRef="tok-2" surfaceText="logos" />
        <Approver tokenRef="tok-2" surfaceText="logos" analysisId="tok-1-analysis" />
      </AnalysisStoreProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('suggested');

    await userEvent.click(screen.getByRole('button', { name: 'approve' }));

    expect(screen.getByTestId('resolved')).toHaveTextContent('approved');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // No new payload — tok-2 links to the existing shared analysis (frequency now 2).
    expect(saved.tokenAnalyses).toHaveLength(1);
    const tok2Link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(tok2Link?.analysisId).toBe('tok-1-analysis');
    expect(tok2Link?.status).toBe('approved');
  });

  it('throws when called outside an AnalysisStoreProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Approver tokenRef="tok-1" surfaceText="logos" analysisId="a" />)).toThrow(
      'useApproveAnalysisDispatch must be used inside an AnalysisStoreProvider',
    );
  });
});
