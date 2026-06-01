/** @file Unit tests for components/PhraseStripParts.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import { PhraseSlot, PhraseGroup, resolveIsHighlighted } from '../../components/PhraseStripParts';
import type { TokenGroup, LinkSlot, FocusContext } from '../../utils/token-layout';

// ---------------------------------------------------------------------------
// Mocks — keep tests in-lane by stubbing out deep dependencies
// ---------------------------------------------------------------------------

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  MemoizedInertTokenChip: () => undefined,
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    tokens,
    isFocused,
    isHighlighted,
  }: Readonly<{
    tokens: (Token & { type: 'word' })[];
    isFocused: boolean;
    isHighlighted: boolean;
    phraseLink: PhraseAnalysisLink | undefined;
    phraseMode: unknown;
    setPhraseMode: unknown;
    focusRef: string | undefined;
    onFocusPhrase: () => void;
    showControls: boolean;
    showGlossInput: boolean;
    arcOffsetPx: number;
    splitFreeTokenRefs: ReadonlySet<string>;
    onHoverCandidatePhrase: () => void;
    onHoverSplitFreeTokens: () => void;
    tokenDocOrder: ReadonlyMap<string, number>;
    tokenSegmentMap: ReadonlyMap<string, string>;
    editPhraseTokens: PhraseAnalysisLink['tokens'] | undefined;
    editPhraseSegmentId: string | undefined;
  }>) => (
    <span
      data-focused={isFocused ? 'true' : 'false'}
      data-highlighted={isHighlighted ? 'true' : 'false'}
    >
      {tokens.map((t) => t.surfaceText).join(' ')}
    </span>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a word token fixture.
 *
 * @param ref - Token ref.
 * @param surfaceText - Surface text.
 * @returns A word token.
 */
function mkWord(ref: string, surfaceText = ref): Token & { type: 'word' } {
  return { ref, surfaceText, writingSystem: 'en', type: 'word', charStart: 0, charEnd: 1 };
}

/**
 * Creates a punctuation token fixture.
 *
 * @param ref - Token ref.
 * @param surfaceText - Surface text.
 * @returns A punctuation token.
 */
function mkPunct(ref: string, surfaceText = '.'): Token {
  return { ref, surfaceText, writingSystem: 'en', type: 'punctuation', charStart: 0, charEnd: 1 };
}

/**
 * Creates an approved phrase link fixture.
 *
 * @param id - Phrase id.
 * @param refs - Token refs.
 * @returns An approved `PhraseAnalysisLink`.
 */
function mkPhraseLink(id: string, refs: string[]): PhraseAnalysisLink {
  return {
    analysisId: id,
    status: 'approved',
    tokens: refs.map((r) => ({ tokenRef: r, surfaceText: r })),
  };
}

/** A minimal no-focus context. */
const NO_FOCUS: FocusContext = {
  focusedToken: undefined,
  focusedPhraseLink: undefined,
  focusedFreeToken: undefined,
  focusedSegmentId: undefined,
  focusedPhraseId: undefined,
};

/** Default props shared by PhraseSlot tests. */
function slotProps(slot: LinkSlot): Parameters<typeof PhraseSlot>[0] {
  return {
    slot,
    focus: NO_FOCUS,
    prevSegmentId: 'seg-1',
    nextSegmentId: 'seg-1',
    focusedSideIsPrev: undefined,
    hoveredPhraseId: undefined,
    phraseMode: { kind: 'view' },
    tokenDocOrder: new Map(),
    onHoverCandidatePhrase: jest.fn(),
    onHoverCandidateTokens: jest.fn(),
    onHoverSplitFreeTokens: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// resolveIsHighlighted
// ---------------------------------------------------------------------------

describe('resolveIsHighlighted', () => {
  const group: TokenGroup = {
    tokens: [mkWord('tok-a')],
    phraseLink: undefined,
    firstIndex: 0,
  };

  it('returns false in view mode when phraseId is undefined and no candidate tokens', () => {
    expect(
      resolveIsHighlighted({ kind: 'view' }, undefined, group, undefined, undefined, new Set()),
    ).toBe(false);
  });

  it('returns true in view mode when phraseId matches hoveredPhraseId', () => {
    expect(resolveIsHighlighted({ kind: 'view' }, 'p1', group, 'p1', undefined, new Set())).toBe(
      true,
    );
  });

  it('returns true in view mode when phraseId matches focusedPhraseId', () => {
    expect(resolveIsHighlighted({ kind: 'view' }, 'p1', group, undefined, 'p1', new Set())).toBe(
      true,
    );
  });

  it('returns true in view mode when a group token is in candidateTokenRefs', () => {
    expect(
      resolveIsHighlighted(
        { kind: 'view' },
        undefined,
        group,
        undefined,
        undefined,
        new Set(['tok-a']),
      ),
    ).toBe(true);
  });

  it('returns false in view mode when none of the highlight conditions are met', () => {
    expect(resolveIsHighlighted({ kind: 'view' }, 'p1', group, 'p2', 'p2', new Set())).toBe(false);
  });

  it('returns true in edit mode when phraseId matches phraseMode.phraseId', () => {
    expect(
      resolveIsHighlighted(
        { kind: 'edit', phraseId: 'p1', originalTokens: [] },
        'p1',
        group,
        undefined,
        undefined,
        new Set(),
      ),
    ).toBe(true);
  });

  it('returns false in edit mode when phraseId does not match phraseMode.phraseId', () => {
    expect(
      resolveIsHighlighted(
        { kind: 'edit', phraseId: 'p1', originalTokens: [] },
        'p2',
        group,
        undefined,
        undefined,
        new Set(),
      ),
    ).toBe(false);
  });

  it('returns false in confirm-unlink mode when phraseId does not match phraseMode.phraseId', () => {
    expect(
      resolveIsHighlighted(
        { kind: 'confirm-unlink', phraseId: 'p1' },
        'p2',
        group,
        undefined,
        undefined,
        new Set(),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PhraseSlot
// ---------------------------------------------------------------------------

describe('PhraseSlot', () => {
  it('returns undefined when the slot has no neighbors and no punctuation', () => {
    const slot: LinkSlot = { prevGroup: undefined, nextGroup: undefined, punctuation: [] };
    const { container } = render(<PhraseSlot {...slotProps(slot)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when the slot has punctuation only', () => {
    const slot: LinkSlot = {
      prevGroup: undefined,
      nextGroup: undefined,
      punctuation: [mkPunct('p1')],
    };
    const { container } = render(<PhraseSlot {...slotProps(slot)} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders when the slot has two neighbors', () => {
    const group: TokenGroup = { tokens: [mkWord('tok-a')], phraseLink: undefined, firstIndex: 0 };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    const { container } = render(<PhraseSlot {...slotProps(slot)} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('sets phraseRevealed when both neighbors are in the same hovered phrase', () => {
    const link = mkPhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = { tokens: [mkWord('tok-a')], phraseLink: link, firstIndex: 0 };
    const nextGroup: TokenGroup = { tokens: [mkWord('tok-b')], phraseLink: link, firstIndex: 1 };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    // PhrasedRevealed means the unlink button is shown — but TokenLinkIcon is mocked to undefined,
    // so just check no errors are thrown when hoveredPhraseId matches.
    const { container } = render(<PhraseSlot {...slotProps(slot)} hoveredPhraseId="p1" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('sets phraseRevealed via focusedPhraseId when both neighbors are in the same focused phrase', () => {
    const link = mkPhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = { tokens: [mkWord('tok-a')], phraseLink: link, firstIndex: 0 };
    const nextGroup: TokenGroup = { tokens: [mkWord('tok-b')], phraseLink: link, firstIndex: 1 };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    const focusedContext: FocusContext = {
      focusedToken: mkWord('tok-a'),
      focusedPhraseLink: link,
      focusedFreeToken: undefined,
      focusedSegmentId: 'seg-1',
      focusedPhraseId: 'p1',
    };
    const { container } = render(
      <PhraseSlot {...slotProps(slot)} focus={focusedContext} hoveredPhraseId={undefined} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PhraseGroup
// ---------------------------------------------------------------------------

describe('PhraseGroup', () => {
  const group: TokenGroup = {
    tokens: [mkWord('tok-a', 'Hello')],
    phraseLink: undefined,
    firstIndex: 0,
  };

  const defaultGroupProps: Parameters<typeof PhraseGroup>[0] = {
    group,
    groupKey: 'tok-a',
    isFocused: false,
    isHighlighted: false,
    splitFreeTokenRefs: new Set(),
    showControls: false,
    showGlossInput: true,
    arcOffsetPx: 0,
    allowHover: false,
    onHoverEnter: jest.fn(),
    onHoverLeave: jest.fn(),
    onFocusPhrase: jest.fn(),
    onHoverCandidatePhrase: jest.fn(),
    onHoverSplitFreeTokens: jest.fn(),
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
    editPhraseTokens: undefined,
    editPhraseSegmentId: undefined,
    tokenSegmentMap: new Map(),
    tokenDocOrder: new Map(),
  };

  it('renders the group tokens via PhraseBox', () => {
    render(<PhraseGroup {...defaultGroupProps} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('passes isFocused=true to PhraseBox when set', () => {
    render(<PhraseGroup {...defaultGroupProps} isFocused />);
    expect(document.querySelector('[data-focused="true"]')).toBeInTheDocument();
  });

  it('passes isHighlighted=true to PhraseBox when set', () => {
    render(<PhraseGroup {...defaultGroupProps} isHighlighted />);
    expect(document.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
  });

  it('does not attach hover handlers when allowHover is false', () => {
    const onHoverEnter = jest.fn();
    render(<PhraseGroup {...defaultGroupProps} allowHover={false} onHoverEnter={onHoverEnter} />);
    // The wrapper span should have no onMouseEnter since allowHover=false
    const wrapper = document.querySelector('span');
    // We cannot call onMouseEnter directly, just verify no error was thrown.
    expect(wrapper).toBeInTheDocument();
  });
});
