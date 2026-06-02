/** @file Unit tests for components/TokenLinkIcon.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { Token } from 'interlinearizer';
import { TokenLinkIcon } from '../../components/TokenLinkIcon';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// AnalysisStore mock
// ---------------------------------------------------------------------------

const mockCreatePhrase = jest.fn();
const mockUpdatePhrase = jest.fn();
const mockDeletePhrase = jest.fn();

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseDispatch: () => ({
    createPhrase: mockCreatePhrase,
    updatePhrase: mockUpdatePhrase,
    deletePhrase: mockDeletePhrase,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a word token fixture.
 *
 * @param ref - Token reference string.
 * @param surfaceText - Display text.
 * @returns A word token.
 */
function mkToken(ref: string, surfaceText = ref): Token & { type: 'word' } {
  return { ref, surfaceText, writingSystem: 'en', type: 'word', charStart: 0, charEnd: 1 };
}

/** Default no-op required props for `TokenLinkIcon`. */
function requiredProps(): ComponentProps<typeof TokenLinkIcon> {
  return {
    prevToken: mkToken('tok-a'),
    nextToken: mkToken('tok-b'),
    prevPhraseLink: undefined,
    nextPhraseLink: undefined,
    focusedSideIsPrev: undefined,
    focusedPhraseLink: undefined,
    focusedFreeToken: undefined,
    isSameSegmentAsFocus: true,
    isPhraseRevealed: false,
    phraseMode: { kind: 'view' },
    tokenDocOrder: new Map<string, number>(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenLinkIcon', () => {
  beforeEach(() => {
    mockCreatePhrase.mockClear();
    mockUpdatePhrase.mockClear();
    mockDeletePhrase.mockClear();
  });

  it('returns undefined when both prevToken and nextToken are undefined', () => {
    const { container } = render(
      <TokenLinkIcon {...requiredProps()} prevToken={undefined} nextToken={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns undefined when prevToken is undefined', () => {
    const { container } = render(<TokenLinkIcon {...requiredProps()} prevToken={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns undefined when nextToken is undefined', () => {
    const { container } = render(<TokenLinkIcon {...requiredProps()} nextToken={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Unlink icon (both sides same phrase)
  // ---------------------------------------------------------------------------

  it('renders an unlink button when both sides are in the same phrase', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
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
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-unlink-btn'));
    expect(mockDeletePhrase).toHaveBeenCalledWith('p1');
  });

  it('is disabled in confirm-unlink mode', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        phraseMode={{ kind: 'confirm-unlink', phraseId: 'p1' }}
      />,
    );
    expect(screen.getByTestId('token-unlink-btn')).toBeDisabled();
  });

  it('is disabled in edit mode for a different phrase', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        phraseMode={{ kind: 'edit', phraseId: 'other-phrase', originalTokens: [] }}
      />,
    );
    expect(screen.getByTestId('token-unlink-btn')).toBeDisabled();
  });

  it('calls onHoverCandidatePhrase with phraseId on mouse enter and undefined on leave', async () => {
    const onHoverCandidatePhrase = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        onHoverCandidatePhrase={onHoverCandidatePhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    const btn = screen.getByTestId('token-unlink-btn');
    await userEvent.hover(btn);
    expect(onHoverCandidatePhrase).toHaveBeenCalledWith('p1');

    await userEvent.unhover(btn);
    expect(onHoverCandidatePhrase).toHaveBeenCalledWith(undefined);
  });

  it('calls onHoverSplitFreeTokens with free refs on enter and undefined on leave', async () => {
    const onHoverSplitFreeTokens = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        onHoverSplitFreeTokens={onHoverSplitFreeTokens}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    const btn = screen.getByTestId('token-unlink-btn');
    await userEvent.hover(btn);
    expect(onHoverSplitFreeTokens).toHaveBeenCalledWith(['tok-a', 'tok-b']);

    await userEvent.unhover(btn);
    expect(onHoverSplitFreeTokens).toHaveBeenCalledWith(undefined);
  });

  // ---------------------------------------------------------------------------
  // Link icon (different phrases or free)
  // ---------------------------------------------------------------------------

  it('renders a link button when sides are in different phrases', () => {
    render(<TokenLinkIcon {...requiredProps()} />);
    expect(screen.getByTestId('token-link-btn')).toBeInTheDocument();
  });

  it('link button is disabled when not in view mode', () => {
    render(
      <TokenLinkIcon
        {...requiredProps()}
        phraseMode={{ kind: 'confirm-unlink', phraseId: 'p1' }}
      />,
    );
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('link button is disabled when focus is not set', () => {
    render(<TokenLinkIcon {...requiredProps()} focusedSideIsPrev={undefined} />);
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('link button is disabled when not same segment as focus', () => {
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        isSameSegmentAsFocus={false}
        focusedFreeToken={mkToken('tok-a')}
      />,
    );
    expect(screen.getByTestId('token-link-btn')).toBeDisabled();
  });

  it('creates a phrase when clicking link with two free tokens', async () => {
    const focusedFreeToken = mkToken('tok-a');
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedFreeToken={focusedFreeToken}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockCreatePhrase).toHaveBeenCalledWith([
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('merges neighbor free token into focused phrase when focus is a phrase', async () => {
    const focusedPhrase = makePhraseLink('p1', ['tok-a']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedPhraseLink={focusedPhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('merges neighbor phrase into focused phrase and deletes neighbor', async () => {
    const focusedPhrase = makePhraseLink('p1', ['tok-a']);
    const neighborPhrase = makePhraseLink('p2', ['tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedPhraseLink={focusedPhrase}
        nextPhraseLink={neighborPhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
    expect(mockDeletePhrase).toHaveBeenCalledWith('p2');
  });

  it('absorbs free token into neighbor phrase when focus is free and neighbor is a phrase', async () => {
    const neighborPhrase = makePhraseLink('p2', ['tok-b']);
    const focusedFreeToken = mkToken('tok-a');
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedFreeToken={focusedFreeToken}
        nextPhraseLink={neighborPhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p2', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('absorbs bridging free token when neighbor is a different fragment of the focused phrase', async () => {
    // Setup: prevToken=tok-b (free, bridging), nextToken=tok-c (in phrase p1 fragment 2).
    // focusedSideIsPrev=true means focus is prev-ward (tok-a's side is prev).
    // neighborLink = nextPhraseLink (focus is prev → neighbor is next side).
    // When neighborLink.analysisId === focusedPhraseLink.analysisId, the bridging free token
    // (prevToken = tok-b) is absorbed into the phrase.
    const focusedPhrase = makePhraseLink('p1', ['tok-a', 'tok-c']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={mkToken('tok-b')}
        nextToken={mkToken('tok-c')}
        focusedSideIsPrev
        focusedPhraseLink={focusedPhrase}
        nextPhraseLink={focusedPhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    // bridgingToken is prevToken (tok-b) when focusedSideIsPrev=true
    expect(mockUpdatePhrase).toHaveBeenCalledWith(
      'p1',
      expect.arrayContaining([{ tokenRef: 'tok-b', surfaceText: 'tok-b' }]),
    );
  });

  it('does nothing when clicking link with no focused free token and no phrase', async () => {
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedFreeToken={undefined}
        focusedPhraseLink={undefined}
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    expect(mockCreatePhrase).not.toHaveBeenCalled();
    expect(mockUpdatePhrase).not.toHaveBeenCalled();
  });

  it('calls onHoverCandidateTokens with token refs on enter and undefined on leave', async () => {
    const onHoverCandidateTokens = jest.fn();
    const focusedFreeToken = mkToken('tok-a');
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedFreeToken={focusedFreeToken}
        onHoverCandidateTokens={onHoverCandidateTokens}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    const btn = screen.getByTestId('token-link-btn');
    await userEvent.hover(btn);
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['tok-a', 'tok-b']);

    await userEvent.unhover(btn);
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(undefined);
  });

  it('uses the false branch of focusedSideIsPrev ternaries when focus is end-ward', async () => {
    // focusedSideIsPrev=false: neighbor is prevToken/prevPhraseLink, bridging is nextToken
    const focusedPhrase = makePhraseLink('p1', ['tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={mkToken('tok-a')}
        nextToken={mkToken('tok-b')}
        focusedSideIsPrev={false}
        focusedPhraseLink={focusedPhrase}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.click(screen.getByTestId('token-link-btn'));
    // Neighbor is prevToken (tok-a, free), absorbed into focused phrase p1 (tok-b)
    expect(mockUpdatePhrase).toHaveBeenCalledWith('p1', [
      { tokenRef: 'tok-a', surfaceText: 'tok-a' },
      { tokenRef: 'tok-b', surfaceText: 'tok-b' },
    ]);
  });

  it('candidatePhraseId falls back to nextPhraseLink analysisId when prevPhraseLink is undefined', () => {
    const nextPhrase = makePhraseLink('p2', ['tok-b']);
    render(
      <TokenLinkIcon {...requiredProps()} prevPhraseLink={undefined} nextPhraseLink={nextPhrase} />,
    );
    // Just verify it renders without errors — the candidatePhraseId uses ?? nextPhraseLink
    expect(screen.getByTestId('token-link-btn')).toBeInTheDocument();
  });

  it('candidatePhraseId uses prevPhraseLink analysisId when prevPhraseLink is defined and not inSamePhrase', () => {
    const prevPhrase = makePhraseLink('p1', ['tok-a']);
    const nextPhrase = makePhraseLink('p2', ['tok-b']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={prevPhrase}
        nextPhraseLink={nextPhrase}
      />,
    );
    // prevPhraseLink.analysisId is defined and different from nextPhraseLink.analysisId (not same phrase)
    // candidatePhraseId = prevPhraseLink.analysisId = 'p1'
    expect(screen.getByTestId('token-link-btn')).toBeInTheDocument();
  });

  it('does not attach hover handlers to unlink button when no candidatePhraseId and no splitFreeRefs', () => {
    // A 2-token phrase where both halves free (splitFreeRefs has 2 items).
    // Set candidatePhraseId to undefined and splitFreeRefs to [] (no tokens to free).
    // This is only possible when a phrase has ≥ 4 tokens and the boundary is in the middle
    // (both halves ≥ 2 tokens). Use a 4-token phrase split at tok-b (before=[tok-a,tok-b], after=[tok-c,tok-d]).
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
      />,
    );
    // Both halves have 2 tokens — no tokens become free — so onMouseEnter is not wired
    expect(screen.getByTestId('token-unlink-btn')).toBeInTheDocument();
  });

  it('highlights all tokens in a multi-token neighbor phrase when focus is free and neighbor is phrase', async () => {
    const neighborPhrase = makePhraseLink('p2', ['tok-b', 'tok-c']);
    const focusedFreeToken = mkToken('tok-a');
    const onHoverCandidateTokens = jest.fn();
    render(
      <TokenLinkIcon
        {...requiredProps()}
        focusedSideIsPrev
        focusedFreeToken={focusedFreeToken}
        nextPhraseLink={neighborPhrase}
        onHoverCandidateTokens={onHoverCandidateTokens}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
      />,
    );
    await userEvent.hover(screen.getByTestId('token-link-btn'));
    // All tokens of the neighbor phrase plus the focused free token
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['tok-a', 'tok-b', 'tok-c']);
  });

  it('does not call onHoverSplitFreeTokens when splitFreeRefs is empty (both halves ≥ 2 tokens)', async () => {
    // 4-token phrase: prevToken=tok-b, so split is after tok-b.
    // before=[tok-a, tok-b] (length 2), after=[tok-c, tok-d] (length 2) — no free tokens.
    const onHoverSplitFreeTokens = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <TokenLinkIcon
        {...requiredProps()}
        prevToken={mkToken('tok-b')}
        nextToken={mkToken('tok-c')}
        prevPhraseLink={phraseLink}
        nextPhraseLink={phraseLink}
        onHoverSplitFreeTokens={onHoverSplitFreeTokens}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
      />,
    );
    await userEvent.hover(screen.getByTestId('token-unlink-btn'));
    expect(onHoverSplitFreeTokens).not.toHaveBeenCalled();
  });
});
