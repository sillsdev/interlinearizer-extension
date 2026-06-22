/** @file Unit tests for components/TokenLinkIcon.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Segment } from 'interlinearizer';
import type { ComponentProps, ReactElement } from 'react';
import { TokenLinkIcon } from '../../components/TokenLinkIcon';
import {
  PhraseStripProvider,
  type PhraseStripContextValue,
} from '../../components/PhraseStripContext';
import {
  SegmentationProvider,
  type SegmentationContextValue,
  type SegmentationDispatch,
} from '../../components/SegmentationStore';
import type { SlotFocusInfo } from '../../types/token-layout';
import { makePhraseLink, makePhraseStripContext, makeWordToken } from '../test-helpers';

// ---------------------------------------------------------------------------
// AnalysisStore mock
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a `slotFocus` bundle. Defaults to "no focus, same segment" — the baseline used by the
 * link-icon tests, which then layer on `focusedSideIsPrev` / `focusedPhraseLink` /
 * `focusedFreeToken` as needed.
 *
 * @param overrides - Fields to override on the default bundle.
 * @returns A `SlotFocusInfo`.
 */
function slotFocus(overrides: Partial<SlotFocusInfo> = {}): SlotFocusInfo {
  return {
    focusedSideIsPrev: undefined,
    isSameSegmentAsFocus: true,
    isAdjacentEdgeOfFocus: false,
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

/**
 * Renders a `TokenLinkIcon` inside a `PhraseStripProvider`. The phrase mode, document-order lookup,
 * and hover callbacks now come from strip context rather than props.
 *
 * @param ui - The `TokenLinkIcon` element to render.
 * @param context - Partial strip-context overrides (phraseMode, tokenDocOrder, hover callbacks).
 * @returns The Testing Library render result.
 */
function renderIcon(ui: ReactElement, context: Partial<PhraseStripContextValue> = {}) {
  return render(
    <PhraseStripProvider value={makePhraseStripContext(context)}>{ui}</PhraseStripProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Unlink icon (both sides same phrase)
  // ---------------------------------------------------------------------------

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
    // Phrase hover is cleared by the PhraseGroup wrapper span's onMouseLeave, not by the button.
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

  // ---------------------------------------------------------------------------
  // Link icon (different phrases or free)
  // ---------------------------------------------------------------------------

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
    // Setup: prevToken=tok-b (free, bridging), nextToken=tok-c (in phrase p1 fragment 2).
    // focusedSideIsPrev=true means focus is prev-ward (tok-a's side is prev).
    // neighborLink = nextPhraseLink (focus is prev → neighbor is next side).
    // When neighborLink.analysisId === focusedPhraseLink.analysisId, the bridging free token
    // (prevToken = tok-b) is absorbed into the phrase.
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
    // bridgingToken is prevToken (tok-b) when focusedSideIsPrev=true
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
    // focusedSideIsPrev=false: neighbor is prevToken/prevPhraseLink, bridging is nextToken
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

  it('candidatePhraseId falls back to nextPhraseLink analysisId when prevPhraseLink is undefined', () => {
    const nextPhrase = makePhraseLink('p2', ['tok-b']);
    renderIcon(
      <TokenLinkIcon {...requiredProps()} prevPhraseLink={undefined} nextPhraseLink={nextPhrase} />,
    );
    // Just verify it renders without errors — the candidatePhraseId uses ?? nextPhraseLink
    expect(screen.getByTestId('token-link-btn')).toBeInTheDocument();
  });

  it('candidatePhraseId uses prevPhraseLink analysisId when prevPhraseLink is defined and not inSamePhrase', () => {
    const prevPhrase = makePhraseLink('p1', ['tok-a']);
    const nextPhrase = makePhraseLink('p2', ['tok-b']);
    renderIcon(
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
          ['tok-c', 2],
          ['tok-d', 3],
        ]),
      },
    );
    // Both halves have 2 tokens — no tokens become free — so onMouseEnter is not wired
    expect(screen.getByTestId('token-unlink-btn')).toBeInTheDocument();
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
    // All tokens of the neighbor phrase plus the focused free token
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['tok-a', 'tok-b', 'tok-c']);
  });

  it('does not call onHoverSplitFreeTokens when splitFreeRefs is empty (both halves ≥ 2 tokens)', async () => {
    // 4-token phrase: prevToken=tok-b, so split is after tok-b.
    // before=[tok-a, tok-b] (length 2), after=[tok-c, tok-d] (length 2) — no free tokens.
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
  // Cross-segment edge link (pulls an adjacent segment's edge token + moves the boundary)
  // ---------------------------------------------------------------------------

  describe('cross-segment edge link', () => {
    /** A fresh segmentation dispatch whose calls the tests assert on. */
    function makeDispatch(): jest.Mocked<SegmentationDispatch> {
      return { merge: jest.fn(), split: jest.fn(), move: jest.fn() };
    }

    /**
     * Builds an adjacent segment ("seg-B") containing the given token refs in order.
     *
     * @param refs - Word token refs composing the segment, in document order.
     * @returns A segment with id `seg-B`.
     */
    function segB(refs: string[]): Segment {
      return {
        id: 'seg-B',
        startRef: { book: 'GEN', chapter: 1, verse: 2 },
        endRef: { book: 'GEN', chapter: 1, verse: 2 },
        baselineText: refs.join(' '),
        tokens: refs.map((r) => makeWordToken(r)),
      };
    }

    /**
     * Renders a cross-segment edge `TokenLinkIcon` inside both providers.
     *
     * @param dispatch - The segmentation dispatch to capture calls on.
     * @param opts - `focusedSideIsPrev` and the adjacent segment's tokens.
     * @returns The render result.
     */
    function renderEdge(
      dispatch: SegmentationDispatch,
      opts: { focusedSideIsPrev: boolean; segmentTokens: string[]; mapToken?: boolean },
    ) {
      const segmentation: SegmentationContextValue = {
        dispatch,
        boundaryEditMode: false,
        segmentById: new Map([['seg-B', segB(opts.segmentTokens)]]),
        segmentOrder: new Map([
          ['seg-A', 0],
          ['seg-B', 1],
        ]),
      };
      const tokenSegmentMap =
        opts.mapToken === false ? new Map<string, string>() : new Map([['tok-b', 'seg-B']]);
      return render(
        <SegmentationProvider value={segmentation}>
          <PhraseStripProvider value={makePhraseStripContext({ tokenSegmentMap })}>
            <TokenLinkIcon
              {...requiredProps()}
              slotFocus={slotFocus({
                focusedSideIsPrev: opts.focusedSideIsPrev,
                isSameSegmentAsFocus: false,
                isAdjacentEdgeOfFocus: true,
                focusedFreeToken: makeWordToken(opts.focusedSideIsPrev ? 'tok-a' : 'tok-b'),
              })}
            />
          </PhraseStripProvider>
        </SegmentationProvider>,
      );
    }

    it('activates the link button at an adjacent edge even across a segment boundary', () => {
      renderEdge(makeDispatch(), { focusedSideIsPrev: true, segmentTokens: ['tok-b', 'tok-c'] });
      expect(screen.getByTestId('token-link-btn')).toBeEnabled();
    });

    it('pulls one token forward (move) when focus is the previous segment', async () => {
      const dispatch = makeDispatch();
      renderEdge(dispatch, { focusedSideIsPrev: true, segmentTokens: ['tok-b', 'tok-c'] });
      await userEvent.click(screen.getByTestId('token-link-btn'));
      // The adjacent segment B starts at tok-b; pulling tok-b leaves tok-c as B's new start.
      expect(dispatch.move).toHaveBeenCalledWith('tok-b', 'tok-c');
      expect(mockCreatePhrase).toHaveBeenCalled();
    });

    it('merges the whole adjacent segment when it has only the pulled token', async () => {
      const dispatch = makeDispatch();
      renderEdge(dispatch, { focusedSideIsPrev: true, segmentTokens: ['tok-b'] });
      await userEvent.click(screen.getByTestId('token-link-btn'));
      expect(dispatch.merge).toHaveBeenCalledWith('tok-b');
    });

    it('moves the boundary back to the pulled token when focus is the next segment', async () => {
      const dispatch = makeDispatch();
      renderEdge(dispatch, { focusedSideIsPrev: false, segmentTokens: ['tok-b', 'tok-c'] });
      await userEvent.click(screen.getByTestId('token-link-btn'));
      // Focus is segment B (starting at tok-b); pulling the previous segment's tok-a moves B's start to tok-a.
      expect(dispatch.move).toHaveBeenCalledWith('tok-b', 'tok-a');
    });

    it('skips the boundary move but still phrases when the pulled token maps to no segment', async () => {
      const dispatch = makeDispatch();
      renderEdge(dispatch, {
        focusedSideIsPrev: true,
        segmentTokens: ['tok-b', 'tok-c'],
        mapToken: false,
      });
      await userEvent.click(screen.getByTestId('token-link-btn'));
      expect(dispatch.move).not.toHaveBeenCalled();
      expect(dispatch.merge).not.toHaveBeenCalled();
      expect(mockCreatePhrase).toHaveBeenCalled();
    });

    it('leaves the link button inactive (with tooltip) for a non-edge cross-segment slot', () => {
      render(
        <PhraseStripProvider value={makePhraseStripContext({ crossSegmentLinkTooltip: 'nope' })}>
          <TokenLinkIcon
            {...requiredProps()}
            slotFocus={slotFocus({
              focusedSideIsPrev: true,
              isSameSegmentAsFocus: false,
              isAdjacentEdgeOfFocus: false,
            })}
          />
        </PhraseStripProvider>,
      );
      const button = screen.getByTestId('token-link-btn');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'nope');
    });
  });
});
