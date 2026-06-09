/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { useLocalizedStrings } from '@papi/frontend/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhraseAnalysisLink, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import type { PhraseDispatch } from '../../components/AnalysisStore';
import { LINK_SLOT_TRANSITION_MS } from '../../components/PhraseStripParts';
import { SegmentView } from '../../components/SegmentView';
import { makePhraseLink } from '../test-helpers';
import { withAnalysisStore } from './test-helpers';

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
}));

// The shared hover-preview state is covered in full by usePhraseHoverState.test.ts. Stub it here so
// SegmentView's tests don't redundantly re-exercise the hook's internals; the view only forwards its
// handlers, which a no-op stub satisfies.
const mockCandidateTokenRefs = { current: new Set<string>() };
jest.mock('../../hooks/usePhraseHoverState', () => ({
  __esModule: true,
  usePhraseHoverState: () => ({
    hoveredGroupKey: undefined,
    setHoveredGroupKey: () => {},
    candidateTokenRefs: mockCandidateTokenRefs.current,
    setCandidateTokenRefs: () => {},
    splitFreeTokenRefs: new Set<string>(),
    handleSplitHoverChange: () => {},
    handleHoverSplitFreeTokens: () => {},
    clearAll: () => {},
  }),
}));

jest.mock('../../components/TokenChip');

jest.mock('../../components/TokenLinkIcon', () => ({
  __esModule: true,
  default: () => undefined,
}));

jest.mock('../../components/ArcOverlay', () => ({
  __esModule: true,
  default: ({
    onArcSplit,
  }: Readonly<{ onArcSplit: (phraseId: string, splitAfterTokenRef: string) => void }>) => (
    <button
      type="button"
      data-testid="arc-split-btn"
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
  }: Readonly<{
    groupKey: string;
    isFocused: boolean;
    onFocusPhrase: (groupKey: string) => void;
    tokens: (Token & { type: 'word' })[];
    phraseMode: unknown;
    setPhraseMode: unknown;
    phraseLink: unknown;
    showGlossInput?: boolean;
  }>) => (
    <span
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
      data-show-gloss={showGlossInput}
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
  hideInactiveLinkButtons: boolean;
  simplifyPhrases: boolean;
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
    hideInactiveLinkButtons: false,
    simplifyPhrases: false,
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

  it('calls onSelect when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />,
      withAnalysisStore,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
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
    render(<SegmentView {...requiredProps()} focusedTokenRef="tok-0" />, withAnalysisStore);
    // Just verifies no error — the focusedSideIsPrev computation runs with a matching token.
    expect(screen.getByText('In')).toBeInTheDocument();
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
    render(
      <SegmentView
        {...requiredProps()}
        phraseMode={{ kind: 'edit', phraseId: 'phrase-1', originalTokens: sharedLink.tokens }}
      />,
      withAnalysisStore,
    );
    // In edit mode, EMPTY_SPLIT_FREE_REFS is used — no errors expected.
    expect(screen.getByText('In')).toBeInTheDocument();
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
      <SegmentView {...requiredProps()} hideInactiveLinkButtons onSelect={handleSelect} />,
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
    // No throw and correct render = the candidatePhraseIds memo ran without error
    render(<SegmentView {...requiredProps()} />, withAnalysisStore);
    // ArcOverlay receives candidatePhraseIds; it renders so no assertion needed beyond no crash
    expect(screen.getByTestId('arc-split-btn')).toBeInTheDocument();
  });
});
