/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import type { PhraseAnalysisLink, Segment, Token } from 'interlinearizer';
import type { ReactElement } from 'react';
import {
  PhraseSlot,
  MemoizedPhraseGroup,
  PhraseStrip,
  type StripItem,
} from '../../components/PhraseStripParts';
import {
  PhraseStripProvider,
  type PhraseStripContextValue,
} from '../../components/PhraseStripContext';
import { AltHeldProvider } from '../../components/AltHeldContext';
import {
  SegmentationProvider,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';
import { emptyFocusContext } from '../../types/empty-factories';
import type { PhraseMode } from '../../types/phrase-mode';
import type { TokenGroup, LinkSlot, FocusContext } from '../../types/token-layout';
import {
  makePhraseLink,
  makePhraseStripContext,
  makePunctToken,
  makeWordToken,
} from '../test-helpers';

// ---------------------------------------------------------------------------
// Mocks — keep tests in-lane by stubbing out deep dependencies
// ---------------------------------------------------------------------------

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: ({ isPhraseRevealed }: Readonly<{ isPhraseRevealed: boolean }>) => (
    <span data-testid="link-icon" data-phrase-revealed={String(isPhraseRevealed)} />
  ),
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

/** A minimal no-focus context. */
const NO_FOCUS: FocusContext = emptyFocusContext();

/** Default props for a PhraseSlot render. */
function slotProps(slot: LinkSlot): Parameters<typeof PhraseSlot>[0] {
  return {
    slot,
    focus: NO_FOCUS,
    prevSegmentId: 'seg-1',
    nextSegmentId: 'seg-1',
    focusedSideIsPrev: undefined,
    hoveredPhraseId: undefined,
    verseLabel: undefined,
  };
}

/**
 * Wraps `ui` in a {@link PhraseStripProvider} so components that call {@link usePhraseStripContext}
 * can render without a provider in the tree, defaulting every context value and layering the given
 * overrides on top — e.g. standing a book's token refs up in `tokenDocOrder`.
 */
function withProvider(
  ui: ReactElement,
  overrides: Partial<PhraseStripContextValue> = {},
): ReactElement {
  return <PhraseStripProvider value={makePhraseStripContext(overrides)}>{ui}</PhraseStripProvider>;
}

/** A `tokenDocOrder` standing the given refs up as the book's word tokens, in the order listed. */
function docOrder(...refs: string[]): ReadonlyMap<string, number> {
  return new Map(refs.map((ref, index) => [ref, index]));
}

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
      punctuation: [makePunctToken('p1')],
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

  it('reserves the normal gap width on a leading slot so an opening verse number is not cramped', () => {
    // A leading slot has no prev group and no link icon, but the column still reserves a normal
    // slot's width (tw:min-w-4) so an opening verse number sits in the same gap as one mid-strip.
    const nextGroup: TokenGroup = {
      tokens: [makeWordToken('tok-a')],
      phraseLink: undefined,
      firstIndex: 0,
      punctuationBetween: [],
    };
    const slot: LinkSlot = { prevGroup: undefined, nextGroup, punctuation: [] };
    const { container } = render(withProvider(<PhraseSlot {...slotProps(slot)} verseLabel="1" />));
    const column = container.querySelector('[data-link-slot]');
    if (!(column instanceof HTMLElement)) throw new Error('Expected the leading slot column');
    expect(column.className).toContain('tw:min-w-4');
    expect(screen.getByTestId('verse-superscript')).toHaveTextContent('1');
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
    // phraseRevealed reaches TokenLinkIcon as isPhraseRevealed, surfaced by the mock as
    // data-phrase-revealed.
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
    // With no hover, phraseRevealed can only become true via the focus.focusedPhraseId branch.
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
    // The icon stays mounted but hidden via opacity:0 (min-height preserves layout space).
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
    // The icon stays mounted but hidden via opacity:0 (min-height preserves layout space).
    const icon = screen.getByTestId('link-icon');
    expect(icon.parentElement?.style.opacity).toBe('0');
  });
});

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
    verseStarts: [{ charStart: 0, number: String(1), chapter: 1 }],
  };

  /** A segment whose first token ref identifies the boundary the merge control removes. */
  const nextSegment: Segment = {
    id: 'seg-2',
    startRef: { book: 'GEN', chapter: 1, verse: 2 },
    endRef: { book: 'GEN', chapter: 1, verse: 2 },
    baselineText: 'b',
    tokens: [makeWordToken('seg2-start')],
    verseStarts: [{ charStart: 0, number: String(2), chapter: 1 }],
  };

  /**
   * Renders a PhraseSlot inside all three providers (segmentation, phrase strip, and Alt-held).
   *
   * @param props - Overrides merged over the default `PhraseSlot` props.
   * @param options - Optional fixture overrides: merged-away boundaries, straddled boundary refs,
   *   the phrase mode, whether Alt is held (defaults to held, so the split marker appears), and
   *   strip-context fields layered over the default boundary labels.
   */
  function renderBoundary(
    props: Partial<Parameters<typeof PhraseSlot>[0]>,
    options: {
      formerBoundaries?: ReadonlyMap<string, string>;
      straddledBoundaryRefs?: ReadonlySet<string>;
      phraseMode?: PhraseMode;
      altHeld?: boolean;
      stripContext?: Partial<PhraseStripContextValue>;
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
      formerBoundaries: options.formerBoundaries ?? new Map(),
      straddledBoundaryRefs: options.straddledBoundaryRefs ?? new Set(),
    };
    render(
      <SegmentationProvider value={value}>
        <AltHeldProvider value={options.altHeld ?? true}>
          <PhraseStripProvider
            value={makePhraseStripContext({
              boundaryMergeLabel: 'Merge',
              boundaryMergeAltHint: 'Merge (Alt+click a gap to split)',
              boundarySplitLabel: 'Split',
              ...(options.phraseMode ? { phraseMode: options.phraseMode } : {}),
              ...options.stripContext,
            })}
          >
            <PhraseSlot {...slotProps(slot)} {...props} />
          </PhraseStripProvider>
        </AltHeldProvider>
      </SegmentationProvider>,
    );
    return dispatch;
  }

  describe('merge branch', () => {
    it('shows an enabled merge button on a cross-segment slot while Alt is not held', () => {
      // The merge button is always present and enabled on a live boundary, no Alt needed.
      const dispatch = renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
        { altHeld: false },
      );
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(dispatch.merge).toHaveBeenCalledWith('seg2-start');
      // Split markers stay Alt-gated, so none shows while Alt is up.
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('shows an enabled merge button on a cross-segment slot while Alt is held and merges on click', () => {
      const dispatch = renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' });
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(dispatch.merge).toHaveBeenCalledWith('seg2-start');
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('keeps the merge control at a straddled boundary ref (merge never cuts a phrase)', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
        { straddledBoundaryRefs: new Set(['b']) },
      );
      expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
    });

    it('renders no merge control while a phrase edit is active', () => {
      // A boundary edit mid-mode could re-segment the phrase the mode UI operates on, so the control
      // is absent (not merely disabled) throughout a phrase mode.
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
        { phraseMode: { kind: 'edit', phraseId: 'p1', originalTokens: [] } },
      );
      expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
    });

    it('labels the merge button with the plain merge string while Alt is held', () => {
      // Alt held → the split marker is already visible, so the merge tooltip needs no Alt hint. The
      // tooltip text rides the Tooltip component; the mock projects it onto the trigger as `title`.
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' });
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toHaveAttribute('aria-label', 'Merge');
      expect(button).toHaveAttribute('title', 'Merge');
    });

    it('adds the Alt-split hint to the merge tooltip while Alt is not held', () => {
      // Alt up → split markers are hidden, so the merge tooltip advertises the Alt gesture that
      // reveals them. The tooltip text rides the Tooltip component (see the plain-merge test above).
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' }, { altHeld: false });
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toHaveAttribute('aria-label', 'Merge');
      expect(button).toHaveAttribute('title', 'Merge (Alt+click a gap to split)');
    });

    it('shows no Alt-hint tooltip while its localized string is still an unresolved key', () => {
      // A `%…%` key straight from PAPI's async localization window would be visible hover text.
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
        {
          altHeld: false,
          stripContext: {
            boundaryMergeAltHint: '%interlinearizer_boundaryControl_mergeAltHint%',
          },
        },
      );
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toHaveAttribute('aria-label', 'Merge');
      expect(button).not.toHaveAttribute('title');
    });

    it('shows no plain-merge tooltip while its localized string is still an unresolved key', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' },
        { stripContext: { boundaryMergeLabel: '%interlinearizer_boundaryControl_merge%' } },
      );
      const button = screen.getByTestId('boundary-merge-btn');
      expect(button).toHaveAttribute('aria-label', '%interlinearizer_boundaryControl_merge%');
      expect(button).not.toHaveAttribute('title');
    });

    it('shows the merge button in its own row alongside the always-visible gap punctuation', () => {
      // The boundary button lives in a dedicated row below the link icon, so the gap punctuation stays
      // in normal flow and the two coexist.
      const slotWithPunct: LinkSlot = {
        prevGroup: groupA,
        nextGroup: groupB,
        punctuation: [makePunctToken('p1'), makePunctToken('p2')],
      };
      renderBoundary({ slot: slotWithPunct, prevSegmentId: 'seg-1', nextSegmentId: 'seg-2' });
      expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
      expect(screen.getByTestId('slot-punctuation')).not.toHaveStyle({ visibility: 'hidden' });
    });
  });

  describe('verse number and boundary button coexistence', () => {
    it('keeps the peeking verse number alongside the always-visible merge button while Alt is not held', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-2', verseLabel: '2' },
        { altHeld: false },
      );
      expect(screen.getByTestId('verse-superscript')).toHaveTextContent('2');
      // Merge stays visible with Alt up; the verse number still peeks above the column.
      expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
    });

    it('keeps the peeking verse number rendered alongside the boundary button under Alt', () => {
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-2', verseLabel: '2' });
      // The merge button sits below the link icon while the verse number peeks above the column.
      expect(screen.getByTestId('boundary-merge-btn')).toBeInTheDocument();
      expect(screen.getByTestId('verse-superscript')).toHaveTextContent('2');
    });

    it('keeps the peeking verse number under Alt when no boundary edit applies at the slot', () => {
      // A straddled intra-segment slot suppresses the split marker, so BoundaryControl renders
      // nothing; the verse number keeps peeking above the column.
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1', verseLabel: '2' },
        { straddledBoundaryRefs: new Set(['b']) },
      );
      expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
      expect(screen.getByTestId('verse-superscript')).toHaveTextContent('2');
    });
  });

  describe('split marker gating', () => {
    it('shows the split marker on an intra-segment slot while Alt is held', () => {
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
      expect(screen.getByTestId('boundary-split-marker')).toBeInTheDocument();
      expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
    });

    it('supplies the split-marker tooltip through the Tooltip component (not a native title)', () => {
      // The marker only exists while Alt is held, and browsers suppress the native `title` tooltip
      // while a modifier is down — so the hover text must come from the platform-bible-react
      // Tooltip. The mock projects TooltipContent's text onto the trigger, so its presence here
      // proves the text flows through the component rather than a raw `title` attribute.
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
      expect(screen.getByTestId('boundary-split-marker')).toHaveAttribute('title', 'Split');
    });

    it('hides the split marker on an intra-segment slot while Alt is not held', () => {
      renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' }, { altHeld: false });
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('hides the split marker at a straddled boundary ref (not-mid-phrase UI guard)', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { straddledBoundaryRefs: new Set(['b']) },
      );
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('keeps the split marker when the anchor is not among the straddled boundary refs', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { straddledBoundaryRefs: new Set(['other-ref']) },
      );
      expect(screen.getByTestId('boundary-split-marker')).toBeInTheDocument();
    });

    it('hides the split marker while a confirm-unlink prompt is active even with Alt held', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' } },
      );
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('renders no split marker at a leading slot inside a segment (the boundary already exists)', () => {
      // A leading slot has no group before it but carries the segment id on both sides; splitting at
      // the segment's first token would be a no-op, so no control renders.
      const leadingSlot: LinkSlot = { prevGroup: undefined, nextGroup: groupB, punctuation: [] };
      renderBoundary({ slot: leadingSlot, prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
    });

    it('renders no control at a leading slot with no previous segment', () => {
      renderBoundary({ prevSegmentId: undefined, nextSegmentId: 'seg-1' });
      expect(screen.queryByTestId('boundary-merge-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });
  });

  describe('split marker gesture', () => {
    it('splits at the word anchor on an Alt+click of the marker', () => {
      const dispatch = renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
      fireEvent.click(screen.getByTestId('boundary-split-marker'), { altKey: true });
      // With no gap punctuation the resolved anchor is the next word token, 'b'.
      expect(dispatch.split).toHaveBeenCalledWith('b');
    });

    it('does not split on a plain (non-Alt) click of the marker', () => {
      const dispatch = renderBoundary({ prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' });
      fireEvent.click(screen.getByTestId('boundary-split-marker'), { altKey: false });
      expect(dispatch.split).not.toHaveBeenCalled();
    });

    it('dispatches the original removed ref when Alt+clicking a former boundary', () => {
      // The merged-away verse began with punctuation: the word anchor 'b' maps to the removed
      // punctuation start ref, and the restore dispatches that original ref, not the travel anchor.
      const dispatch = renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { formerBoundaries: new Map([['b', 'punct-start']]) },
      );
      fireEvent.click(screen.getByTestId('boundary-split-marker'), { altKey: true });
      expect(dispatch.split).toHaveBeenCalledWith('punct-start');
    });

    it('splits at the punctuation-travel anchor when a leading quote sits in the gap', () => {
      // `word1 "word2` — the quote touches word2, so the boundary lands before the quote.
      const quote: Token = makePunctToken('q', '"', 6);
      const word1: Token & { type: 'word' } = { ...makeWordToken('w1'), charStart: 0, charEnd: 5 };
      const word2: Token & { type: 'word' } = { ...makeWordToken('w2'), charStart: 7, charEnd: 12 };
      const quoteSlot: LinkSlot = {
        prevGroup: {
          tokens: [word1],
          phraseLink: undefined,
          firstIndex: 0,
          punctuationBetween: [],
        },
        nextGroup: {
          tokens: [word2],
          phraseLink: undefined,
          firstIndex: 1,
          punctuationBetween: [],
        },
        punctuation: [quote],
      };
      const dispatch = {
        merge: jest.fn(),
        split: jest.fn(),
        move: jest.fn(),
      };
      const quoteSegment: Segment = {
        id: 'seg-q',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 1 },
        baselineText: 'word1 "word2',
        tokens: [word1, quote, word2],
        verseStarts: [{ charStart: 0, number: '1', chapter: 1 }],
      };
      render(
        <SegmentationProvider
          value={{
            dispatch,
            segmentById: new Map([['seg-q', quoteSegment]]),
            segmentOrder: new Map([['seg-q', 0]]),
            formerBoundaries: new Map(),
            straddledBoundaryRefs: new Set(),
          }}
        >
          <AltHeldProvider value>
            <PhraseStripProvider value={makePhraseStripContext()}>
              <PhraseSlot {...slotProps(quoteSlot)} prevSegmentId="seg-q" nextSegmentId="seg-q" />
            </PhraseStripProvider>
          </AltHeldProvider>
        </SegmentationProvider>,
      );
      fireEvent.click(screen.getByTestId('boundary-split-marker'), { altKey: true });
      expect(dispatch.split).toHaveBeenCalledWith('q');
    });
  });

  describe('former boundary', () => {
    // The inline verse superscript already marks a merged-away verse start, so nothing extra renders
    // at a former boundary while Alt is not held.
    it('renders nothing at a former boundary while Alt is not held', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { formerBoundaries: new Map([['b', 'b']]), altHeld: false },
      );
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });

    it('reveals the split marker at a former boundary when Alt is held', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { formerBoundaries: new Map([['b', 'b']]) },
      );
      expect(screen.getByTestId('boundary-split-marker')).toBeInTheDocument();
    });

    it('renders nothing at a former boundary whose split is suppressed by the mid-phrase guard even with Alt held', () => {
      renderBoundary(
        { prevSegmentId: 'seg-1', nextSegmentId: 'seg-1' },
        { formerBoundaries: new Map([['b', 'b']]), straddledBoundaryRefs: new Set(['b']) },
      );
      expect(screen.queryByTestId('boundary-split-marker')).not.toBeInTheDocument();
    });
  });
});

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

describe('PhraseStrip', () => {
  /** Builds default `PhraseStrip` props with the given items and overrides. */
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

  /** Builds a group strip item for a single phrase link. */
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
      punctuation: [makePunctToken('p1')],
    };
    const items: StripItem[] = [
      {
        kind: 'slot',
        key: 'slot-1',
        slot,
        prevSegmentId: 'seg-1',
        nextSegmentId: 'seg-1',
        focusedSideIsPrev: undefined,
        verseLabel: undefined,
      },
    ];
    const { container } = render(withProvider(<PhraseStrip {...stripProps(items)} />));
    expect(container.firstChild).not.toBeNull();
  });

  it('shows the gloss input only on the first fragment of a discontiguous phrase', () => {
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const items = [groupItem(link, ['tok-a']), groupItem(link, ['tok-b'])];
    render(
      withProvider(<PhraseStrip {...stripProps(items)} />, {
        tokenDocOrder: docOrder('tok-a', 'tok-b'),
      }),
    );
    const boxes = screen.getAllByRole('button');
    expect(boxes[0]).toHaveAttribute('data-gloss', 'true');
    expect(boxes[1]).toHaveAttribute('data-gloss', 'false');
  });

  it('withholds the gloss input from a later fragment even when the first one is not rendered', () => {
    // A windowed strip can mount a later fragment while the first one is outside its window.
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const items = [groupItem(link, ['tok-b'])];
    render(
      withProvider(<PhraseStrip {...stripProps(items)} />, {
        tokenDocOrder: docOrder('tok-a', 'tok-b'),
      }),
    );
    expect(screen.getByRole('button')).toHaveAttribute('data-gloss', 'false');
  });

  it('moves the gloss input to the next surviving fragment when the phrase starts on a token the book no longer has', () => {
    // A baseline edit shifts every later token's ref, so a stored ref can name a token that is gone
    // while a further one still resolves.
    const link = makePhraseLink('p1', ['tok-a', 'tok-b']);
    const items = [groupItem(link, ['tok-b'])];
    render(
      withProvider(<PhraseStrip {...stripProps(items)} />, { tokenDocOrder: docOrder('tok-b') }),
    );
    expect(screen.getByRole('button')).toHaveAttribute('data-gloss', 'true');
  });

  it('marks a group whose token is a hovered-preview candidate as candidate, not highlighted', () => {
    const items = [groupItem(undefined, ['tok-a'])];
    render(
      withProvider(
        <PhraseStrip {...stripProps(items, { candidateTokenRefs: new Set(['tok-a']) })} />,
      ),
    );
    // The candidate preview has its own tier; it must not double as the hover highlight, which also
    // reveals phrase edit controls.
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
