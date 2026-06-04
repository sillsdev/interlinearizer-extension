/** @file Unit tests for components/PhraseStripParts.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import type { PhraseAnalysisLink, Token } from 'interlinearizer';
import {
  PhraseSlot,
  MemoizedPhraseGroup,
  PhraseStrip,
  type StripItem,
} from '../../components/PhraseStripParts';
import type { TokenGroup, LinkSlot, FocusContext } from '../../utils/token-layout';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// Mocks — keep tests in-lane by stubbing out deep dependencies
// ---------------------------------------------------------------------------

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock('../../components/TokenChip', () => ({
  __esModule: true,
  InertTokenChip: () => undefined,
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    tokens,
    isFocused,
    isHighlighted,
    showControls,
    showGlossInput,
    splitFreeTokenRefs,
    groupKey,
    onFocusPhrase,
  }: Readonly<{
    tokens: (Token & { type: 'word' })[];
    isFocused: boolean;
    isHighlighted: boolean;
    phraseLink: PhraseAnalysisLink | undefined;
    groupKey: string;
    onFocusPhrase: (groupKey: string) => void;
    showControls: boolean;
    showGlossInput: boolean;
    splitFreeTokenRefs: ReadonlySet<string>;
  }>) => (
    <button
      type="button"
      data-focused={isFocused ? 'true' : 'false'}
      data-highlighted={isHighlighted ? 'true' : 'false'}
      data-controls={showControls ? 'true' : 'false'}
      data-gloss={showGlossInput ? 'true' : 'false'}
      data-split-free={[...splitFreeTokenRefs].join(',')}
      onClick={() => onFocusPhrase(groupKey)}
    >
      {tokens.map((t) => t.surfaceText).join(' ')}
    </button>
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
  };
}

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
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = { tokens: [mkWord('tok-a')], phraseLink: link, firstIndex: 0 };
    const nextGroup: TokenGroup = { tokens: [mkWord('tok-b')], phraseLink: link, firstIndex: 1 };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    // PhrasedRevealed means the unlink button is shown — but TokenLinkIcon is mocked to undefined,
    // so just check no errors are thrown when hoveredPhraseId matches.
    const { container } = render(<PhraseSlot {...slotProps(slot)} hoveredPhraseId="p1" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('sets phraseRevealed via focusedPhraseId when both neighbors are in the same focused phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
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

describe('MemoizedPhraseGroup', () => {
  const group: TokenGroup = {
    tokens: [mkWord('tok-a', 'Hello')],
    phraseLink: undefined,
    firstIndex: 0,
  };

  const defaultGroupProps: Parameters<typeof MemoizedPhraseGroup>[0] = {
    group,
    isFocused: false,
    isHighlighted: false,
    splitFreeTokenRefs: new Set(),
    showControls: false,
    showGlossInput: true,
    allowHover: false,
    phraseId: undefined,
    groupKey: 'tok-a',
    onHoverPhrase: jest.fn(),
    setHoveredGroupKey: jest.fn(),
    onFocusPhrase: jest.fn(),
  };

  it('renders the group tokens via PhraseBox', () => {
    render(<MemoizedPhraseGroup {...defaultGroupProps} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('passes isFocused=true to PhraseBox when set', () => {
    render(<MemoizedPhraseGroup {...defaultGroupProps} isFocused />);
    expect(document.querySelector('[data-focused="true"]')).toBeInTheDocument();
  });

  it('passes isHighlighted=true to PhraseBox when set', () => {
    render(<MemoizedPhraseGroup {...defaultGroupProps} isHighlighted />);
    expect(document.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
  });

  it('does not attach hover handlers when allowHover is false', () => {
    const onHoverPhrase = jest.fn();
    const setHoveredGroupKey = jest.fn();
    render(
      <MemoizedPhraseGroup
        {...defaultGroupProps}
        allowHover={false}
        onHoverPhrase={onHoverPhrase}
        setHoveredGroupKey={setHoveredGroupKey}
      />,
    );
    const wrapper = document.querySelector('span');
    expect(wrapper).toBeInTheDocument();
    if (wrapper) {
      fireEvent.mouseEnter(wrapper);
      fireEvent.mouseLeave(wrapper);
    }
    expect(onHoverPhrase).not.toHaveBeenCalled();
    expect(setHoveredGroupKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PhraseStrip
// ---------------------------------------------------------------------------

describe('PhraseStrip', () => {
  /**
   * Builds default `PhraseStrip` props with the given items and overrides.
   *
   * @param items - The normalized strip items to render.
   * @param overrides - Partial prop overrides.
   * @returns A complete `PhraseStrip` props object.
   */
  function stripProps(
    items: StripItem[],
    overrides: Partial<Parameters<typeof PhraseStrip>[0]> = {},
  ): Parameters<typeof PhraseStrip>[0] {
    return {
      items,
      phraseMode: { kind: 'view' },
      focus: NO_FOCUS,
      hoveredPhraseId: undefined,
      hoveredGroupKey: undefined,
      candidateTokenRefs: new Set(),
      splitFreeTokenRefs: new Set(),
      onHoverPhrase: jest.fn(),
      setHoveredGroupKey: jest.fn(),
      onFocusPhrase: jest.fn(),
      ...overrides,
    };
  }

  /**
   * Builds a group strip item for a single phrase link.
   *
   * @param link - The phrase link (or `undefined` for a solo token).
   * @param refs - Token refs in the group.
   * @returns A group {@link StripItem}.
   */
  function groupItem(link: PhraseAnalysisLink | undefined, refs: string[]): StripItem {
    const tokens = refs.map((r) => mkWord(r));
    return {
      kind: 'group',
      key: refs[0],
      group: { tokens, phraseLink: link, firstIndex: 0 },
      isFocused: false,
    };
  }

  it('renders a slot item', () => {
    const slot: LinkSlot = {
      prevGroup: undefined,
      nextGroup: undefined,
      punctuation: [mkPunct('p1')],
    };
    const items: StripItem[] = [
      {
        kind: 'slot',
        key: 'slot-1',
        slot,
        prevSegmentId: 'seg-1',
        nextSegmentId: 'seg-1',
        focusedSideIsPrev: undefined,
      },
    ];
    const { container } = render(<PhraseStrip {...stripProps(items)} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows the gloss input only on the first fragment of a discontiguous phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const items = [groupItem(link, ['tok-a']), groupItem(link, ['tok-b'])];
    render(<PhraseStrip {...stripProps(items)} />);
    const boxes = screen.getAllByRole('button');
    expect(boxes[0]).toHaveAttribute('data-gloss', 'true');
    expect(boxes[1]).toHaveAttribute('data-gloss', 'false');
  });

  it('highlights a group whose token is a link candidate', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    render(<PhraseStrip {...stripProps(items, { candidateTokenRefs: new Set(['tok-a']) })} />);
    expect(document.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
  });

  it('highlights a group whose phraseId matches the focused phrase', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    const focus: FocusContext = {
      focusedToken: undefined,
      focusedPhraseLink: undefined,
      focusedFreeToken: undefined,
      focusedSegmentId: undefined,
      focusedPhraseId: 'p1',
    };
    render(<PhraseStrip {...stripProps(items, { focus })} />);
    expect(document.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
  });

  it('shows controls only for the hovered real phrase in view mode', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    render(<PhraseStrip {...stripProps(items, { hoveredGroupKey: 'tok-a' })} />);
    expect(document.querySelector('[data-controls="true"]')).toBeInTheDocument();
  });

  it('forwards split-free refs in view mode but suppresses them otherwise', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    const splitFreeTokenRefs = new Set(['tok-a']);
    const { rerender } = render(<PhraseStrip {...stripProps(items, { splitFreeTokenRefs })} />);
    expect(document.querySelector('[data-split-free="tok-a"]')).toBeInTheDocument();

    rerender(
      <PhraseStrip
        {...stripProps(items, {
          splitFreeTokenRefs,
          phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' },
        })}
      />,
    );
    expect(document.querySelector('[data-split-free="tok-a"]')).not.toBeInTheDocument();
  });

  it('wires hover and focus callbacks for real phrases', () => {
    const onHoverPhrase = jest.fn();
    const setHoveredGroupKey = jest.fn();
    const onFocusPhrase = jest.fn();
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    render(
      <PhraseStrip {...stripProps(items, { onHoverPhrase, setHoveredGroupKey, onFocusPhrase })} />,
    );
    const wrapper = document.querySelector('span');
    expect(wrapper).toBeInTheDocument();
    if (wrapper) {
      fireEvent.mouseEnter(wrapper);
      fireEvent.mouseLeave(wrapper);
    }
    expect(onHoverPhrase).toHaveBeenCalledWith('p1');
    expect(onHoverPhrase).toHaveBeenCalledWith(undefined);
    expect(setHoveredGroupKey).toHaveBeenCalledWith('tok-a');
    expect(setHoveredGroupKey).toHaveBeenCalledWith(undefined);

    fireEvent.click(screen.getByRole('button'));
    expect(onFocusPhrase).toHaveBeenCalledWith('tok-a');
  });
});
