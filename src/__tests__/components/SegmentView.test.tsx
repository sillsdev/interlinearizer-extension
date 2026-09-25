/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhraseAnalysisLink, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { LanguageStrings } from 'platform-bible-utils';
import type { ReactNode } from 'react';
import type { SlotFocusInfo } from '../../types/token-layout';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import { LINK_SLOT_TRANSITION_MS } from '../../components/PhraseStripParts';
import {
  SegmentationProvider,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';
import { SEGMENT_STRING_KEYS, SegmentView, arePropsEqual } from '../../components/SegmentView';
import type { ViewOptions } from '../../types/view-options';
import {
  FIXTURE_STAMPS,
  makePhraseLink,
  makePunctToken,
  makeSegment,
  makeWordToken,
} from '../test-helpers';
import {
  allFalseViewOptions,
  mockKeyAsValueLocalizedStrings,
  withAnalysisStore,
} from './test-helpers';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

/** Stable mock fn for usePhraseLinkMap so individual tests can override the returned map. */
const mockUsePhraseLinkMap = jest
  .fn<Map<string, PhraseAnalysisLink>, []>()
  .mockReturnValue(new Map());

const mockUsePhraseDispatch = jest.fn<jest.MockedObject<PhraseDispatch>, []>().mockReturnValue({
  createPhrase: jest.fn(),
  updatePhrase: jest.fn(),
  deletePhrase: jest.fn(),
  mergePhrases: jest.fn(),
});

/** Stable mock fn capturing `useSegmentFreeTranslationDispatch` calls so tests can assert on them. */
const mockSegmentFreeTranslationDispatch = jest.fn<void, [string, string, string]>();

/** What the mocked `useAnalysisReadOnly` reports; reset in `beforeEach`. */
let mockReadOnly = false;

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  useAnalysisReadOnly: () => mockReadOnly,
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode; analysisLanguage: string }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
  usePhraseLinkMap: () => mockUsePhraseLinkMap(),
  usePhraseLinkByIdMap: () => {
    const map = mockUsePhraseLinkMap();
    return new Map([...new Set(map.values())].map((l) => [l.id, l]));
  },
  usePhraseLinkForToken: () => undefined,
  usePhraseDispatch: () => mockUsePhraseDispatch(),
  usePhraseGloss: () => '',
  usePhraseGlossDispatch: () => () => {},
  useReportGlossEditing: () => {},
  useSegmentFreeTranslation: () => '',
  useSegmentFreeTranslationDispatch: () => mockSegmentFreeTranslationDispatch,
}));

// Hover-preview state is covered by the hook's own unit tests; the view only forwards its
// handlers, so a no-op stub suffices.
const mockCandidateTokenRefs = { current: new Set<string>() };
const mockSplitFreeTokenRefs = { current: new Set<string>() };
jest.mock('../../hooks/usePhraseHoverState', () => ({
  __esModule: true,
  usePhraseHoverState: () => ({
    hoveredGroupKey: undefined,
    setHoveredGroupKey: () => {},
    candidateTokenRefs: mockCandidateTokenRefs.current,
    setCandidateTokenRefs: () => {},
    splitFreeTokenRefs: mockSplitFreeTokenRefs.current,
    handleSplitHoverChange: () => {},
    handleHoverSplitFreeTokens: () => {},
    clearAll: () => {},
  }),
}));

jest.mock('../../components/TokenChip');

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  // Surface the slot's focus side and neighboring token refs so tests can assert which side of each
  // slot the focused group falls on.
  default: ({
    slotFocus,
    prevToken,
    nextToken,
  }: Readonly<{
    slotFocus: SlotFocusInfo;
    prevToken: { ref: string } | undefined;
    nextToken: { ref: string } | undefined;
  }>) => (
    <span
      data-token-link-icon="true"
      data-prev-ref={prevToken?.ref ?? 'none'}
      data-next-ref={nextToken?.ref ?? 'none'}
      data-focused-side-is-prev={String(slotFocus.focusedSideIsPrev)}
    />
  ),
}));

jest.mock('../../components/ArcOverlay', () => ({
  __esModule: true,
  default: ({
    onArcSplit,
    candidatePhraseIds,
  }: Readonly<{
    onArcSplit: (phraseId: string, splitAfterTokenRef: string) => void;
    candidatePhraseIds: ReadonlySet<string>;
  }>) => (
    <button
      type="button"
      data-testid="arc-split-btn"
      // Surface candidatePhraseIds so tests can assert the hovered candidate tokens resolved to the
      // right phrase ids; sorted for a stable string.
      data-candidate-phrase-ids={[...candidatePhraseIds].sort().join(',')}
      onClick={() => onArcSplit('phrase-1', 'tok-0')}
    >
      split
    </button>
  ),
}));

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    groupKey,
    isFocused = false,
    onFocusPhrase,
    tokens,
    showGlossInput = true,
    splitFreeTokenRefs,
  }: Readonly<{
    groupKey: string;
    isFocused: boolean;
    onFocusPhrase: (groupKey: string) => void;
    tokens: (Token & { type: 'word' })[];
    phraseMode: unknown;
    setPhraseMode: unknown;
    phraseLink: unknown;
    showGlossInput?: boolean;
    splitFreeTokenRefs: ReadonlySet<string>;
  }>) => (
    <span
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
      data-show-gloss={showGlossInput}
      // Surface the split-free refs so tests can assert the edit-mode branch swaps in
      // EMPTY_SPLIT_FREE_REFS rather than the live hover set.
      data-split-free-refs={[...splitFreeTokenRefs].sort().join(',')}
    >
      {tokens.map((t) => (
        <span key={t.ref}>
          <button onClick={() => onFocusPhrase(groupKey)} type="button">
            {t.surfaceText}
          </button>
          {/* Mirrors the real TokenChip: a <label> wrapping a non-interactive surface-text span
              that is not itself a button/input, used to exercise the background-click guard. */}
          <label>
            <span>{`label-${t.surfaceText}`}</span>
          </label>
        </span>
      ))}
    </span>
  ),
}));

/** A word token segment. */
const WORD_SEGMENT: Segment = makeSegment('GEN 1:1', 'In the beginning.', [
  makeWordToken('tok-0', 'In'),
  makeWordToken('tok-1', 'the', 3),
]);

/** A segment with a single punctuation (non-word) token. */
const PUNCT_SEGMENT: Segment = makeSegment('GEN 1:2', '.', [makePunctToken('tok-p')]);

/** Every {@link SEGMENT_STRING_KEYS} entry echoed back as its own value. */
function keyAsValueStrings(overrides: Record<string, string> = {}): LanguageStrings {
  return { ...Object.fromEntries(SEGMENT_STRING_KEYS.map((key) => [key, key])), ...overrides };
}

/**
 * Minimal required props for SegmentView. Spread into render calls so tests only need to override
 * what they actually care about.
 */
function requiredProps(): {
  displayMode: 'token-chip';
  editPhraseSegmentId: string | undefined;
  focusedTokenRef: string | undefined;
  gapTextByWordRef: ReadonlyMap<string, string>;
  hoveredPhraseId: string | undefined;
  isActive: boolean;
  onHoverPhrase: jest.Mock;
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  segment: Segment;
  phraseMode: { kind: 'view' };
  setPhraseMode: jest.Mock;
  tokenSegmentMap: ReadonlyMap<string, string>;
  tokenDocOrder: ReadonlyMap<string, number>;
  wordTokenByRef: ReadonlyMap<string, Token & { type: 'word' }>;
  localizedStrings: LanguageStrings;
  viewOptions: ViewOptions;
} {
  return {
    displayMode: 'token-chip',
    editPhraseSegmentId: undefined,
    focusedTokenRef: undefined,
    gapTextByWordRef: new Map(),
    hoveredPhraseId: undefined,
    isActive: false,
    onHoverPhrase: jest.fn(),
    onSelect: jest.fn(),
    segment: WORD_SEGMENT,
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
    tokenSegmentMap: new Map(),
    tokenDocOrder: new Map(),
    wordTokenByRef: new Map(),
    localizedStrings: keyAsValueStrings(),
    viewOptions: { ...allFalseViewOptions },
  };
}

describe('SegmentView', () => {
  beforeEach(() => {
    mockReadOnly = false;
    mockKeyAsValueLocalizedStrings();
    mockUsePhraseLinkMap.mockReturnValue(new Map());
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase: jest.fn(),
      mergePhrases: jest.fn(),
    });
    mockCandidateTokenRefs.current = new Set();
    mockSplitFreeTokenRefs.current = new Set();
  });

  it('renders word token chips in token-chip mode (default)', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(<SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} />, withAnalysisStore);

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders an inline verse superscript at the verse start in token-chip mode', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups).toHaveLength(1);
    expect(sups[0]).toHaveTextContent('1');
  });

  it('renders a verse superscript at each absorbed verse start in a merged segment (token-chip)', () => {
    const mergedSegment: Segment = {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 2 },
      baselineText: 'Alpha Gamma',
      tokens: [makeWordToken('GEN 1:1:0', 'Alpha'), makeWordToken('GEN 1:2:0', 'Gamma', 6)],
      verseStarts: [
        { charStart: 0, number: '1', chapter: 1 },
        { charStart: 6, number: '2', chapter: 1 },
      ],
    };
    render(<SegmentView {...requiredProps()} segment={mergedSegment} />, withAnalysisStore);

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups.map((s) => s.textContent)).toEqual(['1', '2']);
  });

  it('renders no verse superscript at a mid-verse continuation start (token-chip)', () => {
    // The later piece of a mid-verse split carries an isContinuation verse start, so it shows no
    // number (the verse's number already showed in the previous segment).
    const continuationSegment: Segment = {
      id: 'GEN 1:1:6',
      startRef: { book: 'GEN', chapter: 1, verse: 1, charIndex: 6 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'beta',
      tokens: [makeWordToken('GEN 1:1:6', 'beta')],
      verseStarts: [{ charStart: 0, number: '1', chapter: 1, isContinuation: true }],
    };
    render(<SegmentView {...requiredProps()} segment={continuationSegment} />, withAnalysisStore);

    expect(screen.queryByTestId('verse-superscript')).not.toBeInTheDocument();
  });

  it('prefers the list-supplied chapter-qualified label over the verbatim number', () => {
    render(<SegmentView {...requiredProps()} verseStartLabels={['1:1']} />, withAnalysisStore);

    expect(screen.getByTestId('verse-superscript')).toHaveTextContent('1:1');
  });

  it('prefers the list-supplied label in baseline-text mode too', () => {
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" verseStartLabels={['1:1']} />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('verse-superscript')).toHaveTextContent('1:1');
  });

  it('falls back to the verbatim verse number in baseline-text mode when the list supplies none', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    expect(screen.getByTestId('verse-superscript')).toHaveTextContent('1');
  });

  it('renders the gutter label in token-chip mode when the verse gutter is on', () => {
    render(
      <SegmentView
        {...requiredProps()}
        gutterLabel="2–3"
        viewOptions={{ ...allFalseViewOptions, showVerseGutter: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('segment-gutter-label')).toHaveTextContent('2–3');
  });

  it('renders the gutter label in baseline-text mode when the verse gutter is on', () => {
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        gutterLabel="2–3"
        viewOptions={{ ...allFalseViewOptions, showVerseGutter: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('segment-gutter-label')).toHaveTextContent('2–3');
    // The running text still renders alongside the gutter.
    expect(screen.getByTestId('segment-container')).toHaveTextContent('In the beginning.');
  });

  it('hides the gutter and shows inline superscripts when the verse gutter is off', () => {
    render(<SegmentView {...requiredProps()} gutterLabel="2–3" />, withAnalysisStore);

    expect(screen.queryByTestId('segment-gutter-label')).not.toBeInTheDocument();
    expect(screen.getByTestId('verse-superscript')).toBeInTheDocument();
  });

  it('suppresses inline superscripts in token-chip mode when the verse gutter is on', () => {
    render(
      <SegmentView
        {...requiredProps()}
        gutterLabel="2–3"
        viewOptions={{ ...allFalseViewOptions, showVerseGutter: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.queryByTestId('verse-superscript')).not.toBeInTheDocument();
  });

  it('suppresses inline superscripts in baseline-text mode when the verse gutter is on', () => {
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        gutterLabel="2–3"
        viewOptions={{ ...allFalseViewOptions, showVerseGutter: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.queryByTestId('verse-superscript')).not.toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    expect(screen.getByTestId('segment-container')).toHaveTextContent('In the beginning.');
  });

  it('reserves the hydrated height while standing in for an unhydrated segment', () => {
    // An unhydrated segment shows plain text but must hold the space its chips will occupy, or
    // every segment below it shifts when the chips arrive.
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" placeholderHeightPx={172} />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('segment-container')).toHaveStyle({ minHeight: '172px' });
  });

  it('renders an inline verse superscript before the text in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups).toHaveLength(1);
    expect(sups[0]).toHaveTextContent('1');
  });

  it('renders a verse superscript at each absorbed verse start in a merged segment (baseline-text)', () => {
    const mergedSegment: Segment = {
      id: 'GEN 1:1',
      startRef: { book: 'GEN', chapter: 1, verse: 1 },
      endRef: { book: 'GEN', chapter: 1, verse: 2 },
      baselineText: 'Alpha beta. Gamma delta.',
      tokens: [],
      verseStarts: [
        { charStart: 0, number: '1', chapter: 1 },
        { charStart: 12, number: '2', chapter: 1 },
      ],
    };
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" segment={mergedSegment} />,
      withAnalysisStore,
    );

    const sups = screen.getAllByTestId('verse-superscript');
    expect(sups.map((s) => s.textContent)).toEqual(['1', '2']);
    // Each superscript sits immediately before its verse's slice of the baseline.
    expect(screen.getByTestId('segment-container')).toHaveTextContent('1Alpha beta. 2Gamma delta.');
  });

  it('renders no verse superscript at a mid-verse continuation start (baseline-text)', () => {
    const continuationSegment: Segment = {
      id: 'GEN 1:1:6',
      startRef: { book: 'GEN', chapter: 1, verse: 1, charIndex: 6 },
      endRef: { book: 'GEN', chapter: 1, verse: 1 },
      baselineText: 'beta.',
      tokens: [],
      verseStarts: [{ charStart: 0, number: '1', chapter: 1, isContinuation: true }],
    };
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        segment={continuationSegment}
      />,
      withAnalysisStore,
    );

    expect(screen.queryByTestId('verse-superscript')).not.toBeInTheDocument();
    // The baseline text still renders — only the leading number is suppressed.
    expect(screen.getByTestId('segment-container')).toHaveTextContent('beta.');
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('renders no extension-generated segment label header (only the inline verse superscript)', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getAllByTestId('verse-superscript')).toHaveLength(1);
    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    const { container } = render(<SegmentView {...requiredProps()} isActive />, withAnalysisStore);

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is omitted', () => {
    const { container } = render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="true" on the baseline-text button when isActive is true', () => {
    const { container } = render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" isActive />,
      withAnalysisStore,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect with the first word token when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />,
      withAnalysisStore,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    // Passes the first word token so the parent can both highlight the segment and navigate its verse.
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('renders a free-translation input below the plain text in baseline-text mode', () => {
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('segment-free-translation-input')).toBeInTheDocument();
  });

  it('selects the segment once (via focus) when the baseline free-translation input is clicked', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
        onSelect={handleSelect}
      />,
      withAnalysisStore,
    );

    // Focusing the input selects the verse; the container's click handler must not also fire, so
    // onSelect lands exactly once.
    await userEvent.click(screen.getByTestId('segment-free-translation-input'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('calls onSelect with the verse ref and token id when a word token is clicked', async () => {
    const handleSelect = jest.fn();
    render(<SegmentView {...requiredProps()} onSelect={handleSelect} />, withAnalysisStore);

    await userEvent.click(screen.getByRole('button', { name: 'In' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  describe('baseline-text split gestures', () => {
    // `dir` is document state no mock reset clears, so an RTL case would leak into later tests.
    afterEach(() => {
      document.documentElement.removeAttribute('dir');
    });

    /**
     * Renders a SegmentView in baseline-text mode wrapped in the segmentation provider, so the
     * split gap markers can be exercised.
     */
    function renderBaseline(
      options: {
        segment?: Segment;
        phraseMode?: { kind: 'view' } | { kind: 'confirm-unlink'; phraseId: string };
        straddledBoundaryRefs?: ReadonlySet<string>;
        formerBoundaries?: ReadonlyMap<string, string>;
        localizedStrings?: LanguageStrings;
      } = {},
    ) {
      const segment = options.segment ?? WORD_SEGMENT;
      const dispatch = { merge: jest.fn(), split: jest.fn(), move: jest.fn() };
      const onSelect = jest.fn();
      const value: SegmentationContextValue = {
        dispatch,
        segmentById: new Map([[segment.id, segment]]),
        segmentOrder: new Map([[segment.id, 0]]),
        formerBoundaries: options.formerBoundaries ?? new Map(),
        straddledBoundaryRefs: options.straddledBoundaryRefs ?? new Set(),
      };
      render(
        <SegmentationProvider value={value}>
          <SegmentView
            {...requiredProps()}
            displayMode="baseline-text"
            segment={segment}
            phraseMode={options.phraseMode ?? { kind: 'view' }}
            onSelect={onSelect}
            localizedStrings={options.localizedStrings ?? keyAsValueStrings()}
          />
        </SegmentationProvider>,
        withAnalysisStore,
      );
      return { dispatch, onSelect };
    }

    it('renders a split gap between two words', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-gap')).toBeInTheDocument();
    });

    it('marks the split gap without a Split glyph that would crowd the monospace run', () => {
      renderBaseline();
      const gap = screen.getByTestId('baseline-split-gap');
      expect(within(gap).queryByTestId('split-icon')).not.toBeInTheDocument();
    });

    it('names the split action on hover over the gap', () => {
      renderBaseline({
        localizedStrings: keyAsValueStrings({
          '%interlinearizer_boundaryControl_split%': 'Split segment here',
        }),
      });
      const gap = screen.getByTestId('baseline-split-gap');
      fireEvent.mouseMove(gap, { altKey: true });
      expect(screen.getByTestId('baseline-split-gap')).toHaveAttribute(
        'title',
        'Split segment here',
      );
    });

    it('leaves a whitespace gap outside the marker, so a line break can still collapse it', () => {
      renderBaseline();
      // jsdom does no layout, so the wrap itself is unobservable; the space being the marker's
      // sibling rather than its content is what stands in for it.
      expect(screen.getByTestId('baseline-split-gap').textContent).toBe('');
      expect(screen.getByTestId('segment-container').textContent).toBe('1In the beginning.');
    });

    it('tints a whitespace gap over the space alone, so no glyph is painted over', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-tint')).toHaveClass('tw:w-(--gap-space)');
    });

    it('runs a whitespace gap click target past the space, so a wrap leaves it reachable', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-target')).toHaveClass(
        'tw:w-[calc(var(--gap-space)+6px)]',
      );
    });

    it('keeps the tint from swallowing clicks meant for the wider target', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-tint')).toHaveClass('tw:pointer-events-none');
    });

    it('gives a text-bearing gap neither layer, since its own text is already clickable', () => {
      const unspacedSegment: Segment = makeSegment('GEN 3:1', '中文', [
        makeWordToken('w0', '中'),
        makeWordToken('w1', '文', 1),
      ]);
      renderBaseline({ segment: unspacedSegment });
      expect(screen.queryByTestId('baseline-split-tint')).not.toBeInTheDocument();
      expect(screen.queryByTestId('baseline-split-target')).not.toBeInTheDocument();
    });

    it('renders a wide whitespace gap verbatim, so the baseline never reflows', () => {
      const wideGapSegment: Segment = makeSegment('GEN 3:1', 'In \n the', [
        makeWordToken('w0', 'In'),
        makeWordToken('w1', 'the', 5),
      ]);
      renderBaseline({ segment: wideGapSegment });
      expect(screen.getByTestId('segment-container').textContent).toBe('1In \n the');
    });

    it('publishes the measured space width the gap layers size themselves from', () => {
      // jsdom reports every width as 0, so only the property's presence is assertable here.
      renderBaseline();
      const baselineText = screen.getByTestId('segment-container').querySelector('.tw\\:font-mono');
      expect(baselineText?.getAttribute('style')).toContain('--gap-space');
    });

    it('shows no split gap for a read-only analysis', () => {
      mockReadOnly = true;
      renderBaseline();
      expect(screen.queryByTestId('baseline-split-gap')).not.toBeInTheDocument();
    });

    it('shows no split gap while a phrase mode is active', () => {
      renderBaseline({ phraseMode: { kind: 'confirm-unlink', phraseId: 'p1' } });
      expect(screen.queryByTestId('baseline-split-gap')).not.toBeInTheDocument();
    });

    it('shows no split gap at a straddled (mid-phrase) boundary', () => {
      renderBaseline({ straddledBoundaryRefs: new Set(['tok-1']) });
      expect(screen.queryByTestId('baseline-split-gap')).not.toBeInTheDocument();
    });

    it('splits at the resolved anchor on an Alt+click of the gap', () => {
      const { dispatch } = renderBaseline();
      fireEvent.click(screen.getByTestId('baseline-split-gap'), { altKey: true });
      // No punctuation between "In" and "the", so the anchor is the second word token.
      expect(dispatch.split).toHaveBeenCalledWith('tok-1');
    });

    it('does not split on a plain (non-Alt) click of the gap', () => {
      const { dispatch, onSelect } = renderBaseline();
      fireEvent.click(screen.getByTestId('baseline-split-gap'), { altKey: false });
      expect(dispatch.split).not.toHaveBeenCalled();
      // The plain click still routes to the segment-select handler.
      expect(onSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
    });

    it('dispatches the former-boundary ref and anchors the gap at its token on a former boundary', () => {
      // A merged segment whose absorbed verse opened on a quote: `In "the`. The word anchor is "the"
      // (`w1`), but the removed start is the leading quote (`q`), so a split there restores the
      // boundary before the quote, and the caret gap sits before the quote, not the word.
      const quoteSegment: Segment = {
        id: 'GEN 1:1',
        startRef: { book: 'GEN', chapter: 1, verse: 1 },
        endRef: { book: 'GEN', chapter: 1, verse: 2 },
        baselineText: 'In "the',
        tokens: [
          makeWordToken('w0', 'In'),
          makePunctToken('q', '"', 3),
          makeWordToken('w1', 'the', 4),
        ],
        verseStarts: [
          { charStart: 0, number: '1', chapter: 1 },
          { charStart: 3, number: '2', chapter: 1 },
        ],
      };
      const { dispatch } = renderBaseline({
        segment: quoteSegment,
        formerBoundaries: new Map([['w1', 'q']]),
      });
      // The one split gap is the inter-token slice ending just before the quote (offset 3, the space
      // between "In" and the quote), so the caret sits at the restored boundary, not before "the".
      const gap = screen.getByTestId('baseline-split-gap');
      fireEvent.click(gap, { altKey: true });
      expect(dispatch.split).toHaveBeenCalledWith('q');
    });

    it('splits at the punctuation-travel anchor when a leading quote sits in the gap', () => {
      // `In "the` — the quote touches "the", so the boundary lands before the quote token.
      const quoteSegment: Segment = makeSegment('GEN 2:1', 'In "the', [
        makeWordToken('w0', 'In'),
        makePunctToken('q', '"', 3),
        makeWordToken('w1', 'the', 4),
      ]);
      const { dispatch } = renderBaseline({ segment: quoteSegment });
      fireEvent.click(screen.getByTestId('baseline-split-gap'), { altKey: true });
      expect(dispatch.split).toHaveBeenCalledWith('q');
    });

    it('renders the baseline text byte-for-byte with the verse superscript prefixed', () => {
      renderBaseline();
      // The verse label followed by the exact baseline string (whitespace and punctuation preserved).
      expect(screen.getByTestId('segment-container').textContent).toBe('1In the beginning.');
    });

    it('keeps an unspaced script intact, where the gap slice is a whole word', () => {
      // Adjacent tokens in scriptio continua share an offset, leaving no whitespace to be the gap.
      const unspacedSegment: Segment = makeSegment('GEN 3:1', '中文', [
        makeWordToken('w0', '中'),
        makeWordToken('w1', '文', 1),
      ]);
      renderBaseline({ segment: unspacedSegment });
      expect(screen.getByTestId('segment-container').textContent).toBe('1中文');
    });

    it('puts the caret at the trailing edge of a text-bearing gap, where the split falls', () => {
      const unspacedSegment: Segment = makeSegment('GEN 3:1', '中文', [
        makeWordToken('w0', '中'),
        makeWordToken('w1', '文', 1),
      ]);
      renderBaseline({ segment: unspacedSegment });
      // In an RTL baseline the trailing edge of the gap slice is its left.
      expect(screen.getByTestId('baseline-split-caret')).toHaveClass('tw:inset-e-0');
    });

    it('centers the caret over the space a whitespace-only gap renders beside it', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-caret')).toHaveClass(
        'tw:-inset-s-[calc(var(--gap-space)/2)]',
      );
      // Offset by half its own width too: a 1px line whose start edge sits on the center paints
      // half a pixel past it. The utility carries the right-to-left flip of that offset.
      expect(screen.getByTestId('baseline-split-caret')).toHaveClass('tw:translate-half-s');
    });

    /**
     * Gives the hidden space probe a width jsdom would otherwise measure as `0`, at which the
     * tooltip's shift rounds to zero and its direction is unobservable.
     */
    function stubSpaceWidth(width: number) {
      jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(0, 0, width, 0));
    }

    it('shifts the blank gap tooltip back over the space in an LTR interface', () => {
      stubSpaceWidth(8);
      renderBaseline({
        localizedStrings: keyAsValueStrings({
          '%interlinearizer_boundaryControl_split%': 'Split segment here',
        }),
      });
      fireEvent.mouseMove(screen.getByTestId('baseline-split-gap'), { altKey: true });
      expect(screen.getByTestId('baseline-split-gap')).toHaveAttribute(
        'data-tooltip-transform',
        'translateX(-4px)',
      );
    });

    it('shifts the blank gap tooltip the opposite way in an RTL interface', () => {
      document.documentElement.dir = 'rtl';
      stubSpaceWidth(8);
      renderBaseline({
        localizedStrings: keyAsValueStrings({
          '%interlinearizer_boundaryControl_split%': 'Split segment here',
        }),
      });
      fireEvent.mouseMove(screen.getByTestId('baseline-split-gap'), { altKey: true });
      expect(screen.getByTestId('baseline-split-gap')).toHaveAttribute(
        'data-tooltip-transform',
        'translateX(4px)',
      );
    });

    it('reaches back over the space with logical insets, so RTL tints the correct side', () => {
      renderBaseline();
      expect(screen.getByTestId('baseline-split-tint')).toHaveClass('tw:-inset-s-(--gap-space)');
      expect(screen.getByTestId('baseline-split-target')).toHaveClass(
        'tw:-inset-s-[calc(var(--gap-space)+3px)]',
      );
    });
  });

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
  });

  it('groups adjacent tokens that share the same phrase link into a single PhraseBox', () => {
    const sharedLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    const phraseLinkMap = new Map<string, PhraseAnalysisLink>([
      ['tok-0', sharedLink],
      ['tok-1', sharedLink],
    ]);
    mockUsePhraseLinkMap.mockReturnValue(phraseLinkMap);

    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    // Both tokens grouped into one PhraseBox: one wrapper, two buttons.
    expect(document.querySelectorAll('[data-focus-state]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'the' })).toBeInTheDocument();
  });

  it('passes showGlossInput=true to the first fragment and false to the second of a discontiguous phrase', () => {
    /** Segment with two tokens that share a phrase but are separated by a free token. */
    const discontiguousSegment: Segment = makeSegment('GEN 1:3', 'In the beginning.', [
      makeWordToken('tok-a', 'In'),
      makeWordToken('tok-b', 'the', 3),
      makeWordToken('tok-c', 'beginning', 7),
    ]);
    const discontiguousLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-dc',
      analysisId: 'phrase-dc',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-a', surfaceText: 'In' },
        { tokenRef: 'tok-c', surfaceText: 'beginning' },
      ],
    };
    mockUsePhraseLinkMap.mockReturnValue(
      new Map([
        ['tok-a', discontiguousLink],
        ['tok-c', discontiguousLink],
      ]),
    );

    render(
      <SegmentView
        {...requiredProps()}
        segment={discontiguousSegment}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
      />,
      withAnalysisStore,
    );

    // boxes[0]=tok-a (1st fragment), boxes[1]=tok-b (free), boxes[2]=tok-c (2nd fragment)
    const boxes = document.querySelectorAll('[data-show-gloss]');
    expect(boxes[0]).toHaveAttribute('data-show-gloss', 'true');
    expect(boxes[2]).toHaveAttribute('data-show-gloss', 'false');
  });

  it('sets focusedGroupSeen when focusedTokenRef matches a token in a group', () => {
    // tok-0 and tok-1 are unlinked, forming two solo groups with a slot between. With tok-0 focused,
    // every slot after its group is focusedSideIsPrev=true and the leading slot before it is false.
    render(<SegmentView {...requiredProps()} focusedTokenRef="tok-0" />, withAnalysisStore);

    const leadingSlot = document.querySelector('[data-prev-ref="none"][data-next-ref="tok-0"]');
    const middleSlot = document.querySelector('[data-prev-ref="tok-0"][data-next-ref="tok-1"]');
    expect(leadingSlot).toHaveAttribute('data-focused-side-is-prev', 'false');
    expect(middleSlot).toHaveAttribute('data-focused-side-is-prev', 'true');
  });

  it('renders with EMPTY_SPLIT_FREE_REFS when phraseMode is edit', () => {
    const sharedLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    mockUsePhraseLinkMap.mockReturnValue(
      new Map<string, PhraseAnalysisLink>([
        ['tok-0', sharedLink],
        ['tok-1', sharedLink],
      ]),
    );
    // A non-empty live hover set makes the edit-mode swap to EMPTY_SPLIT_FREE_REFS observable.
    mockSplitFreeTokenRefs.current = new Set(['tok-0']);
    render(
      <SegmentView
        {...requiredProps()}
        phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: sharedLink.tokens }}
      />,
      withAnalysisStore,
    );
    expect(document.querySelector('[data-phrase-box]')).toHaveAttribute('data-split-free-refs', '');
  });

  it('passes the live split-free refs to a phrase box in view mode', () => {
    const sharedLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    mockUsePhraseLinkMap.mockReturnValue(
      new Map<string, PhraseAnalysisLink>([
        ['tok-0', sharedLink],
        ['tok-1', sharedLink],
      ]),
    );
    mockSplitFreeTokenRefs.current = new Set(['tok-0']);
    render(<SegmentView {...requiredProps()} phraseMode={{ kind: 'view' }} />, withAnalysisStore);
    // In view mode the live hover set passes through unchanged.
    expect(document.querySelector('[data-phrase-box]')).toHaveAttribute(
      'data-split-free-refs',
      'tok-0',
    );
  });

  it('fires mouse-leave on the token row without throwing', async () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    const tokenRow = document.querySelector('.tw\\:token-row');
    expect(tokenRow).not.toBeNull();
    await userEvent.unhover(tokenRow ?? document.body);
    // No throw = pass
  });

  it('calls onHoverPhrase when a phrase group wrapper is hovered', async () => {
    const sharedLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-0', surfaceText: 'In' },
        { tokenRef: 'tok-1', surfaceText: 'the' },
      ],
    };
    const phraseLinkMap = new Map<string, PhraseAnalysisLink>([
      ['tok-0', sharedLink],
      ['tok-1', sharedLink],
    ]);
    mockUsePhraseLinkMap.mockReturnValue(phraseLinkMap);
    const onHoverPhrase = jest.fn();
    render(<SegmentView {...requiredProps()} onHoverPhrase={onHoverPhrase} />, withAnalysisStore);
    // The PhraseGroup wrapper span wraps the mocked PhraseBox span (data-focus-state).
    const focusStateEl = document.querySelector('[data-focus-state]');
    const phraseGroupSpan = focusStateEl?.parentElement;
    expect(phraseGroupSpan).not.toBeNull();
    await userEvent.hover(phraseGroupSpan ?? document.body);
    expect(onHoverPhrase).toHaveBeenCalledWith('phrase-1');
    await userEvent.unhover(phraseGroupSpan ?? document.body);
    expect(onHoverPhrase).toHaveBeenCalledWith(undefined);
  });

  it('calls splitPhraseAtBoundary when the arc split button is clicked with a known phrase', async () => {
    const deletePhrase = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase,
      mergePhrases: jest.fn(),
    });
    // Two-token phrase split at tok-0 — both halves are 1 token — deletePhrase called
    mockUsePhraseLinkMap.mockReturnValue(
      new Map([['tok-0', makePhraseLink('phrase-1', ['tok-0', 'tok-1'], ['In', 'the'])]]),
    );
    render(
      <SegmentView
        {...requiredProps()}
        tokenDocOrder={
          new Map([
            ['tok-0', 0],
            ['tok-1', 1],
          ])
        }
      />,
      withAnalysisStore,
    );
    await userEvent.click(screen.getByTestId('arc-split-btn'));
    expect(deletePhrase).toHaveBeenCalledWith('phrase-1');
  });

  it('does nothing when the arc split button fires for an unknown phrase id', async () => {
    const deletePhrase = jest.fn();
    mockUsePhraseDispatch.mockReturnValue({
      createPhrase: jest.fn(),
      updatePhrase: jest.fn(),
      deletePhrase,
      mergePhrases: jest.fn(),
    });
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    await userEvent.click(screen.getByTestId('arc-split-btn'));
    expect(deletePhrase).not.toHaveBeenCalled();
  });

  it('focuses the first word token and updates the verse when the background is clicked', async () => {
    const handleSelect = jest.fn();
    render(<SegmentView {...requiredProps()} onSelect={handleSelect} />, withAnalysisStore);

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('does nothing on background click when the segment has no word token', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} onSelect={handleSelect} />,
      withAnalysisStore,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('ignores background clicks that bubble up from an interactive child', async () => {
    const handleSelect = jest.fn();
    render(<SegmentView {...requiredProps()} onSelect={handleSelect} />, withAnalysisStore);

    // Clicking the token button calls onSelect itself (with the clicked token), but the bubbled
    // click on the container must not fire handleBackgroundClick a second time.
    await userEvent.click(screen.getByRole('button', { name: 'the' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-1');
  });

  it('ignores background clicks that bubble up from a phrase-box label, not just an interactive tag', async () => {
    const handleSelect = jest.fn();
    render(<SegmentView {...requiredProps()} onSelect={handleSelect} />, withAnalysisStore);

    // Clicking a chip's surface text lands on a <label>/<span> inside the phrase box; the browser
    // forwards that to the input (firing its own phrase focus), so the bubbled background click must
    // not also refocus the segment's first phrase.
    await userEvent.click(screen.getByText('label-the'));

    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('ignores background clicks that bubble up from an inter-phrase link slot', async () => {
    const handleSelect = jest.fn();
    const { container } = render(
      // Inactive segment with link buttons hidden: the slot between the two token groups leaves an
      // empty clickable gap. Clicking that gap must be a no-op, not snap focus to the first phrase.
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, hideInactiveLinkButtons: true }}
        onSelect={handleSelect}
      />,
      withAnalysisStore,
    );

    const slot = container.querySelector('[data-link-slot]');
    if (!slot) throw new Error('Expected a link slot between the two token groups');
    await userEvent.click(slot);

    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('enables the link-slot fade transition after mount', () => {
    const { container } = render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    // After mount, SegmentView stops suppressing the opacity transition so later toggles of isActive
    // / hideInactiveLinkButtons fade the icon rather than snapping. The fade-carrying span is the
    // icon wrapper, identified by data-testid (its column position varies).
    const slotWrapper = container.querySelector('[data-testid="link-slot-icon"]');
    if (!(slotWrapper instanceof HTMLElement)) throw new Error('Expected a link-slot icon wrapper');
    expect(slotWrapper.style.transitionDuration).toBe(`${LINK_SLOT_TRANSITION_MS}ms`);
  });

  it('computes candidatePhraseIds from non-empty candidateTokenRefs', () => {
    const phraseLink: PhraseAnalysisLink = {
      ...FIXTURE_STAMPS,
      id: 'phrase-1',
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    mockUsePhraseLinkMap.mockReturnValue(new Map([['tok-0', phraseLink]]));
    mockCandidateTokenRefs.current = new Set(['tok-0']);
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    // The hovered candidate token (tok-0) resolves to its phrase (phrase-1), passed to ArcOverlay.
    expect(screen.getByTestId('arc-split-btn')).toHaveAttribute(
      'data-candidate-phrase-ids',
      'phrase-1',
    );
  });

  it('renders a free-translation input below the segment tokens', () => {
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.getByTestId('segment-free-translation-input')).toBeInTheDocument();
  });

  it('hides the free-translation input when showFreeTranslation is false (token-chip mode)', () => {
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: false }}
      />,
      withAnalysisStore,
    );

    expect(screen.queryByTestId('segment-free-translation-input')).not.toBeInTheDocument();
  });

  it('hides the free-translation input when showFreeTranslation is false (baseline-text mode)', () => {
    render(
      <SegmentView
        {...requiredProps()}
        displayMode="baseline-text"
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: false }}
      />,
      withAnalysisStore,
    );

    expect(screen.queryByTestId('segment-free-translation-input')).not.toBeInTheDocument();
  });

  it('commits the free translation on blur when the draft changed', async () => {
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
      />,
      withAnalysisStore,
    );

    const input = screen.getByTestId('segment-free-translation-input');
    await userEvent.type(input, 'au commencement');
    await userEvent.tab();

    expect(mockSegmentFreeTranslationDispatch).toHaveBeenCalledWith(
      'GEN 1:1',
      'In the beginning.',
      'au commencement',
    );
  });

  it('does not commit on blur when the draft is unchanged', async () => {
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
      />,
      withAnalysisStore,
    );

    const input = screen.getByTestId('segment-free-translation-input');
    await userEvent.click(input);
    await userEvent.tab();

    expect(mockSegmentFreeTranslationDispatch).not.toHaveBeenCalled();
  });

  it('makes the segment active when the free-translation input is focused', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
        onSelect={handleSelect}
      />,
      withAnalysisStore,
    );

    await userEvent.click(screen.getByTestId('segment-free-translation-input'));

    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('does not select on free-translation focus when the segment has no word token', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView
        {...requiredProps()}
        segment={PUNCT_SEGMENT}
        viewOptions={{ ...requiredProps().viewOptions, showFreeTranslation: true }}
        onSelect={handleSelect}
      />,
      withAnalysisStore,
    );

    await userEvent.click(screen.getByTestId('segment-free-translation-input'));

    expect(handleSelect).not.toHaveBeenCalled();
  });
});

describe('arePropsEqual', () => {
  /** Two segments, each holding one word token, in document order. */
  const FIRST = makeSegment('GEN 1:1', 'In the', [makeWordToken('a-0', 'In')]);
  const SECOND = makeSegment('GEN 1:2', 'beginning God', [makeWordToken('b-0', 'beginning')]);
  const THIRD = makeSegment('GEN 1:3', 'created light', [makeWordToken('c-0', 'created')]);

  const tokenSegmentMap = new Map([
    ['a-0', FIRST.id],
    ['b-0', SECOND.id],
    ['c-0', THIRD.id],
  ]);
  const tokenDocOrder = new Map([
    ['a-0', 0],
    ['b-0', 1],
    ['c-0', 2],
  ]);

  /**
   * Props for `SECOND` — the segment under test — with the given focus. Built from one shared base
   * so that every prop except `focusedTokenRef` keeps its identity between two calls; a fresh
   * `requiredProps()` per call would differ by the callbacks it mints.
   */
  const baseProps = {
    ...requiredProps(),
    segment: SECOND,
    tokenSegmentMap,
    tokenDocOrder,
  };
  const propsFocusedOn = (focusedTokenRef: string | undefined) => ({
    ...baseProps,
    focusedTokenRef,
  });

  it('skips the re-render when focus moves between two other segments on the same side', () => {
    // `a-0` and `c-0` are both outside SECOND, but on opposite sides, so use two before it.
    const order = new Map([
      ['a-0', 0],
      ['a-1', 1],
      ['b-0', 2],
    ]);
    const segmentMap = new Map([
      ['a-0', FIRST.id],
      ['a-1', FIRST.id],
      ['b-0', SECOND.id],
    ]);
    const base = { ...baseProps, tokenSegmentMap: segmentMap, tokenDocOrder: order };

    expect(
      arePropsEqual({ ...base, focusedTokenRef: 'a-0' }, { ...base, focusedTokenRef: 'a-1' }),
    ).toBe(true);
  });

  it('re-renders when focus crosses the segment from before to after', () => {
    expect(arePropsEqual(propsFocusedOn('a-0'), propsFocusedOn('c-0'))).toBe(false);
  });

  it('re-renders when focus enters the segment', () => {
    expect(arePropsEqual(propsFocusedOn('a-0'), propsFocusedOn('b-0'))).toBe(false);
  });

  it('re-renders when focus leaves the segment', () => {
    expect(arePropsEqual(propsFocusedOn('b-0'), propsFocusedOn('a-0'))).toBe(false);
  });

  it('re-renders when focus clears entirely', () => {
    expect(arePropsEqual(propsFocusedOn('a-0'), propsFocusedOn(undefined))).toBe(false);
  });

  it('treats an unchanged focus as equal', () => {
    expect(arePropsEqual(propsFocusedOn(undefined), propsFocusedOn(undefined))).toBe(true);
  });

  it('re-renders when a non-focus prop changes', () => {
    const before = propsFocusedOn(undefined);
    expect(arePropsEqual(before, { ...before, isActive: true })).toBe(false);
  });

  it('treats a segment with no word tokens as never holding the focus', () => {
    // A punctuation-only segment has no token to place itself in document order, so focus can only
    // ever be foreign to it and every foreign focus looks alike.
    const punctProps = { ...baseProps, segment: PUNCT_SEGMENT };

    expect(
      arePropsEqual(
        { ...punctProps, focusedTokenRef: 'a-0' },
        { ...punctProps, focusedTokenRef: 'c-0' },
      ),
    ).toBe(true);
  });
});
