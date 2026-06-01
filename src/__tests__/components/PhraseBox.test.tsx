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
  function MockTokenChip({
    onFocus,
    token,
    isSplitFree,
  }: Readonly<{ onFocus?: () => void; token: Token; isSplitFree?: boolean }>) {
    const gloss = mockUseGloss(token.ref);
    const dispatch = mockUseGlossDispatch();
    return (
      <span data-testid={`token-${token.ref}`} data-split-free={isSplitFree ? 'true' : 'false'}>
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
  focusRef: string | undefined;
  isFocused: boolean;
  onFocusPhrase: (focusRef?: string) => void;
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
    focusRef: undefined,
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

  it('renders the box as a non-label div so clicks are not forwarded to the first labelable control', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox?.tagName).toBe('DIV');
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

  it('reddens only the chips whose refs are in splitFreeTokenRefs, leaving the box border neutral', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          tokens={[TEST_TOKEN, TEST_TOKEN_2]}
          splitFreeTokenRefs={new Set(['token-2'])}
        />
      </AnalysisStoreProvider>,
    );

    // Only one of the two tokens would become free, so the box border stays neutral and just the
    // affected chip is flagged.
    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).not.toHaveClass('tw:border-destructive');
    expect(screen.getByTestId('token-token-1')).toHaveAttribute('data-split-free', 'false');
    expect(screen.getByTestId('token-token-2')).toHaveAttribute('data-split-free', 'true');
  });

  it('reddens both chips (not the box) for a multi-token box where every token would become free', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          tokens={[TEST_TOKEN, TEST_TOKEN_2]}
          splitFreeTokenRefs={new Set(['token-1', 'token-2'])}
        />
      </AnalysisStoreProvider>,
    );

    // A 2-token phrase splits into two free tokens; each is shown on its own chip, never as a
    // whole-box border (that would draw a single border around both rather than per token).
    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).not.toHaveClass('tw:border-destructive');
    expect(screen.getByTestId('token-token-1')).toHaveAttribute('data-split-free', 'true');
    expect(screen.getByTestId('token-token-2')).toHaveAttribute('data-split-free', 'true');
  });

  it('reddens the whole box (not the chip) for a lone single-token fragment that would become free', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          tokens={[TEST_TOKEN]}
          splitFreeTokenRefs={new Set(['token-1'])}
        />
      </AnalysisStoreProvider>,
    );

    // A single-token fragment (e.g. one run of a discontiguous phrase) reddens at the box level;
    // per-chip flagging is suppressed so the border isn't drawn twice.
    const phraseBox = document.querySelector('[data-phrase-box="true"]');
    expect(phraseBox).toHaveClass('tw:border-destructive');
    expect(screen.getByTestId('token-token-1')).toHaveAttribute('data-split-free', 'false');
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

  it('calls onFocusPhrase with the focus ref when a gloss input receives focus', async () => {
    const handleFocus = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox {...requiredProps()} onFocusPhrase={handleFocus} focusRef="token-1" />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('textbox', { name: 'Gloss for Hello' }));

    expect(handleFocus).toHaveBeenCalledWith('token-1');
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

  it('splits a discontiguous phrase at the last intra-box boundary in document order even when the stored token list is scrambled', async () => {
    // Phrase displayed as [A,C,D,E] (A discontiguous, [C,D,E] a contiguous run) but STORED out of
    // document order — the bug that frees the wrong tokens. The split must use document order, so
    // clicking the last intra-box boundary (D|E) frees E and keeps [A,C,D].
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-x',
      status: 'approved',
      tokens: [
        { tokenRef: 'A', surfaceText: 'A' },
        { tokenRef: 'E', surfaceText: 'E' },
        { tokenRef: 'D', surfaceText: 'D' },
        { tokenRef: 'C', surfaceText: 'C' },
      ],
    };
    const docOrder = new Map([
      ['A', 0],
      ['C', 1],
      ['D', 2],
      ['E', 3],
    ]);
    const mk = (ref: string): Token & { type: 'word' } => ({
      ref,
      surfaceText: ref,
      writingSystem: 'en',
      type: 'word',
      charStart: 0,
      charEnd: 1,
    });
    mockUsePhraseLinkForToken.mockReturnValue(phraseLink);
    const updatePhraseSpy = jest.fn();
    const createPhraseSpy = jest.fn();
    const deletePhraseSpy = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: createPhraseSpy,
      updatePhrase: updatePhraseSpy,
      deletePhrase: deletePhraseSpy,
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          isHighlighted
          phraseLink={phraseLink}
          tokenDocOrder={docOrder}
          tokens={[mk('C'), mk('D'), mk('E')]}
        />
      </AnalysisStoreProvider>,
    );

    const unlinkBtns = screen.getAllByTestId('token-unlink-btn');
    // Click the LAST intra-box button (boundary between D and E in document order).
    await userEvent.click(unlinkBtns[unlinkBtns.length - 1]);

    // Expect: phrase shrinks to [A,C,D] (document order), E freed — not the scrambled stored order.
    expect(updatePhraseSpy).toHaveBeenCalledWith('phrase-x', [
      { tokenRef: 'A', surfaceText: 'A' },
      { tokenRef: 'C', surfaceText: 'C' },
      { tokenRef: 'D', surfaceText: 'D' },
    ]);
    expect(createPhraseSpy).not.toHaveBeenCalled();
  });

  it('hovering an intra-phrase unlink button reports the would-be-free tokens to onHoverSplitFreeTokens', async () => {
    // Splitting a two-token phrase leaves both halves length-1, so both tokens would become free.
    // The intra-phrase icon must forward that preview up so the parent can redden the chips.
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-x',
      status: 'approved',
      tokens: [
        { tokenRef: 'A', surfaceText: 'A' },
        { tokenRef: 'B', surfaceText: 'B' },
      ],
    };
    const docOrder = new Map([
      ['A', 0],
      ['B', 1],
    ]);
    const mk = (ref: string): Token & { type: 'word' } => ({
      ref,
      surfaceText: ref,
      writingSystem: 'en',
      type: 'word',
      charStart: 0,
      charEnd: 1,
    });
    mockUsePhraseLinkForToken.mockReturnValue(phraseLink);
    const onHoverSplitFreeTokens = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          isHighlighted
          phraseLink={phraseLink}
          tokenDocOrder={docOrder}
          tokens={[mk('A'), mk('B')]}
          onHoverSplitFreeTokens={onHoverSplitFreeTokens}
        />
      </AnalysisStoreProvider>,
    );

    const unlinkBtn = screen.getByTestId('token-unlink-btn');
    await userEvent.hover(unlinkBtn);
    expect(onHoverSplitFreeTokens).toHaveBeenCalledWith(['A', 'B']);

    await userEvent.unhover(unlinkBtn);
    expect(onHoverSplitFreeTokens).toHaveBeenLastCalledWith(undefined);
  });

  it('clicking an inline unlink button does not pop out any other token (no label click-forwarding)', async () => {
    // The phrase box used to be a <label>, which forwards a click on any descendant to the box's
    // first labelable control — the first token's remove-✕ — firing a phantom pop-out. With a plain
    // <div>, clicking the unlink button between B and C must split there and never call deletePhrase
    // (no token popped out) nor produce an updatePhrase that drops an unrelated token.
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-x',
      status: 'approved',
      tokens: [
        { tokenRef: 'A', surfaceText: 'A' },
        { tokenRef: 'B', surfaceText: 'B' },
        { tokenRef: 'C', surfaceText: 'C' },
        { tokenRef: 'D', surfaceText: 'D' },
      ],
    };
    const docOrder = new Map([
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['D', 3],
    ]);
    const mk = (ref: string): Token & { type: 'word' } => ({
      ref,
      surfaceText: ref,
      writingSystem: 'en',
      type: 'word',
      charStart: 0,
      charEnd: 1,
    });
    mockUsePhraseLinkForToken.mockReturnValue(phraseLink);
    const updatePhraseSpy = jest.fn();
    const deletePhraseSpy = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: updatePhraseSpy,
      deletePhrase: deletePhraseSpy,
    });
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <PhraseBox
          {...requiredProps()}
          isHighlighted
          phraseLink={phraseLink}
          tokenDocOrder={docOrder}
          tokens={[mk('A'), mk('B'), mk('C'), mk('D')]}
        />
      </AnalysisStoreProvider>,
    );

    // Click the B|C unlink button (second intra-box boundary). Both halves are length 2, so the
    // split shrinks the phrase to [A,B] and creates [C,D]; crucially nothing is popped out.
    const unlinkBtns = screen.getAllByTestId('token-unlink-btn');
    await userEvent.click(unlinkBtns[1]);

    expect(deletePhraseSpy).not.toHaveBeenCalled();
    expect(updatePhraseSpy).toHaveBeenCalledTimes(1);
    expect(updatePhraseSpy).toHaveBeenCalledWith('phrase-x', [
      { tokenRef: 'A', surfaceText: 'A' },
      { tokenRef: 'B', surfaceText: 'B' },
    ]);
  });

  it('inserts an added token in document order when tokenDocOrder places it before existing tokens', async () => {
    // token-1 (the rendered free token) sits before token-2 in the document, so adding it to a
    // phrase that already contains token-2 must produce [token-1, token-2], not [token-2, token-1].
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
          tokenDocOrder={
            new Map([
              ['token-1', 0],
              ['token-2', 1],
            ])
          }
        />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(document.querySelector('[role="button"]') ?? document.body);

    expect(updatePhraseSpy).toHaveBeenCalledWith('phrase-2', [
      { tokenRef: 'token-1', surfaceText: 'Hello' },
      { tokenRef: 'token-2', surfaceText: 'World' },
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
});
