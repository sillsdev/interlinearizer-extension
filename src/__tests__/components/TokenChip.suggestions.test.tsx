/**
 * @file Integration tests for {@link TokenChip}'s suggestion combobox (the focus-triggered pop-down
 *   that replaced the inline accept/promote column). Unlike `TokenChip.test.tsx`, this file uses
 *   the real {@link AnalysisStoreProvider} so suggestions are derived from a real analysis pool end
 *   to end. The dropdown opens on focus of the gloss (clicking it), and a row is approved by
 *   clicking it or by keyboard (arrows + Enter). The "+" button — rendered only for a token with
 *   more than one suggestion — re-summons the dropdown over typed text.
 */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, Token, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { TokenChip } from '../../components/TokenChip';
import { emptyAnalysis } from '../../types/empty-factories';

beforeEach(() => {
  jest
    .mocked(useLocalizedStrings)
    .mockReturnValue([{ '%interlinearizer_glossInput_placeholder%': 'gloss' }, false]);
  // jsdom does not implement scrollIntoView; the dropdown calls it to keep the active row in view.
  Element.prototype.scrollIntoView = jest.fn();
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
 * @param options.onGlossChange - Optional gloss-write spy.
 * @returns The Testing Library render result.
 */
function renderChip(
  token: Token & { type: 'word' },
  {
    initialAnalysis,
    showSuggestions = true,
    onSave,
    onGlossChange,
  }: Readonly<{
    initialAnalysis: TextAnalysis;
    showSuggestions?: boolean;
    onSave?: (analysis: TextAnalysis) => void;
    onGlossChange?: (tokenRef: string, value: string) => void;
  }>,
) {
  return render(
    <AnalysisStoreProvider
      analysisLanguage="en"
      initialAnalysis={initialAnalysis}
      showSuggestions={showSuggestions}
      onSave={onSave}
      onGlossChange={onGlossChange}
    >
      <TokenChip token={token} onFocus={() => {}} />
    </AnalysisStoreProvider>,
  );
}

/**
 * Focuses a chip's gloss input (which opens the dropdown whenever the token has suggestions),
 * returning the input element.
 *
 * @param surfaceText - The token's surface form, used to find the labeled input.
 * @returns The focused gloss input element.
 */
async function focusGloss(surfaceText: string): Promise<HTMLElement> {
  const input = screen.getByLabelText(`Gloss for ${surfaceText}`);
  await userEvent.click(input);
  return input;
}

describe('TokenChip suggested placeholder', () => {
  it('shows the suggested gloss as the placeholder of an empty, unfocused input', () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = screen.getByLabelText('Gloss for logos');
    // Visible at a glance — no focus or hover — so the row reveals which tokens have a suggestion.
    expect(input).toHaveAttribute('placeholder', 'word');
    expect(input.className).toContain('tw:placeholder:gloss-suggested');
  });

  it('falls back to the generic placeholder when the token has no suggestion', () => {
    renderChip(wordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    const input = screen.getByLabelText('Gloss for unseen');
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });

  it('uses the generic placeholder when suggestions are turned off', () => {
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      showSuggestions: false,
    });

    const input = screen.getByLabelText('Gloss for logos');
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });

  it('reverts to the generic placeholder once the user types a gloss', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    const input = screen.getByLabelText('Gloss for logos');
    expect(input).toHaveAttribute('placeholder', 'word');

    await userEvent.type(input, 'mine');

    // With a non-empty draft the typed value shows, so the suggested ghost text no longer applies.
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });
});

describe('TokenChip suggestion dropdown', () => {
  it('opens on focus of an empty input and shows the suggested gloss in green', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    // Closed until focused: no row is in the document yet.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await focusGloss('logos');

    const accept = screen.getByTestId('suggestion-accept');
    expect(accept).toHaveTextContent('word');
    expect(accept.className).toContain('tw:gloss-suggested');
  });

  it('does not open and shows no + button when showSuggestions is off', async () => {
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      showSuggestions: false,
    });

    await focusGloss('logos');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('shows no + button when the token has only one suggestion', async () => {
    // A single suggestion needs no chooser: the ghost placeholder advertises it and focusing the
    // gloss opens the dropdown to accept it, so the "+" button is reserved for tokens with a choice.
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss('logos');

    // The dropdown is open (its single accept row is present) but no chooser button is rendered,
    // even on hover.
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    await userEvent.hover(input);
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('shows no suggestion affordances on an approved token whose only pool entry is its own decision', async () => {
    // The lone pool entry IS this token's approved analysis, so there is no alternative to promote:
    // re-approving the same payload would be a no-op, so the dropdown and + button stay hidden.
    renderChip(wordToken('tok-approved', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    await focusGloss('logos');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Gloss for logos')).toHaveValue('word');
  });

  it('auto-opens the dropdown on an approved token that has a different pool alternative', async () => {
    // r1 is approved to ta-river; the pool also holds ta-fin ('finance') for the homograph 'bank'.
    // The approved payload is filtered out of the dropdown, leaving the genuine alternative. Focusing
    // the gloss opens the dropdown over the committed gloss even though the token already has a
    // decision; with only one alternative there is no "+" button.
    renderChip(wordToken('r1', 'bank'), { initialAnalysis: homographBankPool('finance') });

    await focusGloss('bank');

    // On an already-approved token every alternative is a blue "promote" row, not the green "accept"
    // row — there is no suggestion to accept, only candidates to promote to.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    const promote = screen.getByTestId('suggestion-candidate');
    expect(promote).toHaveTextContent('finance');
    expect(promote.className).toContain('tw:gloss-candidate');
    // The already-approved 'riverbank' is excluded — only the alternative is offered.
    expect(screen.queryByText('riverbank')).not.toBeInTheDocument();
  });

  it('shows no suggestion affordances on an approved token whose surface form has drifted out of the pool', async () => {
    // tok-approved keeps its approved decision (keyed by token ref), but its surface text has
    // drifted to a form with no pool entry, so there is no pool alternative and nothing to summon.
    renderChip(wordToken('tok-approved', 'drifted'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    await focusGloss('drifted');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('does not open for a surface form that is not in the pool', async () => {
    renderChip(wordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    await focusGloss('unseen');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('shows no suggestion affordances on a disabled chip', () => {
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
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('closes once the user starts typing their own gloss', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss('logos');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Gloss for logos'), 'mine');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('re-opens when the input is cleared back to empty', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    const input = await focusGloss('logos');
    await userEvent.type(input, 'mine');
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.clear(input);

    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
  });

  it('does not open when the top pick has no gloss in the active language', async () => {
    // The approved payload has only a French gloss; matched for 'logos' but blank in English.
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved(undefined) });

    await focusGloss('logos');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('approves the suggestion when its row is clicked: it disappears and the gloss commits', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onSave,
    });

    await focusGloss('logos');
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

  it('surfaces homograph candidates and promotes the chosen one in blue', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss('bank');

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

  it('omits a candidate that has no gloss in the active language', async () => {
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool(undefined) });

    await focusGloss('bank');

    // The suggested pick still shows, but the gloss-less candidate is not rendered as a row.
    expect(screen.getByTestId('suggestion-accept')).toHaveTextContent('riverbank');
    expect(screen.queryByTestId('suggestion-candidate')).not.toBeInTheDocument();
  });

  it('falls through a blank-in-active-language top pick to the highest-ranked glossed analysis', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographTopBlankPool(), onSave });

    await focusGloss('bank');

    // ta-blank (French-only, frequency 2) outranks ta-fin but has no English gloss, so rather than
    // hiding the whole suggestion the top row surfaces ta-fin's 'finance', with no leftover candidate
    // row (ta-blank is the only other analysis and it's gloss-less in English).
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

describe('TokenChip suggestion keyboard navigation', () => {
  it('arrow-down highlights the top row and Enter approves it', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss('bank');
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByTestId('suggestion-accept')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-river');
  });

  it('Enter with nothing highlighted approves the top suggestion', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onSave,
    });

    await focusGloss('logos');
    // No arrow press: activeIndex is -1, so Enter falls back to the top row.
    await userEvent.keyboard('{Enter}');

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(link?.analysisId).toBe('ta-1');
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('arrow-down stops at the last row and arrow-up returns to the no-highlight state', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss('bank');
    // Two rows: riverbank (0), finance (1). Down past the end stays on the last row.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByTestId('suggestion-accept')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('suggestion-candidate')).toHaveAttribute('aria-selected', 'true');

    // Up twice returns through the top row to no highlight; a further up stays at no highlight.
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(screen.getByTestId('suggestion-accept')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('suggestion-candidate')).toHaveAttribute('aria-selected', 'false');

    // With nothing highlighted, Enter approves the top row.
    await userEvent.keyboard('{Enter}');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-river');
  });

  it('hovering a row highlights it, and Enter then approves that row', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss('bank');
    await userEvent.hover(screen.getByTestId('suggestion-candidate'));

    expect(screen.getByTestId('suggestion-candidate')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('suggestion-accept')).toHaveAttribute('aria-selected', 'false');

    await userEvent.keyboard('{Enter}');

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-fin');
  });

  it('Escape closes the dropdown without committing and keeps focus in the input', async () => {
    const onGlossChange = jest.fn();
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onGlossChange,
    });

    const input = await focusGloss('logos');
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
    expect(onGlossChange).not.toHaveBeenCalled();
  });

  it('Enter while the dropdown is closed commits the typed draft', async () => {
    const onGlossChange = jest.fn();
    renderChip(wordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onGlossChange,
    });

    const input = await focusGloss('logos');
    await userEvent.type(input, 'mine'); // typing closes the dropdown
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');

    expect(onGlossChange).toHaveBeenCalledWith('tok-2', 'mine');
    expect(input).toHaveValue('mine');
  });

  it('arrow-down re-opens the dropdown after typing closed it', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss('logos');
    await userEvent.type(input, 'mine'); // typing closes the dropdown
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
  });

  it('arrow-down does nothing when the token has no suggestions', async () => {
    renderChip(wordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss('unseen');
    await userEvent.keyboard('{ArrowDown}');

    // No combobox here, so there is no dropdown to open and no aria-expanded state.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-expanded');
  });
});

describe('TokenChip suggestion + button', () => {
  it('fades in on hover even when the input is not focused, and fades out again on unhover', async () => {
    // The homograph 'bank' has two suggestions, so the "+" button is rendered; at rest it is present
    // but invisible and non-interactive (its slot is reserved so the chip never reflows).
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const addButton = screen.getByTestId('suggestion-add');
    expect(addButton).toHaveClass('tw:opacity-0');
    expect(addButton).toHaveClass('tw:pointer-events-none');
    expect(addButton).toHaveAttribute('aria-hidden', 'true');

    await userEvent.hover(screen.getByText('bank'));
    expect(addButton).not.toHaveClass('tw:opacity-0');
    expect(addButton).toHaveAttribute('aria-hidden', 'false');

    await userEvent.unhover(screen.getByText('bank'));
    // Pointer gone and the input never focused, so the button fades back out.
    expect(addButton).toHaveClass('tw:opacity-0');
    expect(addButton).toHaveAttribute('aria-hidden', 'true');
  });

  it('force-opens the dropdown over already-typed text and selecting replaces the draft', async () => {
    const onSave = jest.fn();
    renderChip(wordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    const input = await focusGloss('bank');
    await userEvent.type(input, 'mine'); // closes the auto-opened dropdown
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('suggestion-add'));
    expect(screen.getByTestId('suggestion-accept')).toHaveTextContent('riverbank');

    await userEvent.click(screen.getByTestId('suggestion-accept'));

    // The selection wins over the abandoned 'mine' draft: the committed gloss flows back in.
    expect(input).toHaveValue('riverbank');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    expect(saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new')?.analysisId).toBe(
      'ta-river',
    );
  });

  it('toggles the dropdown closed when clicked while open', async () => {
    renderChip(wordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    await focusGloss('bank');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('suggestion-add'));

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });
});

describe('TokenChip suggestion dropdown scrolling', () => {
  /**
   * Stubs the gloss input's `getBoundingClientRect` so the dropdown's scroll handler sees a
   * definite on- or off-screen anchor (jsdom returns an all-zero rect by default, which reads as
   * on-screen).
   *
   * @param top - The faked viewport-relative top of the input; `bottom` is `top + 10`.
   */
  function stubGlossRect(top: number): void {
    jest.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom: top + 10,
      left: 0,
      right: 50,
      x: 0,
      y: top,
      width: 50,
      height: 10,
      toJSON: () => ({}),
    });
  }

  it('stays open and follows the anchor when the surrounding view scrolls it in view', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss('logos');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    // The token strip centers the focused phrase on focus: the anchor moves but stays in view, so
    // the dropdown repositions under it rather than dismissing the panel that just opened.
    stubGlossRect(100);
    fireEvent.scroll(window);

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    // `left` is the input's center (left 0 + width 50 / 2) and the panel is translated -50% so it
    // stays centered on the input; `min-width` pins it to at least the input's width.
    expect(listbox).toHaveStyle({
      top: '112px',
      left: '25px',
      minWidth: '50px',
      transform: 'translateX(-50%)',
    });
  });

  it('closes when the surrounding view scrolls the anchor out of the viewport', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss('logos');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    // A far user scroll pushes the anchor above the top of the viewport, abandoning this token.
    stubGlossRect(-50);
    fireEvent.scroll(window);

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('closes when the surrounding view scrolls the anchor below the viewport', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss('logos');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    // A far user scroll pushes the anchor below the bottom edge, abandoning this token.
    stubGlossRect(window.innerHeight + 50);
    fireEvent.scroll(window);

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('stays open when the dropdown list itself is scrolled', async () => {
    renderChip(wordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss('logos');

    fireEvent.scroll(screen.getByRole('listbox'));

    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
  });
});
