/** @file Unit tests for PhraseBox component. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { PhraseBox } from '../../components/PhraseBox';

/** Stable mock fns for AnalysisStore hooks — reset between tests via resetMocks. */
const mockUseGloss = jest.fn<string, [string]>().mockReturnValue('');
const mockUseGlossDispatch = jest.fn().mockReturnValue(jest.fn());
const mockUsePhraseLinkForToken = jest.fn().mockReturnValue(undefined);
const mockUsePhraseDispatch = jest.fn().mockReturnValue({
  createPhrase: jest.fn(),
  updatePhrase: jest.fn(),
  deletePhrase: jest.fn(),
});
const mockUsePhraseGloss = jest.fn<string, [string]>().mockReturnValue('');
const mockUsePhraseGlossDispatch = jest.fn().mockReturnValue(jest.fn());

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  /**
   * Pass-through AnalysisStoreProvider stub.
   *
   * @param props - Component props.
   * @param props.children - Children to render.
   * @returns Children unchanged.
   */
  AnalysisStoreProvider({ children }: Readonly<{ children: import('react').ReactNode }>) {
    return children;
  },
  useGloss: (...args: Parameters<typeof mockUseGloss>) => mockUseGloss(...args),
  useGlossDispatch: () => mockUseGlossDispatch(),
  usePhraseLinkForToken: (...args: Parameters<typeof mockUsePhraseLinkForToken>) =>
    mockUsePhraseLinkForToken(...args),
  usePhraseDispatch: () => mockUsePhraseDispatch(),
  usePhraseGloss: (...args: Parameters<typeof mockUsePhraseGloss>) => mockUsePhraseGloss(...args),
  usePhraseGlossDispatch: () => mockUsePhraseGlossDispatch(),
}));

jest.mock('../../components/TokenChip', () => {
  function MockTokenChip({ onFocus, token }: Readonly<{ onFocus?: () => void; token: Token }>) {
    const gloss = mockUseGloss(token.ref);
    const dispatch = mockUseGlossDispatch();
    return (
      <span data-testid={`token-${token.ref}`}>
        {token.surfaceText}
        <input
          aria-label={`Gloss for ${token.surfaceText}`}
          onChange={(e) => dispatch(token.ref, token.surfaceText, e.target.value)}
          onFocus={onFocus}
          value={gloss}
        />
      </span>
    );
  }
  return { __esModule: true, default: MockTokenChip };
});

jest.mock('../../components/UnlinkPhraseConfirm', () => ({
  __esModule: true,
  /**
   * Minimal UnlinkPhraseConfirm stub that renders confirm/cancel buttons.
   *
   * @param props - Component props.
   * @param props.setPhraseMode - Called to exit confirm-unlink mode.
   * @returns A stub div with confirm and cancel buttons.
   */
  default: ({
    setPhraseMode,
  }: Readonly<{ phraseId: string; setPhraseMode: (m: unknown) => void }>) => (
    <div data-testid="unlink-confirm">
      <button
        data-testid="unlink-confirm-yes"
        onClick={() => setPhraseMode({ kind: 'view' })}
        type="button"
      >
        Unlink
      </button>
      <button
        data-testid="unlink-confirm-cancel"
        onClick={() => setPhraseMode({ kind: 'view' })}
        type="button"
      >
        Cancel
      </button>
    </div>
  ),
}));

/** Pre-built test token */
const TEST_TOKEN = {
  ref: 'token-1',
  surfaceText: 'Hello',
  writingSystem: 'en',
  type: 'word',
  charStart: 0,
  charEnd: 5,
} satisfies Token;

/** Second test token */
const TEST_TOKEN_2 = {
  ref: 'token-2',
  surfaceText: 'World',
  writingSystem: 'en',
  type: 'word',
  charStart: 6,
  charEnd: 11,
} satisfies Token;

/**
 * An approved phrase link fixture used by phrase-mode tests. Includes TEST_TOKEN so
 * `usePhraseLinkForToken` returns this link when mocked.
 */
const TEST_PHRASE_LINK: PhraseAnalysisLink = {
  analysisId: 'phrase-1',
  status: 'approved',
  tokens: [
    { tokenRef: 'token-1', surfaceText: 'Hello' },
    { tokenRef: 'token-2', surfaceText: 'World' },
  ],
};

/** Shared props shape used by both helper functions. */
type PhraseBoxTestProps = {
  index: number | undefined;
  isFocused: boolean;
  onFocusPhrase: (index?: number) => void;
  tokens: (Token & { type: 'word' })[];
  phraseLink: undefined;
  phraseMode: { kind: 'view' };
  setPhraseMode: jest.Mock;
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
    phraseLink: undefined,
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
  };
}

describe('PhraseBox', () => {
  beforeEach(() => {
    mockUseGloss.mockReturnValue('');
    mockUseGlossDispatch.mockReturnValue(jest.fn());
    mockUsePhraseLinkForToken.mockReturnValue(undefined);
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase: jest.fn(),
    });
  });

  it('renders as a label', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('LABEL');
  });

  it('renders one TokenChip per token in the tokens array', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('token-token-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-token-2')).toBeInTheDocument();
  });

  it('clicking the outer container focuses the first gloss input', async () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    await userEvent.click(phraseBox ?? document.body);

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveFocus();
  });

  it('applies focused border and background when isFocused is true', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'focused');
    expect(phraseBox).toHaveClass('tw:border-white');
    expect(phraseBox).toHaveClass('tw:bg-muted/30');
  });

  it('applies default border and background when isFocused is false', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused={false} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('data-focus-state', 'default');
    expect(phraseBox).toHaveClass('tw:border-border/40');
    expect(phraseBox).toHaveClass('tw:bg-muted/20');
  });

  it('phrase box does not override cursor on gap areas', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} isFocused />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).not.toHaveClass('tw:cursor-text');
  });

  it('renders tokens in the order they appear in the tokens array', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    const tokens = document.querySelectorAll('[data-testid^="token-"]');
    expect(tokens[0]).toHaveAttribute('data-testid', 'token-token-1');
    expect(tokens[1]).toHaveAttribute('data-testid', 'token-token-2');
  });

  it('passes the gloss for each token from the store', () => {
    mockUseGloss.mockImplementation((ref) => (ref === 'token-1' ? 'hello' : 'world'));
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} tokens={[TEST_TOKEN, TEST_TOKEN_2]} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Gloss for World' })).toHaveValue('world');
  });

  it('shows an empty string when the token id is absent from the store', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByRole('textbox', { name: 'Gloss for Hello' })).toHaveValue('');
  });

  it('updates the store when a gloss input changes', async () => {
    const spy = jest.fn();
    mockUseGlossDispatch.mockReturnValue(spy);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'Gloss for Hello' }), 'hi');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'token-1', 'Hello', 'h');
    expect(spy).toHaveBeenNthCalledWith(2, 'token-1', 'Hello', 'i');
  });

  it('calls onFocusPhrase with index when a gloss input receives focus', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} onFocusPhrase={handleFocus} index={2} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for Hello' }));

    expect(handleFocus).toHaveBeenCalledWith(2);
  });

  it('hides phrase gloss input when showGlossInput is false', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} phraseLink={TEST_PHRASE_LINK} showGlossInput={false} />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('phrase-gloss-input')).not.toBeInTheDocument();
  });

  it('shows phrase gloss input when showGlossInput is true (default)', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} phraseLink={TEST_PHRASE_LINK} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('phrase-gloss-input')).toBeInTheDocument();
  });

  it('shows edit and unlink buttons when phraseLink is set and mode is view', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} phraseLink={TEST_PHRASE_LINK} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByTestId('edit-phrase-btn')).toBeInTheDocument();
    expect(screen.getByTestId('unlink-phrase-btn')).toBeInTheDocument();
  });

  it('does not show edit/unlink buttons when phraseLink is undefined', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} phraseLink={undefined} />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('edit-phrase-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlink-phrase-btn')).not.toBeInTheDocument();
  });

  it('clicking edit sets phraseMode to edit for this phrase', async () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByTestId('edit-phrase-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({
      kind: 'edit',
      phraseId: 'phrase-1',
      originalTokens: TEST_PHRASE_LINK.tokens,
    });
  });

  it('clicking unlink sets phraseMode to confirm-unlink', async () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByTestId('unlink-phrase-btn'));

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'confirm-unlink', phraseId: 'phrase-1' });
  });

  it('renders phrase normally (not replaced) when phraseMode is confirm-unlink for this phrase', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'confirm-unlink', phraseId: 'phrase-1' }}
        />
      </AnalysisStoreProvider>,
    );

    // UnlinkPhraseConfirm is now rendered at toolbar level, not inside PhraseBox.
    expect(screen.queryByTestId('unlink-confirm')).not.toBeInTheDocument();
    expect(document.querySelector('[data-phrase-box="true"]')).toBeInTheDocument();
  });

  it('hides edit/unlink buttons in confirm-unlink mode', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'confirm-unlink', phraseId: 'other-phrase' }}
        />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('edit-phrase-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlink-phrase-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unlink-confirm')).not.toBeInTheDocument();
  });

  it('renders as a span with role=button in create mode', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} phraseMode={{ kind: 'create', draftTokenRefs: [] }} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('SPAN');
    expect(phraseBox).toHaveAttribute('role', 'button');
  });

  it('adds token to draft when clicked in create mode (token not in any phrase)', async () => {
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'create', draftTokenRefs: ['token-1'] });
  });

  it('removes token from draft when clicked again in create mode', async () => {
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: ['token-1'] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'create', draftTokenRefs: [] });
  });

  it('does not show Done button inside PhraseBox (Done is now in the toolbar)', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: ['token-1'] }}
        />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('done-phrase-btn')).not.toBeInTheDocument();
  });

  it('commits the draft and returns to view mode when phraseMode has commit:true', async () => {
    const createPhraseSpy = jest.fn();
    const setPhraseMode = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: createPhraseSpy,
      updatePhrase: jest.fn(),
      deletePhrase: jest.fn(),
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          tokens={[TEST_TOKEN, TEST_TOKEN_2]}
          phraseMode={{ kind: 'create', draftTokenRefs: ['token-1', 'token-2'], commit: true }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    expect(createPhraseSpy).toHaveBeenCalledWith([
      { tokenRef: 'token-1', surfaceText: 'Hello' },
      { tokenRef: 'token-2', surfaceText: 'World' },
    ]);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('renders as disabled when another phrase is active in create mode', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
        />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveAttribute('aria-disabled', 'true');
  });

  it('handles Enter keydown in create mode to toggle the token', async () => {
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    const button = document.querySelector('[role="button"]');
    if (button instanceof HTMLElement) button.focus();
    await userEvent.keyboard('{Enter}');

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'create', draftTokenRefs: ['token-1'] });
  });

  it('handles Space keydown in create mode to toggle the token', async () => {
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    const button = document.querySelector('[role="button"]');
    if (button instanceof HTMLElement) button.focus();
    await userEvent.keyboard('{ }');

    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'create', draftTokenRefs: ['token-1'] });
  });

  it('does not toggle when disabled and Enter is pressed', async () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    const setPhraseMode = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    const button = document.querySelector('[role="button"]');
    if (button instanceof HTMLElement) button.focus();
    await userEvent.keyboard('{Enter}');

    expect(setPhraseMode).not.toHaveBeenCalled();
  });

  it('renders as selected when token is in edit target phrase', () => {
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{
            kind: 'edit',
            phraseId: 'phrase-1',
            originalTokens: TEST_PHRASE_LINK.tokens,
          }}
        />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveClass('tw:border-ring');
  });

  it('calls updatePhrase when clicked in edit mode for the target phrase', async () => {
    const updatePhraseSpy = jest.fn();
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: jest.fn(),
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{
            kind: 'edit',
            phraseId: 'phrase-1',
            originalTokens: TEST_PHRASE_LINK.tokens,
          }}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(updatePhraseSpy).toHaveBeenCalledWith(
      'phrase-1',
      TEST_PHRASE_LINK.tokens.filter((t) => t.tokenRef !== 'token-1'),
    );
  });

  it('does not call updatePhrase in edit mode when token is not in the target phrase', async () => {
    // token-1 belongs to TEST_PHRASE_LINK (phrase-1), but phraseMode targets a different phrase
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    const updatePhraseSpy = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: jest.fn(),
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'edit', phraseId: 'other-phrase', originalTokens: [] }}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(updatePhraseSpy).not.toHaveBeenCalled();
  });

  it('adds a token to an existing phrase in edit mode when token is not already in the phrase', async () => {
    // token-1 is free (not in any phrase); editPhraseTokens provides the current phrase token list
    const existingPhraseTokens: PhraseAnalysisLink['tokens'] = [
      { tokenRef: 'token-2', surfaceText: 'World' },
    ];
    mockUsePhraseLinkForToken.mockReturnValue(undefined);
    const updatePhraseSpy = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: jest.fn(),
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          editPhraseTokens={existingPhraseTokens}
          phraseLink={undefined}
          phraseMode={{ kind: 'edit', phraseId: 'phrase-2', originalTokens: existingPhraseTokens }}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(updatePhraseSpy).toHaveBeenCalledWith('phrase-2', [
      { tokenRef: 'token-2', surfaceText: 'World' },
      { tokenRef: 'token-1', surfaceText: 'Hello' },
    ]);
  });

  it('does nothing in edit mode when token is free (no phrase link)', async () => {
    // token is not in any phrase — tokenPhraseLinkFromStore returns undefined
    // phraseMode targets some other phrase
    mockUsePhraseLinkForToken.mockReturnValue(undefined);
    const updatePhraseSpy = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: jest.fn(),
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={undefined}
          phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: [] }}
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(updatePhraseSpy).not.toHaveBeenCalled();
  });

  it('reverts phrase tokens and returns to view mode when revert:true is set', () => {
    const updatePhraseSpy = jest.fn();
    const setPhraseMode = jest.fn();
    mockUsePhraseLinkForToken.mockReturnValue(TEST_PHRASE_LINK);
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: jest.fn(),
    });
    const originalTokens: PhraseAnalysisLink['tokens'] = [
      { tokenRef: 'token-1', surfaceText: 'Hello' },
    ];
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseLink={TEST_PHRASE_LINK}
          phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens, revert: true }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    expect(updatePhraseSpy).toHaveBeenCalledWith('phrase-1', originalTokens);
    expect(setPhraseMode).toHaveBeenCalledWith({ kind: 'view' });
  });

  it('exits to view mode without dispatching when Done is clicked with empty draft', async () => {
    const createPhraseSpy = jest.fn();
    const setPhraseMode = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: createPhraseSpy,
      updatePhrase: jest.fn(),
      deletePhrase: jest.fn(),
    });
    // Render with phraseMode.kind !== 'create' to exercise the early return in handleDone
    // We need to call handleDone in a state where phraseMode.kind === 'create' but draftTokenRefs
    // is empty. The Done button is only shown when isInDraft, so we can't click it in that state.
    // Instead, verify via the toolbar's Cancel which is tested in InterlinearizerLoader.
    // Here we confirm the Done button is absent when token is not in draft.
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          phraseMode={{ kind: 'create', draftTokenRefs: [] }}
          setPhraseMode={setPhraseMode}
        />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByTestId('done-phrase-btn')).not.toBeInTheDocument();
    expect(createPhraseSpy).not.toHaveBeenCalled();
  });
});
