/** @file Unit tests for components/PhraseStripParts.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PhraseAnalysisLink, Segment, Token } from 'interlinearizer';
import type { ReactElement } from 'react';
import {
  PhraseSlot,
  MemoizedPhraseGroup,
  PhraseStrip,
  type StripItem,
} from '../../components/PhraseStripParts';
import { PhraseStripProvider } from '../../components/PhraseStripContext';
import {
  SegmentationProvider,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';
import { emptyFocusContext } from '../../types/empty-factories';
import type { TokenGroup, LinkSlot, FocusContext } from '../../types/token-layout';
import { makePhraseLink, makePhraseStripContext, makeWordToken } from '../test-helpers';

// ---------------------------------------------------------------------------
// Mocks — keep tests in-lane by stubbing out deep dependencies
// ---------------------------------------------------------------------------

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: ({ isPhraseRevealed }: Readonly<{ isPhraseRevealed: boolean }>) => (
    <span data-testid="link-icon" data-phrase-revealed={String(isPhraseRevealed)} />
  ),
}));

// BoundaryControl reads the phrase links for its not-mid-phrase split guard. Stub the store hook
// with a test-owned map so tests can seed phrases without mounting a real AnalysisStoreProvider.
// (The arrow closes over the map lazily, so the hoisted factory never hits the TDZ.)
const mockPhraseLinkById = new Map<string, PhraseAnalysisLink>();
jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  usePhraseLinkByIdMap: () => mockPhraseLinkById,
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
    isCandidate,
    showControls,
    showGlossInput,
    splitFreeTokenRefs,
    groupKey,
    onFocusPhrase,
  }: Readonly<{
    tokens: (Token & { type: 'word' })[];
    isFocused: boolean;
    isHighlighted: boolean;
    isCandidate: boolean;
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
      data-candidate={isCandidate ? 'true' : 'false'}
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
const NO_FOCUS: FocusContext = emptyFocusContext();

// Every PhraseSlot render mounts BoundaryControl, whose labels come from useLocalizedStrings;
// resetMocks clears the shared implementation, so re-establish the key-to-itself mapping globally.
beforeEach(() => {
  mockPhraseLinkById.clear();
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      keys.reduce<Record<string, string>>((acc, k) => ({ ...acc, [k]: k }), {}),
      false,
    ]);
});

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

/**
 * Wraps `ui` in a {@link PhraseStripProvider} with default context so components that call
 * {@link usePhraseStripContext} can render without a provider in the tree.
 *
 * @param ui - The element to wrap.
 * @returns The wrapped element.
 */
function withProvider(ui: ReactElement): ReactElement {
  return <PhraseStripProvider value={makePhraseStripContext()}>{ui}</PhraseStripProvider>;
}

// ---------------------------------------------------------------------------
// PhraseSlot
// ---------------------------------------------------------------------------

describe('PhraseSlot', () => {
  it('returns undefined when the slot has no neighbors and no punctuation', () => {
    const slot: LinkSlot = { prevGroup: undefined, nextGroup: undefined, punctuation: [] };
    const { container } = render(withProvider(<PhraseSlot {...slotProps(slot)} />));
    expect(container.firstChild).toBeNull();
  });

  it('renders when the slot has punctuation only', () => {
    const slot: LinkSlot = {
      prevGroup: undefined,
      nextGroup: undefined,
      punctuation: [mkPunct('p1')],
    };
    const { container } = render(withProvider(<PhraseSlot {...slotProps(slot)} />));
    expect(container.firstChild).not.toBeNull();
  });

  it('renders when the slot has two neighbors', () => {
    const group: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    const { container } = render(withProvider(<PhraseSlot {...slotProps(slot)} />));
    expect(container.firstChild).not.toBeNull();
  });

  it('sets phraseRevealed when both neighbors are in the same hovered phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: link,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const nextGroup: TokenGroup = {
      tokens: [makeWordToken('tok-b')],
      phraseLink: link,
      firstIndex: 1,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    // phraseRevealed flows into TokenLinkIcon as isPhraseRevealed; the mock
    // surfaces it as data-phrase-revealed so we can assert the computation directly.
    render(withProvider(<PhraseSlot {...slotProps(slot)} hoveredPhraseId="p1" />));
    expect(screen.getByTestId('link-icon')).toHaveAttribute('data-phrase-revealed', 'true');
  });

  it('does not set phraseRevealed when the hovered phrase differs from the neighbors', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: link,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const nextGroup: TokenGroup = {
      tokens: [makeWordToken('tok-b')],
      phraseLink: link,
      firstIndex: 1,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    render(withProvider(<PhraseSlot {...slotProps(slot)} hoveredPhraseId="other-phrase" />));
    expect(screen.getByTestId('link-icon')).toHaveAttribute('data-phrase-revealed', 'false');
  });

  it('sets phraseRevealed via focusedPhraseId when both neighbors are in the same focused phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const prevGroup: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: link,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const nextGroup: TokenGroup = {
      tokens: [makeWordToken('tok-b')],
      phraseLink: link,
      firstIndex: 1,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup, nextGroup, punctuation: [] };
    const focusedContext: FocusContext = {
      focusedToken: makeWordToken('tok-a'),
      focusedPhraseLink: link,
      focusedFreeToken: undefined,
      focusedSegmentId: 'seg-1',
      focusedPhraseId: 'p1',
    };
    // With no hover, the only way phraseRevealed becomes true is the focus.focusedPhraseId branch;
    // the mock exposes it via data-phrase-revealed.
    render(
      withProvider(
        <PhraseSlot {...slotProps(slot)} focus={focusedContext} hoveredPhraseId={undefined} />,
      ),
    );
    expect(screen.getByTestId('link-icon')).toHaveAttribute('data-phrase-revealed', 'true');
  });

  it('renders the link icon when hideInactiveLinkButtons is off', () => {
    const group: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    render(
      withProvider(<PhraseSlot {...slotProps(slot)} />),
      // default context: hideInactiveLinkButtons false
    );
    expect(screen.getByTestId('link-icon')).toBeInTheDocument();
  });

  it('hides the link icon when hideInactiveLinkButtons is on and neither neighbor is in the active segment', () => {
    const group: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    render(
      <PhraseStripProvider
        value={makePhraseStripContext({
          hideInactiveLinkButtons: true,
          activeSegmentId: 'other-seg',
        })}
      >
        <PhraseSlot {...slotProps(slot)} />
      </PhraseStripProvider>,
    );
    // Icon stays mounted but invisible (opacity:0 hides it while the min-height preserves layout space).
    const icon = screen.getByTestId('link-icon');
    expect(icon.parentElement?.style.opacity).toBe('0');
  });

  it('keeps the link icon when hideInactiveLinkButtons is on and both neighbors are in the active segment', () => {
    const group: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    render(
      <PhraseStripProvider
        value={makePhraseStripContext({
          hideInactiveLinkButtons: true,
          activeSegmentId: 'seg-1',
        })}
      >
        <PhraseSlot {...slotProps(slot)} />
      </PhraseStripProvider>,
    );
    expect(screen.getByTestId('link-icon')).toBeInTheDocument();
  });

  it('hides the cross-verse-boundary link icon when only one neighbor is in the active segment', () => {
    const group: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: group, nextGroup: group, punctuation: [] };
    render(
      <PhraseStripProvider
        value={makePhraseStripContext({
          hideInactiveLinkButtons: true,
          activeSegmentId: 'seg-2',
        })}
      >
        {/* prev is in the active seg-2, next is in seg-1 — the slot straddles a verse boundary. */}
        <PhraseSlot {...slotProps(slot)} prevSegmentId="seg-2" nextSegmentId="seg-1" />
      </PhraseStripProvider>,
    );
    // Icon stays mounted but invisible (opacity:0 hides it while the min-height preserves layout space).
    const icon = screen.getByTestId('link-icon');
    expect(icon.parentElement?.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// PhraseSlot boundary controls
// ---------------------------------------------------------------------------

describe('PhraseSlot boundary controls', () => {
  const groupA: TokenGroup = {
    tokens: [makeWordToken('a')],
    phraseLink: undefined,
    firstIndex: 0,
    punctuationBetween: [],
  };
  const groupB: TokenGroup = {
    tokens: [makeWordToken('b')],
    phraseLink: undefined,
    firstIndex: 1,
    punctuationBetween: [],
  };
  const slot: LinkSlot = { prevGroup: groupA, nextGroup: groupB, punctuation: [] };

  /** The segment holding the intra-segment fixture tokens `a` and `b`. */
  const prevSegment: Segment = {
    id: 'seg-1',
    startRef: { book: 'GEN', chapter: 1, verse: 1 },
    endRef: { book: 'GEN', chapter: 1, verse: 1 },
    baselineText: 'a b',
    tokens: [makeWordToken('a'), makeWordToken('b')],
  };

  /** A segment whose first token ref identifies the boundary the merge control removes. */
  const nextSegment: Segment = {
    id: 'seg-2',
    startRef: { book: 'GEN', chapter: 1, verse: 2 },
    endRef: { book: 'GEN', chapter: 1, verse: 2 },
    baselineText: 'b',
    tokens: [makeWordToken('seg2-start')],
  };

  /** Document order for the fixture tokens, used by the not-mid-phrase split guard. */
  const DOC_ORDER: ReadonlyMap<string, number> = new Map([
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ]);

  /**
   * Renders a PhraseSlot inside both providers.
   *
   * @param props - Overrides for the slot props (e.g. prev/next segment ids).
   * @param options - Optional fixture overrides: merged-away boundary refs and the candidate-token
   *   hover spy.
   * @returns The dispatch, for asserting on its calls.
   */
  function renderBoundary(
    props: Partial<Parameters<typeof PhraseSlot>[0]>,
    options: {
      formerBoundaryRefs?: ReadonlySet<string>;
      onHoverCandidateTokens?: (refs: readonly string[] | undefined) => void;
    } = {},
  ) {
    const dispatch = {
      merge: jest.fn(),
      split: jest.fn(),
      move: jest.fn(),
    };
    const value: SegmentationContextValue = {
      dispatch,
      segmentById: new Map([
        ['seg-1', prevSegment],
        ['seg-2', nextSegment],
      ]),
      segmentOrder: new Map([
        ['seg-1', 0],
        ['seg-2', 1],
      ]),
      formerBoundaryRefs: options.formerBoundaryRefs ?? new Set(),
    };
    render(
      <SegmentationProvider value={value}>
        <PhraseStripProvider
          value={makePhraseStripContext({
            tokenDocOrder: DOC_ORDER,
            ...(options.onHoverCandidateTokens
              ? { onHoverCandidateTokens: options.onHoverCandidateTokens }
              : {}),
          })}
        >
          <PhraseSlot {...slotProps(slot)} {...props} />
        </PhraseStripProvider>
      </SegmentationProvider>,
    );
    return dispatch;
  }

  it('shows a merge control on a cross-segment slot and merges on click', () => {
    const dispatch = renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' });
    const button = screen.getByTestId('boundary-merge-btn');
    fireEvent.click(button);
    expect(dispatch.merge).toHaveBeenCalledWith('seg2-start');
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
  });

  it('shows a split control on an intra-segment slot and splits on click', () => {
    const dispatch = renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    const button = screen.getByTestId('boundary-split-btn');
    fireEvent.click(button);
    // The next group's first token ref is the split anchor.
    expect(dispatch.split).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
  });

  it('renders the control always visible, with no hover gating', () => {
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    const wrapper = screen.getByTestId('boundary-split-btn').parentElement;
    expect(wrapper?.className).not.toContain('tw:opacity-0');
    expect(wrapper?.className).not.toContain('tw:group-hover/slot:opacity-100');
  });

  it('renders no split control at a leading slot inside a segment (the boundary already exists)', () => {
    // A SegmentView strip's leading slot has no group before it but carries the segment's id on
    // both sides; splitting at the segment's first token would be a no-op, so no control renders.
    const leadingSlot: LinkSlot = { prevGroup: undefined, nextGroup: groupB, punctuation: [] };
    renderBoundary({ slot: leadingSlot, prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
  });

  it('hides the split control when a phrase spans the boundary (not-mid-phrase UI guard)', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['a', 'b']));
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
  });

  it('hides the split control in the gap between two fragments of a discontiguous phrase', () => {
    // Phrase [a, c] with free token b between: a boundary before b would leave the phrase
    // straddling it even though b itself is not a phrase member.
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['a', 'c']));
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
  });

  it('keeps the split control when phrases sit entirely on one side of the boundary', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['b', 'c']));
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    expect(screen.getByTestId('boundary-split-btn')).toBeInTheDocument();
  });

  it('keeps the merge control when a phrase spans the boundary (merge never cuts a phrase)', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['a', 'b']));
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' });
    expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
  });

  it('renders no control at a leading slot with no previous segment', () => {
    renderBoundary({
      prevSegmentId: undefined,
      nextSegmentId: 'seg-1',
    });
    expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
  });

  it('previews a merge on hover by highlighting the word tokens of both segments', () => {
    const onHoverCandidateTokens = jest.fn();
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' }, { onHoverCandidateTokens });
    fireEvent.mouseEnter(screen.getByTestId('boundary-merge-btn'));
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['a', 'b', 'seg2-start']);
    fireEvent.mouseLeave(screen.getByTestId('boundary-merge-btn'));
    expect(onHoverCandidateTokens).toHaveBeenLastCalledWith(undefined);
  });

  it('previews a split on hover by highlighting the word tokens that would break off', () => {
    const onHoverCandidateTokens = jest.fn();
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' }, { onHoverCandidateTokens });
    fireEvent.mouseEnter(screen.getByTestId('boundary-split-btn'));
    // The split anchor is 'b' (the next group's first token); only the run from it to the segment
    // end becomes the new segment.
    expect(onHoverCandidateTokens).toHaveBeenCalledWith(['b']);
    fireEvent.mouseLeave(screen.getByTestId('boundary-split-btn'));
    expect(onHoverCandidateTokens).toHaveBeenLastCalledWith(undefined);
  });

  it('clears the hover preview synchronously when the control is clicked', () => {
    const onHoverCandidateTokens = jest.fn();
    const dispatch = renderBoundary(
      { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
      { onHoverCandidateTokens },
    );
    const button = screen.getByTestId('boundary-split-btn');
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    expect(onHoverCandidateTokens).toHaveBeenLastCalledWith(undefined);
    expect(dispatch.split).toHaveBeenCalledWith('b');
  });

  it('renders a former-boundary tick on an intra-segment slot at a merged-away verse start', () => {
    renderBoundary(
      { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
      { formerBoundaryRefs: new Set(['b']) },
    );
    expect(screen.getByTestId('former-boundary-marker')).toBeInTheDocument();
    expect(screen.getByTestId('boundary-split-btn')).toBeInTheDocument();
  });

  it('renders no former-boundary tick when the slot is not on a merged-away verse start', () => {
    renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
    expect(screen.queryByTestId('former-boundary-marker')).not.toBeInTheDocument();
  });

  it('keeps the former-boundary tick when the split control is suppressed by the mid-phrase guard', () => {
    mockPhraseLinkById.set('p1', makePhraseLink('p1', ['a', 'b']));
    renderBoundary(
      { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
      { formerBoundaryRefs: new Set(['b']) },
    );
    expect(screen.queryByTestId('boundary-split-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('former-boundary-marker')).toBeInTheDocument();
  });

  it('renders no former-boundary tick on a cross-segment slot', () => {
    // A cross-segment slot sits on a live boundary; the tick marks only merged-away ones.
    renderBoundary(
      { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
      { formerBoundaryRefs: new Set(['b']) },
    );
    expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('former-boundary-marker')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PhraseGroup
// ---------------------------------------------------------------------------

describe('MemoizedPhraseGroup', () => {
  const group: TokenGroup = {
    tokens: [makeWordToken('tok-a', 'Hello')],
    phraseLink: undefined,
    firstIndex: 0,
    punctuationBetween: [],
  };

  const defaultGroupProps: Parameters<typeof MemoizedPhraseGroup>[0] = {
    group,
    isFocused: false,
    isHighlighted: false,
    isCandidate: false,
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

  it('passes isCandidate=true to PhraseBox when set', () => {
    render(<MemoizedPhraseGroup {...defaultGroupProps} isCandidate />);
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();
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
    const tokens = refs.map((r) => makeWordToken(r));
    return {
      kind: 'group',
      key: refs[0],
      group: { tokens, phraseLink: link, firstIndex: 0, punctuationBetween: [] },
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
    const { container } = render(withProvider(<PhraseStrip {...stripProps(items)} />));
    expect(container.firstChild).not.toBeNull();
  });

  it('shows the gloss input only on the first fragment of a discontiguous phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const items = [groupItem(link, ['tok-a']), groupItem(link, ['tok-b'])];
    render(withProvider(<PhraseStrip {...stripProps(items)} />));
    const boxes = screen.getAllByRole('button');
    expect(boxes[0]).toHaveAttribute('data-gloss', 'true');
    expect(boxes[1]).toHaveAttribute('data-gloss', 'false');
  });

  it('marks a group whose token is a hovered-preview candidate as candidate, not highlighted', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    render(
      withProvider(
        <PhraseStrip {...stripProps(items, { candidateTokenRefs: new Set(['tok-a']) })} />,
      ),
    );
    // The candidate preview renders through its own dedicated tier — it must not double as the
    // hover highlight, which also reveals phrase edit controls.
    expect(document.querySelector('[data-candidate="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-highlighted="true"]')).not.toBeInTheDocument();
  });

  it('does not mark candidate groups outside view mode', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    render(
      withProvider(
        <PhraseStrip
          {...stripProps(items, {
            candidateTokenRefs: new Set(['tok-a']),
            phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' },
          })}
        />,
      ),
    );
    expect(document.querySelector('[data-candidate="true"]')).not.toBeInTheDocument();
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
    render(withProvider(<PhraseStrip {...stripProps(items, { focus })} />));
    expect(document.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
  });

  it('shows controls only for the hovered real phrase in view mode', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    render(withProvider(<PhraseStrip {...stripProps(items, { hoveredGroupKey: 'tok-a' })} />));
    expect(document.querySelector('[data-controls="true"]')).toBeInTheDocument();
  });

  it('with simplifyPhrases on, hides controls on a hovered non-focused phrase', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    render(
      <PhraseStripProvider value={makePhraseStripContext({ simplifyPhrases: true })}>
        <PhraseStrip
          {...stripProps(items, {
            hoveredGroupKey: 'tok-a',
            splitFreeTokenRefs: new Set(['tok-a']),
          })}
        />
      </PhraseStripProvider>,
    );
    // The phrase is hovered but not focused (focus is NO_FOCUS), so its controls are suppressed.
    expect(document.querySelector('[data-controls="true"]')).not.toBeInTheDocument();
    // Split-free previews are likewise suppressed for the non-focused phrase.
    expect(document.querySelector('[data-split-free="tok-a"]')).not.toBeInTheDocument();
  });

  it('with simplifyPhrases on, keeps controls on the focused phrase when hovered', () => {
    const link = makePhraseLink('p1', ['tok-a']);
    const items = [groupItem(link, ['tok-a'])];
    const focus: FocusContext = {
      focusedToken: undefined,
      focusedPhraseLink: undefined,
      focusedFreeToken: undefined,
      focusedSegmentId: undefined,
      focusedPhraseId: 'p1',
    };
    render(
      <PhraseStripProvider value={makePhraseStripContext({ simplifyPhrases: true })}>
        <PhraseStrip {...stripProps(items, { hoveredGroupKey: 'tok-a', focus })} />
      </PhraseStripProvider>,
    );
    expect(document.querySelector('[data-controls="true"]')).toBeInTheDocument();
  });

  it('forwards split-free refs in view mode but suppresses them otherwise', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    const splitFreeTokenRefs = new Set(['tok-a']);
    const { rerender } = render(
      withProvider(<PhraseStrip {...stripProps(items, { splitFreeTokenRefs })} />),
    );
    expect(document.querySelector('[data-split-free="tok-a"]')).toBeInTheDocument();

    rerender(
      withProvider(
        <PhraseStrip
          {...stripProps(items, {
            splitFreeTokenRefs,
            phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' },
          })}
        />,
      ),
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
      withProvider(
        <PhraseStrip
          {...stripProps(items, { onHoverPhrase, setHoveredGroupKey, onFocusPhrase })}
        />,
      ),
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
