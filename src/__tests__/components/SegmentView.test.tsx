/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhraseAnalysisLink, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import type { SlotFocusInfo } from '../../types/token-layout';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import { LINK_SLOT_TRANSITION_MS } from '../../components/PhraseStripParts';
import { SegmentView } from '../../components/SegmentView';
import type { ViewOptions } from '../../types/view-options';
import { makePhraseLink } from '../test-helpers';
import { allFalseViewOptions, withAnalysisStore } from './test-helpers';

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

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode; analysisLanguage: string }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
  usePhraseLinkMap: () => mockUsePhraseLinkMap(),
  usePhraseLinkByIdMap: () => {
    const map = mockUsePhraseLinkMap();
    return new Map([...new Set(map.values())].map((l) => [l.analysisId, l]));
  },
  usePhraseLinkForToken: () => undefined,
  usePhraseDispatch: () => mockUsePhraseDispatch(),
  usePhraseGloss: () => '',
  usePhraseGlossDispatch: () => () => {},
  useReportGlossEditing: () => {},
  useSegmentFreeTranslation: () => '',
  useSegmentFreeTranslationDispatch: () => mockSegmentFreeTranslationDispatch,
}));

// The shared hover-preview state is covered in full by usePhraseHoverState.test.ts. Stub it here so
// SegmentView's tests don't redundantly re-exercise the hook's internals; the view only forwards its
// handlers, which a no-op stub satisfies.
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
  // Surface the slot's focus side and its neighboring token refs so tests can assert which side of
  // each slot SegmentView decided the focused group falls on (the focusedSideIsPrevByUnit walk).
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
      // Surface candidatePhraseIds (computed by useCandidatePhraseIds) so tests can assert the memo
      // resolved the hovered candidate tokens to the right phrase ids; sorted for a stable string.
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
      // Surface the split-free refs PhraseStrip selected for this group so tests can assert the
      // edit-mode branch swaps in EMPTY_SPLIT_FREE_REFS rather than the live hover set.
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
const WORD_SEGMENT: Segment = {
  id: 'GEN 1:1',
  startRef: { book: 'GEN', chapter: 1, verse: 1 },
  endRef: { book: 'GEN', chapter: 1, verse: 1 },
  baselineText: 'In the beginning.',
  tokens: [
    {
      ref: 'tok-0',
      surfaceText: 'In',
      writingSystem: 'en',
      type: 'word',
      charStart: 0,
      charEnd: 2,
    },
    {
      ref: 'tok-1',
      surfaceText: 'the',
      writingSystem: 'en',
      type: 'word',
      charStart: 3,
      charEnd: 6,
    },
  ],
};

/** A segment with a single punctuation (non-word) token. */
const PUNCT_SEGMENT: Segment = {
  id: 'GEN 1:2',
  startRef: { book: 'GEN', chapter: 1, verse: 2 },
  endRef: { book: 'GEN', chapter: 1, verse: 2 },
  baselineText: '.',
  tokens: [
    {
      ref: 'tok-p',
      surfaceText: '.',
      writingSystem: 'en',
      type: 'punctuation',
      charStart: 0,
      charEnd: 1,
    },
  ],
};

/**
 * Minimal required props for SegmentView. Spread into render calls so tests only need to override
 * what they actually care about.
 *
 * @returns An object containing all required SegmentView props set to no-op stubs.
 */
function requiredProps(): {
  displayMode: 'token-chip';
  editPhraseSegmentId: string | undefined;
  focusedTokenRef: string | undefined;
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
  viewOptions: ViewOptions;
} {
  return {
    displayMode: 'token-chip',
    editPhraseSegmentId: undefined,
    focusedTokenRef: undefined,
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
    viewOptions: { ...allFalseViewOptions },
  };
}

describe('SegmentView', () => {
  beforeEach(() => {
    jest
      .mocked(useLocalizedStrings)
      .mockImplementation((keys: readonly string[]) => [
        Object.fromEntries(keys.map((k) => [k, k])),
        false,
      ]);
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

  it('renders baselineText in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(<SegmentView {...requiredProps()} displayMode="baseline-text" />, withAnalysisStore);

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows a bare verse number by default', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('1:1')).not.toBeInTheDocument();
  });

  it('folds the chapter into the verse label when chapterLabelInVerse is set', () => {
    render(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, chapterLabelInVerse: true }}
      />,
      withAnalysisStore,
    );

    expect(screen.getByText('1:1')).toBeInTheDocument();
  });

  it('never renders the inline chapter header (the list owns it)', () => {
    const { rerender } = render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();

    rerender(
      <SegmentView
        {...requiredProps()}
        viewOptions={{ ...requiredProps().viewOptions, chapterLabelInVerse: true }}
      />,
    );
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

    // Passes the first word token so the segment gains focus (and the active highlight) on click,
    // letting the parent both highlight the segment and navigate to its verse.
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

    // Focusing the input selects the verse via its token ref; the container's click handler must
    // not also fire a bare-ref select, so onSelect lands exactly once.
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

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);

    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
  });

  it('groups adjacent tokens that share the same phrase link into a single PhraseBox', () => {
    const sharedLink: PhraseAnalysisLink = {
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

    // Both tokens are grouped into one PhraseBox (the mock renders both as buttons inside one wrapper)
    expect(document.querySelectorAll('[data-focus-state]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'the' })).toBeInTheDocument();
  });

  it('passes showGlossInput=true to the first fragment and false to the second of a discontiguous phrase', () => {
    /** Segment with two tokens that share a phrase but are separated by a free token. */
    const discontiguousSegment: Segment = {
      id: 'GEN 1:3',
      startRef: { book: 'GEN', chapter: 1, verse: 3 },
      endRef: { book: 'GEN', chapter: 1, verse: 3 },
      baselineText: 'In the beginning.',
      tokens: [
        {
          ref: 'tok-a',
          surfaceText: 'In',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 2,
        },
        {
          ref: 'tok-b',
          surfaceText: 'the',
          writingSystem: 'en',
          type: 'word',
          charStart: 3,
          charEnd: 6,
        },
        {
          ref: 'tok-c',
          surfaceText: 'beginning',
          writingSystem: 'en',
          type: 'word',
          charStart: 7,
          charEnd: 16,
        },
      ],
    };
    const discontiguousLink: PhraseAnalysisLink = {
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

    render(<SegmentView {...requiredProps()} segment={discontiguousSegment} />, withAnalysisStore);

    // boxes[0]=tok-a (1st fragment), boxes[1]=tok-b (free), boxes[2]=tok-c (2nd fragment)
    const boxes = document.querySelectorAll('[data-show-gloss]');
    expect(boxes[0]).toHaveAttribute('data-show-gloss', 'true');
    expect(boxes[2]).toHaveAttribute('data-show-gloss', 'false');
  });

  it('sets focusedGroupSeen when focusedTokenRef matches a token in a group', () => {
    // tok-0 and tok-1 are unlinked, so they form two solo groups with a slot between them. With
    // tok-0 focused, the focusedSideIsPrevByUnit walk marks every slot *after* the tok-0 group as
    // focusedSideIsPrev=true (focus is start-ward) and the leading slot before it as false.
    render(<SegmentView {...requiredProps()} focusedTokenRef="tok-0" />, withAnalysisStore);

    const leadingSlot = document.querySelector('[data-prev-ref="none"][data-next-ref="tok-0"]');
    const middleSlot = document.querySelector('[data-prev-ref="tok-0"][data-next-ref="tok-1"]');
    expect(leadingSlot).toHaveAttribute('data-focused-side-is-prev', 'false');
    expect(middleSlot).toHaveAttribute('data-focused-side-is-prev', 'true');
  });

  it('renders with EMPTY_SPLIT_FREE_REFS when phraseMode is edit', () => {
    const sharedLink: PhraseAnalysisLink = {
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
    // A non-empty live hover set so the edit-mode swap to EMPTY_SPLIT_FREE_REFS is observable: if the
    // branch were absent, the box would receive this set instead of an empty one.
    mockSplitFreeTokenRefs.current = new Set(['tok-0']);
    render(
      <SegmentView
        {...requiredProps()}
        phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: sharedLink.tokens }}
      />,
      withAnalysisStore,
    );
    // Edit mode forces EMPTY_SPLIT_FREE_REFS, so the box's split-free refs are empty even though the
    // hover state has tok-0.
    expect(document.querySelector('[data-phrase-box]')).toHaveAttribute('data-split-free-refs', '');
  });

  it('passes the live split-free refs to a phrase box in view mode', () => {
    const sharedLink: PhraseAnalysisLink = {
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
    // In view mode (controls allowed) the live hover set passes through unchanged — the contrast
    // that makes the edit-mode EMPTY_SPLIT_FREE_REFS swap meaningful.
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

    // Clicking a token chip's surface text lands on a <label>/<span> inside the phrase box, not on
    // the gloss input itself. The browser still forwards that click to the input (which fires its
    // own phrase focus), so the bubbled background click must NOT also fire and refocus the
    // segment's first phrase — the bug seen when clicking an out-of-segment phrase fragment.
    await userEvent.click(screen.getByText('label-the'));

    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('ignores background clicks that bubble up from an inter-phrase link slot', async () => {
    const handleSelect = jest.fn();
    const { container } = render(
      // Inactive segment with link buttons hidden: the slot between the two token groups collapses
      // its link button to zero width, leaving an empty clickable gap. Clicking that gap must NOT
      // snap focus to the segment's first phrase (the reported out-of-segment bug); it should be a
      // no-op, matching the buttons-visible case where the button absorbs it.
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

    // After mount, SegmentView stops suppressing the opacity transition so later toggles of
    // isActive / hideInactiveLinkButtons fade the icon in/out instead of snapping.
    const slotWrapper = container.querySelector('[data-link-slot] > span');
    if (!(slotWrapper instanceof HTMLElement)) throw new Error('Expected a link-slot wrapper span');
    expect(slotWrapper.style.transitionDuration).toBe(`${LINK_SLOT_TRANSITION_MS}ms`);
  });

  it('computes candidatePhraseIds from non-empty candidateTokenRefs', () => {
    const phraseLink: PhraseAnalysisLink = {
      analysisId: 'phrase-1',
      status: 'approved',
      tokens: [{ tokenRef: 'tok-0', surfaceText: 'In' }],
    };
    mockUsePhraseLinkMap.mockReturnValue(new Map([['tok-0', phraseLink]]));
    mockCandidateTokenRefs.current = new Set(['tok-0']);
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    // useCandidatePhraseIds maps the hovered candidate token (tok-0) to its phrase id (phrase-1),
    // and SegmentView passes that set to ArcOverlay's candidatePhraseIds prop.
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
