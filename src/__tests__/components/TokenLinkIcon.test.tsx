/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactElement } from 'react';
import { TokenLinkIcon } from '../../components/TokenLinkIcon';
import {
  PhraseStripProvider,
  type PhraseStripContextValue,
} from '../../components/PhraseStripContext';
import type { SlotFocusInfo } from '../../types/token-layout';
import { makePhraseLink, makePhraseStripContext, makeWordToken } from '../test-helpers';

const mockCreatePhrase = jest.fn();
const mockUpdatePhrase = jest.fn();
const mockDeletePhrase = jest.fn();
const mockMergePhrases = jest.fn();

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseDispatch: () => ({
    createPhrase: mockCreatePhrase,
    updatePhrase: mockUpdatePhrase,
    deletePhrase: mockDeletePhrase,
    mergePhrases: mockMergePhrases,
  }),
}));

/**
 * Builds a `slotFocus` bundle. Defaults to "no focus, same segment"; `focusedSideIsPrev` /
 * `focusedPhraseLink` / `focusedFreeToken` layer on from there.
 */
function slotFocus(overrides: Partial<SlotFocusInfo> = {}): SlotFocusInfo {
  return {
    focusedSideIsPrev: undefined,
    isSameSegmentAsFocus: true,
    focusedPhraseLink: undefined,
    focusedFreeToken: undefined,
    ...overrides,
  };
}

/** Default no-op required props for `TokenLinkIcon`. */
function requiredProps(): ComponentProps<typeof TokenLinkIcon> {
  return {
    prevToken: makeWordToken('tok-a'),
    nextToken: makeWordToken('tok-b'),
    prevPhraseLink: undefined,
    nextPhraseLink: undefined,
    slotFocus: slotFocus(),
    isPhraseRevealed: false,
  };
}

/** Renders a `TokenLinkIcon` inside a strip provider carrying the given context overrides. */
function renderIcon(ui: ReactElement, context: Partial<PhraseStripContextValue> = {}) {
  return render(
    <PhraseStripProvider value={makePhraseStripContext(context)}>{ui}</PhraseStripProvider>,
  );
}

describe('TokenLinkIcon', () => {
  beforeEach(() => {
    mockCreatePhrase.mockClear();
    mockUpdatePhrase.mockClear();
    mockDeletePhrase.mockClear();
    mockMergePhrases.mockClear();
  });

  it('returns undefined when both prevToken and nextToken are undefined', () => {
    const { container } = renderIcon(
      <TokenLinkIcon {...requiredProps()} prevToken={undefined} nextToken={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns undefined when prevToken is undefined', () => {
    const { container } = renderIcon(<TokenLinkIcon {...requiredProps()} prevToken={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns undefined when nextToken is undefined', () => {
    const { container } = renderIcon(<TokenLinkIcon {...requiredProps()} nextToken={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an unlink button when both sides are in the same phrase', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
    );
    expect(screen.getByTestId('token-unlink-btn')).toBeInTheDocument();
  });

  it('clicking unlink calls splitPhraseAtBoundary (deletePhrase for 2-token phrase)', async () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-unlink-btn'));
    expect(mockDeletePhrase).toHaveBeenCalledWith('p1');
  });

  it('clears onHoverPhrase when unlink button is clicked', async () => {
    const onHoverPhrase = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      {
        onHoverPhrase,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-unlink-btn'));
    expect(onHoverPhrase).toHaveBeenCalledWith(undefined);
  });

  it('is disabled in confirm-unlink mode', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      { phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' } },
    );
    expect(screen.getByTestId('token-unlink-btn')).toBeDisabled();
  });

  it('is disabled in edit mode for a different phrase', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      { phraseMode: { kind: 'edit', phraseId: 'other-phrase', originalTokens: [] } },
    );
    expect(screen.getByTestId('token-unlink-btn')).toBeDisabled();
  });

  it('calls onHoverPhrase with phraseId on mouse enter but not on leave', async () => {
    const onHoverPhrase = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      {
        onHoverPhrase,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    const btn = screen.getByTestId('token-unlink-btn');
    await userEvent.hover(btn);
    expect(onHoverPhrase).toHaveBeenCalledWith('p1');

    await userEvent.unhover(btn);
    // Phrase hover is cleared when the pointer leaves the phrase-group wrapper, not by the button.
    expect(onHoverPhrase).not.toHaveBeenCalledWith(undefined);
  });

  it('calls onHoverSplitFreeTokens with free refs on enter and undefined on leave', async () => {
    const onHoverSplitFreeTokens = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      {
        onHoverSplitFreeTokens,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    const btn = screen.getByTestId('token-unlink-btn');
    await userEvent.hover(btn);
    expect(onHoverSplitFreeTokens).toHaveBeenCalledWith(['tok-a', 'tok-b']);

    await userEvent.unhover(btn);
    expect(onHoverSplitFreeTokens).toHaveBeenCalledWith(undefined);
  });

  it('renders a link button when sides are in different phrases', () => {
    renderIcon(<TokenLinkIcon {...requiredProps()} />);
    expect(screen.getByTestId('token-link-btn')).toBeInTheDocument();
  });

  it('link button is disabled when not in view mode', () => {
    renderIcon(<TokenLinkIcon {...requiredProps()} />, {
      phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' },
    });
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('link button is disabled when focus is not set', () => {
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: undefined })}
      />,
    );
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('link button is disabled when not same segment as focus', () => {
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({
          focusedSideIsPrev: true,
          isSameSegmentAsFocus: false,
          focusedFreeToken: makeWordToken('tok-a'),
        })}
      />,
    );
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('creates a phrase when clicking link with two free tokens', async () => {
    const focusedFreeToken = makeWordToken('tok-a');
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedFreeToken })}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockCreatePhrase).toHaveBeenCalledWith([
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('merges neighbor free token into focused phrase when focus is a phrase', async () => {
    const focusedPhrase = makePhraseLink('p1', ['tok-a']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedPhraseLink: focusedPhrase })}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockMergePhrases).toHaveBeenCalledWith(
      'p1',
      [
        { tokenRef: 'tok-a', surfaceText: 'tok-a' },
        { tokenRef: 'tok-b', surfaceText: 'tok-b' },
      ],
      undefined,
    );
  });

  it('merges neighbor phrase into focused phrase and deletes neighbor', async () => {
    const focusedPhrase = makePhraseLink('p1', ['tok-a']);
    const neighborPhrase = makePhraseLink('p2', ['tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedPhraseLink: focusedPhrase })}
        nextPhraseLink={neighborPhrase}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockMergePhrases).toHaveBeenCalledWith(
      'p1',
      [
        { tokenRef: 'tok-a', surfaceText: 'tok-a' },
        { tokenRef: 'tok-b', surfaceText: 'tok-b' },
      ],
      'p2',
    );
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
    expect(mockDeletePhrase).not.toHaveBeenCalled();
  });

  it('absorbs free token into neighbor phrase when focus is free and neighbor is a phrase', async () => {
    const neighborPhrase = makePhraseLink('p2', ['tok-b']);
    const focusedFreeToken = makeWordToken('tok-a');
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedFreeToken })}
        nextPhraseLink={neighborPhrase}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p2', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('absorbs bridging free token when neighbor is a different fragment of the focused phrase', async () => {
    // prevToken=tok-b is a free token bridging two fragments of phrase p1 (tok-a, tok-c). When the
    // neighbor and focused phrase are the same phrase, the bridging token is absorbed into it.
    const focusedPhrase = makePhraseLink('p1', ['tok-a', 'tok-c']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={makeWordToken('tok-b')}
        nextToken={makeWordToken('tok-c')}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedPhraseLink: focusedPhrase })}
        nextPhraseLink={focusedPhrase}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
          ['tok-c', 2],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockUpdatePhrase).toHaveBeenCalledWith(
      'p1',
      expect.arrayContaining([{ tokenRef: 'tok-b', surfaceText: 'tok-b' }]),
    );
  });

  it('does nothing when clicking link with no focused free token and no phrase', async () => {
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({
          focusedSideIsPrev: true,
          focusedFreeToken: undefined,
          focusedPhraseLink: undefined,
        })}
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
  });

  it('calls onHoverCandidateTokens with token refs on enter and undefined on leave', async () => {
    const onHoverCandidateTokens = jest.fn();
    const focusedFreeToken = makeWordToken('tok-a');
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedFreeToken })}
      />,
      {
        onHoverCandidateTokens,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    const btn = screen.getByTestId('token-link-btn');
    await userEvent.hover(btn);
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['tok-a', 'tok-b']);

    await userEvent.unhover(btn);
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(undefined);
  });

  it('uses the false branch of focusedSideIsPrev ternaries when focus is end-ward', async () => {
    const focusedPhrase = makePhraseLink('p1', ['tok-b']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={makeWordToken('tok-a')}
        nextToken={makeWordToken('tok-b')}
        slotFocus={slotFocus({ focusedSideIsPrev: false, focusedPhraseLink: focusedPhrase })}
      />,
      {
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
        ]),
      },
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    // Neighbor is prevToken (tok-a, free), absorbed into focused phrase p1 (tok-b). No neighbor
    // phrase to delete, so absorbedPhraseId is undefined.
    expect(mockMergePhrases).toHaveBeenCalledWith(
      'p1',
      [
        { tokenRef: 'tok-a', surfaceText: 'tok-a' },
        { tokenRef: 'tok-b', surfaceText: 'tok-b' },
      ],
      undefined,
    );
  });

  it('highlights all tokens in a multi-token neighbor phrase when focus is free and neighbor is phrase', async () => {
    const neighborPhrase = makePhraseLink('p2', ['tok-b', 'tok-c']);
    const focusedFreeToken = makeWordToken('tok-a');
    const onHoverCandidateTokens = jest.fn();
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        slotFocus={slotFocus({ focusedSideIsPrev: true, focusedFreeToken })}
        nextPhraseLink={neighborPhrase}
      />,
      {
        onHoverCandidateTokens,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
          ['tok-c', 2],
        ]),
      },
    );
    await userEvent.hover(screen.getByTestId('token-link-btn'));
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['tok-a', 'tok-b', 'tok-c']);
  });

  it('does not call onHoverSplitFreeTokens when splitFreeRefs is empty (both halves ≥ 2 tokens)', async () => {
    // Splitting a 4-token phrase after tok-b yields two 2-token halves, so neither half is freed.
    const onHoverSplitFreeTokens = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    renderIcon(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={makeWordToken('tok-b')}
        nextToken={makeWordToken('tok-c')}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
      />,
      {
        onHoverSplitFreeTokens,
        tokenDocOrder: new Map([
          ['tok-a', 0],
          ['tok-b', 1],
          ['tok-c', 2],
          ['tok-d', 3],
        ]),
      },
    );
    await userEvent.hover(screen.getByTestId('token-unlink-btn'));
    expect(onHoverSplitFreeTokens).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cross-segment slot — a phrase may not span a segment boundary, so the link is inert
  // ---------------------------------------------------------------------------

  describe('cross-segment slot', () => {
    /**
     * Renders a `TokenLinkIcon` for a slot straddling a segment boundary (neighbors in different
     * segments, so `isSameSegmentAsFocus` is false).
     */
    function renderCrossSegment(focusedSideIsPrev: boolean) {
      return render(
        <PhraseStripProvider value={makePhraseStripContext({ crossSegmentLinkTooltip: 'nope' })}>
          <TokenLinkIcon
            {...requiredProps()}
            slotFocus={slotFocus({
              focusedSideIsPrev,
              isSameSegmentAsFocus: false,
              focusedFreeToken: makeWordToken(focusedSideIsPrev ? 'tok-a' : 'tok-b'),
            })}
          />
        </PhraseStripProvider>,
      );
    }

    it('disables the link with the cross-segment tooltip when focus is the previous segment', () => {
      renderCrossSegment(true);
      const button = screen.getByTestId('token-link-btn');
      expect(button).toBeDisabled();
      // A disabled button can't be the hover trigger, so the tooltip rides the wrapper span (the
      // mock projects TooltipContent's text onto it); the button itself carries no native title.
      expect(button).not.toHaveAttribute('title');
      expect(button.parentElement).toHaveAttribute('title', 'nope');
    });

    it('disables the link with the cross-segment tooltip when focus is the next segment', () => {
      renderCrossSegment(false);
      const button = screen.getByTestId('token-link-btn');
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('title');
      expect(button.parentElement).toHaveAttribute('title', 'nope');
    });

    it('creates no phrase when the disabled cross-segment link is clicked', async () => {
      renderCrossSegment(true);
      await userEvent.click(screen.getByTestId('token-link-btn'));
      expect(mockCreatePhrase).not.toHaveBeenCalled();
      expect(mockMergePhrases).not.toHaveBeenCalled();
    });
  });
});
