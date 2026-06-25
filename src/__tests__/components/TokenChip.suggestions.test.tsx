/**
 * @file Integration tests for {@link TokenChip}'s suggestion rendering (accept / promote). Unlike
 *   `TokenChip.test.tsx`, this file uses the real {@link AnalysisStoreProvider} so suggestions are
 *   derived from a real analysis pool end to end.
 */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, Token, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { TokenChip } from '../../components/TokenChip';
import { MorphemeGlossInput } from '../../components/MorphemeEditor';
import { emptyAnalysis } from '../../types/empty-factories';

beforeEach(() => {
  jest
    .mocked(useLocalizedStrings)
    .mockReturnValue([{ '%interlinearizer_glossInput_placeholder%': 'gloss' }, false]);
});

/**
 * Builds a word token spanning its surface text.
 *
 * @param ref - The token ref.
 * @param surfaceText - The token's surface text.
 * @returns A word `Token`.
 */
function wordToken(ref: string, surfaceText: string): Token & { type: 'word' } {
  return {
    ref,
    surfaceText,
    writingSystem: 'en',
    type: 'word',
    charStart: 0,
    charEnd: surfaceText.length,
  };
}

/**
 * Builds an analysis seeding one approved payload, so a different token with the same surface form
 * resolves to it as a suggestion.
 *
 * @param gloss - The English gloss on the approved payload, or `undefined` for a payload with no
 *   English gloss.
 * @param surfaceText - The approved payload's surface form.
 * @returns A `TextAnalysis` with one approved link from `tok-approved`.
 */
function poolWithOneApproved(gloss: string | undefined, surfaceText = 'logos'): TextAnalysis {
  const ta: TokenAnalysis = {
    id: 'ta-1',
    surfaceText,
    ...(gloss === undefined ? {} : { gloss: { en: gloss } }),
  };
  const link: TokenAnalysisLink = {
    analysisId: 'ta-1',
    status: 'approved',
    token: { tokenRef: 'tok-approved', surfaceText },
  };
  return { ...emptyAnalysis(), tokenAnalyses: [ta], tokenAnalysisLinks: [link] };
}

/**
 * Builds an analysis for the homograph 'bank': `riverbank` approved twice (the suggested pick) and
 * `finance` approved once (a candidate).
 *
 * @param financeGloss - The English gloss on the candidate payload, or `undefined` for none.
 * @returns A `TextAnalysis` with two competing approved payloads for 'bank'.
 */
function homographBankPool(financeGloss: string | undefined): TextAnalysis {
  const river: TokenAnalysis = { id: 'ta-river', surfaceText: 'bank', gloss: { en: 'riverbank' } };
  const fin: TokenAnalysis = {
    id: 'ta-fin',
    surfaceText: 'bank',
    ...(financeGloss === undefined ? {} : { gloss: { en: financeGloss } }),
  };
  const links: TokenAnalysisLink[] = [
    { analysisId: 'ta-river', status: 'approved', token: { tokenRef: 'r1', surfaceText: 'bank' } },
    { analysisId: 'ta-river', status: 'approved', token: { tokenRef: 'r2', surfaceText: 'bank' } },
    { analysisId: 'ta-fin', status: 'approved', token: { tokenRef: 'f1', surfaceText: 'bank' } },
  ];
  return { ...emptyAnalysis(), tokenAnalyses: [river, fin], tokenAnalysisLinks: links };
}

/**
 * Builds the homograph 'bank' where the MOST-frequent analysis has no active-language (English)
 * gloss — only French — and a lower-frequency one carries `en:'finance'`. Exercises falling through
 * a blank-in-active-language top pick to the next glossed analysis.
 *
 * @returns A `TextAnalysis` whose top-ranked 'bank' payload is blank in English.
 */
function homographTopBlankPool(): TextAnalysis {
  const blank: TokenAnalysis = { id: 'ta-blank', surfaceText: 'bank', gloss: { fr: 'rive' } };
  const fin: TokenAnalysis = { id: 'ta-fin', surfaceText: 'bank', gloss: { en: 'finance' } };
  const links: TokenAnalysisLink[] = [
    { analysisId: 'ta-blank', status: 'approved', token: { tokenRef: 'b1', surfaceText: 'bank' } },
    { analysisId: 'ta-blank', status: 'approved', token: { tokenRef: 'b2', surfaceText: 'bank' } },
    { analysisId: 'ta-fin', status: 'approved', token: { tokenRef: 'f1', surfaceText: 'bank' } },
  ];
  return { ...emptyAnalysis(), tokenAnalyses: [blank, fin], tokenAnalysisLinks: links };
}

/**
 * Renders a {@link TokenChip} inside a real provider seeded with the given analysis pool.
 *
 * @param token - The word token to render.
 * @param options - Provider configuration.
 * @param options.initialAnalysis - The seed analysis (the pool).
 * @param options.showSuggestions - Whether the provider opts into suggestions (default `true`).
 * @param options.onSave - Optional save spy.
 * @returns The Testing Library render result.
 */
function renderChip(
  token: Token & { type: 'word' },
  {
    initialAnalysis,
    showSuggestions = true,
    onSave,
  }: Readonly<{
    initialAnalysis: TextAnalysis;
    showSuggestions?: boolean;
    onSave?: (analysis: TextAnalysis) => void;
  }>,
) {
  return render(
    <AnalysisStoreProvider
      analysisLanguage="en"
      initialAnalysis={initialAnalysis}
      showSuggestions={showSuggestions}
      onSave={onSave}
    >
      <TokenChip token={token} onFocus={() => {}} />
    </AnalysisStoreProvider>,
  );
}

describe('TokenChip suggestions', () => {
  it('shows the suggested gloss in green on an un-approved matching token', () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const accept = screen.getByTestId('suggestion-accept');
    expect(accept).toHaveTextContent('word');
    expect(accept.className).toContain('tw:gloss-suggested');
  });

  it('renders nothing extra when showSuggestions is off', () => {
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      showSuggestions: false,
    });

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('shows no suggestion on an already-approved token', () => {
    renderChip(wordToken('tok-approved', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    // The approved gloss renders in the input as the committed value.
    expect(screen.getByLabelText('Gloss for logos')).toHaveValue('word');
  });

  it('shows no suggestion when the surface form is not in the pool', () => {
    renderChip(wordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('shows no suggestion on a disabled chip', () => {
    render(
      <AnalysisStoreProvider
        analysisLanguage="en"
        initialAnalysis={poolWithOneApproved('word')}
        showSuggestions
      >
        <TokenChip token={wordToken('tok-2', 'logos')} onFocus={() => {}} disabled />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('hides the suggestion once the user starts typing their own gloss', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Gloss for logos'), 'mine');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('does not show a suggestion whose top pick has no gloss in the active language', () => {
    // The approved payload has only a French gloss; matched for 'logos' but blank in English.
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved(undefined) });

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('accepting the suggestion approves it: the suggestion disappears and the gloss is committed', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onSave,
    });

    await userEvent.click(screen.getByTestId('suggestion-accept'));

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Gloss for logos')).toHaveValue('word');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // No new payload — tok-2 links to the existing shared analysis (frequency now 2).
    expect(saved.tokenAnalyses).toHaveLength(1);
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(link?.analysisId).toBe('ta-1');
    expect(link?.status).toBe('approved');
  });

  it('surfaces homograph candidates and promotes the chosen one', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    // The most-approved payload is suggested; the competing one is a blue candidate.
    expect(screen.getByTestId('suggestion-accept')).toHaveTextContent('riverbank');
    const candidate = screen.getByTestId('suggestion-candidate');
    expect(candidate).toHaveTextContent('finance');
    expect(candidate.className).toContain('tw:gloss-candidate');

    await userEvent.click(candidate);

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-fin');
    expect(link?.status).toBe('approved');
  });

  it('omits a candidate that has no gloss in the active language', () => {
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool(undefined) });

    // The suggested pick still shows, but the gloss-less candidate is not rendered as a button.
    expect(screen.getByTestId('suggestion-accept')).toHaveTextContent('riverbank');
    expect(screen.queryByTestId('suggestion-candidate')).not.toBeInTheDocument();
  });

  it('falls through a blank-in-active-language top pick to the highest-ranked glossed analysis', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographTopBlankPool(), onSave });

    // ta-blank (French-only, frequency 2) outranks ta-fin but has no English gloss, so rather than
    // hiding the whole suggestion the accept button surfaces ta-fin's 'finance', with no leftover
    // candidate button (ta-blank is the only other analysis and it's gloss-less in English).
    const accept = screen.getByTestId('suggestion-accept');
    expect(accept).toHaveTextContent('finance');
    expect(screen.queryByTestId('suggestion-candidate')).not.toBeInTheDocument();

    await userEvent.click(accept);

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-fin');
    expect(link?.status).toBe('approved');
  });
});

describe('held global-edit reverts the input draft', () => {
  // The confirmation modal needs its real strings (resetMocks wipes the file-level default).
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([
      {
        '%interlinearizer_glossInput_placeholder%': 'gloss',
        '%interlinearizer_morphemeGloss_label%': 'Gloss for {form}',
        '%interlinearizer_globalEdit_title%': 'Used by {count}',
        '%interlinearizer_globalEdit_body%': 'Shared by {count}',
        '%interlinearizer_globalEdit_updateAll%': 'Update all {count}',
        '%interlinearizer_globalEdit_fork%': 'Make a separate analysis',
        '%interlinearizer_globalEdit_cancel%': 'Cancel',
      },
      false,
    ]);
  });

  it('reverts the gloss input draft when a shared-payload gloss edit is held for confirmation', async () => {
    const shared: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'shared', surfaceText: 'logos', gloss: { en: 'word' } }],
      tokenAnalysisLinks: [
        {
          analysisId: 'shared',
          status: 'approved',
          token: { tokenRef: 'tok-1', surfaceText: 'logos' },
        },
        {
          analysisId: 'shared',
          status: 'approved',
          token: { tokenRef: 'tok-2', surfaceText: 'logos' },
        },
      ],
    };
    render(
      <AnalysisStoreProvider analysisLanguage="en" initialAnalysis={shared} confirmGlobalEdits>
        <TokenChip token={wordToken('tok-1', 'logos')} onFocus={() => {}} />
      </AnalysisStoreProvider>,
    );

    const input = screen.getByLabelText('Gloss for logos');
    expect(input).toHaveValue('word');
    await userEvent.clear(input);
    await userEvent.type(input, 'changed');
    await userEvent.tab(); // blur holds the edit for the modal

    expect(screen.getByTestId('global-edit-update-all')).toBeInTheDocument();
    // The abandoned draft is reverted to the committed gloss rather than stranded in the input.
    expect(input).toHaveValue('word');
  });

  it('reverts a morpheme gloss input draft when a shared-payload edit is held for confirmation', async () => {
    const shared: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          id: 'shared',
          surfaceText: 'cats',
          morphemes: [{ id: 'm1', form: 'cat', writingSystem: 'en' }],
        },
      ],
      tokenAnalysisLinks: [
        {
          analysisId: 'shared',
          status: 'approved',
          token: { tokenRef: 'tok-1', surfaceText: 'cats' },
        },
        {
          analysisId: 'shared',
          status: 'approved',
          token: { tokenRef: 'tok-2', surfaceText: 'cats' },
        },
      ],
    };
    render(
      <AnalysisStoreProvider analysisLanguage="en" initialAnalysis={shared} confirmGlobalEdits>
        <MorphemeGlossInput
          morpheme={{ id: 'm1', form: 'cat', writingSystem: 'en' }}
          tokenRef="tok-1"
          analysisLanguage="en"
          disabled={false}
        />
      </AnalysisStoreProvider>,
    );

    const input = screen.getByLabelText('Gloss for cat');
    await userEvent.type(input, 'feline');
    await userEvent.tab(); // blur holds the edit for the modal

    expect(screen.getByTestId('global-edit-update-all')).toBeInTheDocument();
    // The abandoned morpheme gloss draft reverts to its (empty) committed value.
    expect(input).toHaveValue('');
  });
});
