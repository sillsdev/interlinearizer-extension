// Suggestion-combobox tests run against the real analysis store rather than mocks.
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextAnalysis, Token, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { TokenChip } from '../../components/TokenChip';
import { emptyAnalysis } from '../../types/empty-factories';
import { makeWordToken } from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

beforeEach(() => {
  mockKeyAsValueLocalizedStrings();
  // jsdom does not implement scrollIntoView; the dropdown calls it to keep the active row in view.
  Element.prototype.scrollIntoView = jest.fn();
});

/**
 * Builds an analysis seeding one approved payload, so a different token with the same surface form
 * resolves to it as a suggestion.
 *
 * @param gloss - Gloss text, filed under `en` to match the rendered active analysis language, or
 *   `undefined` to leave the payload unglossed.
 * @param surfaceText - Surface form carried by both the approved payload and the token that must
 *   match it.
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
 * @param financeGloss - Gloss text for the candidate payload, filed under `en` to match the
 *   rendered active analysis language, or `undefined` to leave it unglossed.
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

/** Renders a {@link TokenChip} inside a real provider seeded with the given analysis pool. */
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
      <TokenChip
        glossPlaceholder="gloss"
        removeLabelTemplate="%interlinearizer_tokenChip_removeFromPhrase%"
        token={token}
        onFocus={() => {}}
      />
    </AnalysisStoreProvider>,
  );
}

/** Accessible name of a chip's gloss input; localized strings resolve to their own key in tests. */
const GLOSS_INPUT_LABEL = '%interlinearizer_tokenChip_glossLabel%';

/** The suggested gloss as the placeholder renders it, padded to clear the faked italic's lean. */
function ghost(gloss: string): string {
  return `${gloss}\u2009`;
}

/**
 * Focuses the rendered chip's gloss input, which opens the dropdown whenever the token has
 * suggestions. Each test renders exactly one chip, so the label alone identifies it.
 */
async function focusGloss(): Promise<HTMLElement> {
  const input = screen.getByLabelText(GLOSS_INPUT_LABEL);
  await userEvent.click(input);
  return input;
}

describe('TokenChip suggested placeholder', () => {
  it('shows the suggested gloss as the placeholder of an empty, unfocused input', () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = screen.getByLabelText(GLOSS_INPUT_LABEL);
    // Visible at a glance — no focus or hover — so the row reveals which tokens have a suggestion.
    expect(input).toHaveAttribute('placeholder', ghost('word'));
    expect(input.className).toContain('tw:placeholder:gloss-suggested');
  });

  it('pads the suggested placeholder with one thin space, on the trailing edge only', () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    // Spelled out rather than built from `ghost`, so changing the pad character has to be a
    // deliberate edit here instead of riding along with the helper every other assertion goes
    // through.
    expect(screen.getByLabelText(GLOSS_INPUT_LABEL)).toHaveAttribute('placeholder', 'word\u2009');
  });

  it('falls back to the generic placeholder when the token has no suggestion', () => {
    renderChip(makeWordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    const input = screen.getByLabelText(GLOSS_INPUT_LABEL);
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });

  it('uses the generic placeholder when suggestions are turned off', () => {
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      showSuggestions: false,
    });

    const input = screen.getByLabelText(GLOSS_INPUT_LABEL);
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });

  it('reverts to the generic placeholder once the user types a gloss', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    const input = screen.getByLabelText(GLOSS_INPUT_LABEL);
    expect(input).toHaveAttribute('placeholder', ghost('word'));

    await userEvent.type(input, 'mine');

    // With a non-empty draft the typed value shows, so the suggested ghost text no longer applies.
    expect(input).toHaveAttribute('placeholder', 'gloss');
    expect(input.className).not.toContain('tw:placeholder:gloss-suggested');
  });
});

describe('TokenChip suggestion dropdown', () => {
  it('opens on focus of an empty input and shows the suggested gloss in blue', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    // Closed until focused: no row is in the document yet.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await focusGloss();

    const accept = screen.getByTestId('suggestion-accept');
    expect(accept).toHaveTextContent('word');
    expect(accept.className).toContain('tw:gloss-suggested');
  });

  it('does not open and shows no + button when showSuggestions is off', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      showSuggestions: false,
    });

    await focusGloss();

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('shows no + button when the token has only one suggestion', async () => {
    // A single suggestion needs no chooser: the ghost placeholder advertises it and focusing opens
    // the dropdown to accept it, so the "+" button is reserved for tokens with a choice.
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss();

    // The dropdown is open (single accept row) but no chooser button renders, even on hover.
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    await userEvent.hover(input);
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('shows no suggestion affordances on an approved token whose only pool entry is its own decision', async () => {
    // The lone pool entry IS this token's approved analysis, so there is no alternative to promote:
    // re-approving the same payload would be a no-op, so the dropdown and + button stay hidden.
    renderChip(makeWordToken('tok-approved', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    await focusGloss();

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    expect(screen.getByLabelText(GLOSS_INPUT_LABEL)).toHaveValue('word');
  });

  it('auto-opens the dropdown on an approved token that has a different pool alternative', async () => {
    // r1 is approved to ta-river; the pool also holds ta-fin ('finance') for 'bank'. The approved
    // payload is filtered out, leaving the alternative, and focusing opens the dropdown over the
    // committed gloss; with one alternative there is no "+" button.
    renderChip(makeWordToken('r1', 'bank'), { initialAnalysis: homographBankPool('finance') });

    await focusGloss();

    // On an already-approved token every alternative is a gray "promote" row, not a blue "accept"
    // row: there is nothing to accept, only candidates to promote to.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
    const promote = screen.getByTestId('suggestion-candidate');
    expect(promote).toHaveTextContent('finance');
    expect(promote.className).toContain('tw:gloss-candidate');
    // The already-approved 'riverbank' is excluded; only the alternative is offered.
    expect(screen.queryByText('riverbank')).not.toBeInTheDocument();
  });

  it('shows no suggestion affordances on an approved token whose surface form has drifted out of the pool', async () => {
    // tok-approved keeps its approved decision (keyed by token ref), but its surface text has
    // drifted to a form with no pool entry, so there is no pool alternative and nothing to summon.
    renderChip(makeWordToken('tok-approved', 'drifted'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    await focusGloss();

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('does not open for a surface form that is not in the pool', async () => {
    renderChip(makeWordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    await focusGloss();

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
        <TokenChip
          removeLabelTemplate="%interlinearizer_tokenChip_removeFromPhrase%"
          token={makeWordToken('tok-2', 'logos')}
          onFocus={() => {}}
          disabled
        />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('closes once the user starts typing their own gloss', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    await focusGloss();
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(GLOSS_INPUT_LABEL), 'mine');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('re-opens when the input is cleared back to empty', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });
    const input = await focusGloss();
    await userEvent.type(input, 'mine');
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.clear(input);

    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
  });

  it('does not open when the top pick has no gloss in the active language', async () => {
    // The approved payload has only a French gloss; matched for 'logos' but blank in English.
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved(undefined),
    });

    await focusGloss();

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-add')).not.toBeInTheDocument();
  });

  it('approves the suggestion when its row is clicked: it disappears and the gloss commits', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onSave,
    });

    await focusGloss();
    await userEvent.click(screen.getByTestId('suggestion-accept'));

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.getByLabelText(GLOSS_INPUT_LABEL)).toHaveValue('word');
    const saved: TextAnalysis = onSave.mock.calls[0][0];
    // No new payload — tok-2 links to the existing shared analysis (frequency now 2).
    expect(saved.tokenAnalyses).toHaveLength(1);
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(link?.analysisId).toBe('ta-1');
    expect(link?.status).toBe('approved');
  });

  it('surfaces homograph candidates and promotes the chosen one in grey', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss();

    // The most-approved payload is suggested; the competing one is a grey candidate.
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
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool(undefined) });

    await focusGloss();

    // The suggested pick still shows, but the gloss-less candidate is not rendered as a row.
    expect(screen.getByTestId('suggestion-accept')).toHaveTextContent('riverbank');
    expect(screen.queryByTestId('suggestion-candidate')).not.toBeInTheDocument();
  });

  it('falls through a blank-in-active-language top pick to the highest-ranked glossed analysis', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographTopBlankPool(),
      onSave,
    });

    await focusGloss();

    // ta-blank (French-only, frequency 2) outranks ta-fin but has no English gloss, so the top row
    // surfaces ta-fin's 'finance' instead, with no leftover candidate row (ta-blank is gloss-less in
    // English).
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

/**
 * Builds the homograph 'bank' where `riverbank` is approved three times (`r1`/`r2`/`r3`, the
 * majority) and `finance` once (`f1`, the minority) — so clearing an approved majority token can be
 * tested for previewing the still-majority pick rather than the lone alternative.
 */
function homographMajorityPool(): TextAnalysis {
  const river: TokenAnalysis = { id: 'ta-river', surfaceText: 'bank', gloss: { en: 'riverbank' } };
  const fin: TokenAnalysis = { id: 'ta-fin', surfaceText: 'bank', gloss: { en: 'finance' } };
  const links: TokenAnalysisLink[] = [
    { analysisId: 'ta-river', status: 'approved', token: { tokenRef: 'r1', surfaceText: 'bank' } },
    { analysisId: 'ta-river', status: 'approved', token: { tokenRef: 'r2', surfaceText: 'bank' } },
    { analysisId: 'ta-river', status: 'approved', token: { tokenRef: 'r3', surfaceText: 'bank' } },
    { analysisId: 'ta-fin', status: 'approved', token: { tokenRef: 'f1', surfaceText: 'bank' } },
  ];
  return { ...emptyAnalysis(), tokenAnalyses: [river, fin], tokenAnalysisLinks: links };
}

describe('TokenChip suggestion after clearing an approved gloss', () => {
  it('previews the pool majority, not the lone alternative, when an approved gloss is cleared', async () => {
    // r1 is approved to the majority 'riverbank'; its dropdown offers only the minority 'finance'
    // alternative. On clearing, discounting r1's own approval (3 → 2) keeps 'riverbank' on top, so
    // the accept row and ghost placeholder both surface 'riverbank' — matching what re-derives once
    // the empty value commits on blur, rather than flipping to 'finance'.
    renderChip(makeWordToken('r1', 'bank'), { initialAnalysis: homographMajorityPool() });

    const input = await focusGloss();
    // Before clearing: the approved token shows only the alternative as a promote row.
    expect(screen.getByTestId('suggestion-candidate')).toHaveTextContent('finance');
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.clear(input);

    const accept = screen.getByTestId('suggestion-accept');
    expect(accept).toHaveTextContent('riverbank');
    expect(screen.getByTestId('suggestion-candidate')).toHaveTextContent('finance');
    expect(input).toHaveAttribute('placeholder', ghost('riverbank'));
  });

  it('shows no suggestion when the cleared gloss was the surface form only approval', async () => {
    // 'logos' is approved exactly once; clearing it empties the pool match, so nothing is suggested,
    // consistent with the empty pool the committed deletion produces.
    renderChip(makeWordToken('tok-approved', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
    });

    const input = await focusGloss();
    await userEvent.clear(input);

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-candidate')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'gloss');
  });
});

describe('TokenChip suggestion keyboard navigation', () => {
  it('arrow-down highlights the top row and Enter approves it', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss();
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByTestId('suggestion-accept')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-new');
    expect(link?.analysisId).toBe('ta-river');
  });

  it('Enter with nothing highlighted approves the top suggestion', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onSave,
    });

    await focusGloss();
    // No arrow press: nothing is highlighted, so Enter falls back to the top row.
    await userEvent.keyboard('{Enter}');

    const saved: TextAnalysis = onSave.mock.calls[0][0];
    const link = saved.tokenAnalysisLinks.find((l) => l.token.tokenRef === 'tok-2');
    expect(link?.analysisId).toBe('ta-1');
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });

  it('arrow-down stops at the last row and arrow-up returns to the no-highlight state', async () => {
    const onSave = jest.fn();
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss();
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
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    await focusGloss();
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
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onGlossChange,
    });

    const input = await focusGloss();
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveFocus();
    expect(onGlossChange).not.toHaveBeenCalled();
  });

  it('Enter while the dropdown is closed commits the typed draft', async () => {
    const onGlossChange = jest.fn();
    renderChip(makeWordToken('tok-2', 'logos'), {
      initialAnalysis: poolWithOneApproved('word'),
      onGlossChange,
    });

    const input = await focusGloss();
    await userEvent.type(input, 'mine'); // typing closes the dropdown
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');

    expect(onGlossChange).toHaveBeenCalledWith('tok-2', 'mine');
    expect(input).toHaveValue('mine');
  });

  it('arrow-down re-opens the dropdown after typing closed it', async () => {
    renderChip(makeWordToken('tok-2', 'logos'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss();
    await userEvent.type(input, 'mine'); // typing closes the dropdown
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();
  });

  it('arrow-down does nothing when the token has no suggestions', async () => {
    renderChip(makeWordToken('tok-x', 'unseen'), { initialAnalysis: poolWithOneApproved('word') });

    const input = await focusGloss();
    await userEvent.keyboard('{ArrowDown}');

    // No combobox here, so there is no dropdown to open and no aria-expanded state.
    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-expanded');
  });
});

describe('TokenChip suggestion + button', () => {
  it('fades in on hover even when the input is not focused, and fades out again on unhover', async () => {
    // 'bank' has two suggestions, so the "+" button renders; at rest it is present but invisible and
    // non-interactive (its slot is reserved so the chip never reflows).
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

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
    renderChip(makeWordToken('tok-new', 'bank'), {
      initialAnalysis: homographBankPool('finance'),
      onSave,
    });

    const input = await focusGloss();
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
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    await focusGloss();
    expect(screen.getByTestId('suggestion-accept')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('suggestion-add'));

    expect(screen.queryByTestId('suggestion-accept')).not.toBeInTheDocument();
  });
});

describe('TokenChip suggestion combobox wiring', () => {
  it('points the input at the open panel as its listbox', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const input = await focusGloss();

    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('collapses the input to the closed combobox state when the panel closes', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const input = await focusGloss();
    await userEvent.type(input, 'mine');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
  });

  it('names no active descendant while no row is highlighted', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const input = await focusGloss();

    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('names the keyboard-highlighted row as the active descendant', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const input = await focusGloss();
    await userEvent.keyboard('{ArrowDown}');

    const [first] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
  });

  it('keeps focus in the gloss input while the panel is open', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });

    const input = await focusGloss();

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('keeps focus in the gloss input when the panel restores focus as it closes', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });
    const input = await focusGloss();

    // fireEvent so the sentinel itself never takes focus, leaving the panel's own focus-restoration
    // as the only thing that could move it — which, left unprevented, blurs the input.
    fireEvent.click(screen.getByTestId('popover-close'));

    expect(input).toHaveFocus();
  });
});

describe('TokenChip suggestion dropdown scrolling', () => {
  // The other half of scrolling — the panel hiding itself once the anchor is clipped away — is the
  // popover's own doing, off measurements jsdom does not produce, so it stays beyond reach here.
  it('keeps the panel open when the surrounding view scrolls', async () => {
    renderChip(makeWordToken('tok-new', 'bank'), { initialAnalysis: homographBankPool('finance') });
    const input = await focusGloss();

    fireEvent.scroll(window);

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});
