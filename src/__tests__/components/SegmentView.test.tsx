/** @file Unit tests for components/SegmentView.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhraseAnalysisLink, ScriptureRef, Segment, Token } from 'interlinearizer';
import type { ReactNode } from 'react';
import { AnalysisStoreProvider } from '../../components/AnalysisStore';
import { SegmentView } from '../../components/SegmentView';

// ---------------------------------------------------------------------------
// AnalysisStore mock — pass-through provider so AnalysisStore.tsx stays out of scope
// ---------------------------------------------------------------------------

/** Stable mock fn for usePhraseLinkMap so individual tests can override the returned map. */
const mockUsePhraseLinkMap = jest
  .fn<Map<string, PhraseAnalysisLink>, []>()
  .mockReturnValue(new Map());

jest.mock('../../components/AnalysisStore', () => ({
  __esModule: true,
  AnalysisStoreProvider({ children }: Readonly<{ children: ReactNode; analysisLanguage: string }>) {
    return children;
  },
  useGloss: () => '',
  useGlossDispatch: () => () => {},
  usePhraseLinkMap: () => mockUsePhraseLinkMap(),
  usePhraseLinkForToken: () => undefined,
  usePhraseDispatch: () => ({
    createPhrase: () => {},
    updatePhrase: () => {},
    deletePhrase: () => {},
  }),
  usePhraseGloss: () => '',
  usePhraseGlossDispatch: () => () => {},
}));

jest.mock('../../components/TokenChip');

jest.mock('../../components/PhraseBox', () => ({
  __esModule: true,
  default: ({
    index,
    isFocused = false,
    onFocusPhrase,
    tokens,
    showGlossInput = true,
  }: Readonly<{
    index: number | undefined;
    isFocused: boolean;
    onFocusPhrase: (index?: number) => void;
    tokens: (Token & { type: 'word' })[];
    phraseMode: unknown;
    setPhraseMode: unknown;
    phraseLink: unknown;
    showGlossInput?: boolean;
  }>) => (
    <span data-focus-state={isFocused ? 'focused' : 'default'} data-show-gloss={showGlossInput}>
      {tokens.map((t) => (
        <span key={t.ref}>
          <button onClick={() => onFocusPhrase(index)} type="button">
            {t.surfaceText}
          </button>
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
  arcLevelByPhraseId: ReadonlyMap<string, number>;
  displayMode: 'token-chip';
  focusedTokenRef: string | undefined;
  hoveredPhraseId: string | undefined;
  isActive: boolean;
  onHoverPhrase: jest.Mock;
  onSelect: (ref: ScriptureRef, tokenRef?: string) => void;
  seenPhraseIds: ReadonlySet<string>;
  segment: Segment;
  phraseMode: { kind: 'view' };
  setPhraseMode: jest.Mock;
} {
  return {
    arcLevelByPhraseId: new Map(),
    displayMode: 'token-chip',
    focusedTokenRef: undefined,
    hoveredPhraseId: undefined,
    isActive: false,
    onHoverPhrase: jest.fn(),
    onSelect: jest.fn(),
    seenPhraseIds: new Set(),
    segment: WORD_SEGMENT,
    phraseMode: { kind: 'view' },
    setPhraseMode: jest.fn(),
  };
}

describe('SegmentView', () => {
  beforeEach(() => {
    mockUsePhraseLinkMap.mockReturnValue(new Map());
  });

  it('renders word token chips in token-chip mode (default)', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('the')).toBeInTheDocument();
  });

  it('renders non-word (punctuation) tokens in token-chip mode', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} segment={PUNCT_SEGMENT} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('.')).toBeInTheDocument();
  });

  it('renders baselineText in baseline-text mode', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('In the beginning.')).toBeInTheDocument();
  });

  it('does not render individual tokens in baseline-text mode', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} displayMode="baseline-text" />
      </AnalysisStoreProvider>,
    );

    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('the')).not.toBeInTheDocument();
  });

  it('shows the verse number label', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('sets aria-current="true" when isActive is true', () => {
    const { container } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} isActive />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('does not set aria-current when isActive is omitted', () => {
    const { container } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="true" on the baseline-text button when isActive is true', () => {
    const { container } = render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} displayMode="baseline-text" isActive />
      </AnalysisStoreProvider>,
    );

    expect(container.firstChild).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSelect when clicked in baseline-text mode', async () => {
    const handleSelect = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} displayMode="baseline-text" onSelect={handleSelect} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByTestId('segment-container'));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('calls onSelect with the verse ref and token id when a word token is clicked', async () => {
    const handleSelect = jest.fn();
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} onSelect={handleSelect} />
      </AnalysisStoreProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'In' }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith({ book: 'GEN', chapter: 1, verse: 1 }, 'tok-0');
  });

  it('renders word tokens as interactive buttons when onSelect is provided', () => {
    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

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

    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} />
      </AnalysisStoreProvider>,
    );

    // Both tokens are grouped into one PhraseBox (the mock renders both as buttons)
    expect(screen.getByRole('button', { name: 'In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'the' })).toBeInTheDocument();
  });

  it('passes showGlossInput=true to the first fragment of a discontiguous phrase', () => {
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
    const discontigLink: PhraseAnalysisLink = {
      analysisId: 'phrase-dc',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-a', surfaceText: 'In' },
        { tokenRef: 'tok-c', surfaceText: 'beginning' },
      ],
    };
    mockUsePhraseLinkMap.mockReturnValue(
      new Map([
        ['tok-a', discontigLink],
        ['tok-c', discontigLink],
      ]),
    );

    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} segment={discontiguousSegment} />
      </AnalysisStoreProvider>,
    );

    const boxes = document.querySelectorAll('[data-show-gloss]');
    // tok-a is first occurrence → showGlossInput=true; tok-c is second → showGlossInput=false
    expect(boxes[0]).toHaveAttribute('data-show-gloss', 'true');
    expect(boxes[2]).toHaveAttribute('data-show-gloss', 'false');
  });

  it('passes showGlossInput=false to the second fragment of a discontiguous phrase', () => {
    const discontiguousSegment: Segment = {
      id: 'GEN 1:4',
      startRef: { book: 'GEN', chapter: 1, verse: 4 },
      endRef: { book: 'GEN', chapter: 1, verse: 4 },
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
    const discontigLink: PhraseAnalysisLink = {
      analysisId: 'phrase-dc',
      status: 'approved',
      tokens: [
        { tokenRef: 'tok-a', surfaceText: 'In' },
        { tokenRef: 'tok-c', surfaceText: 'beginning' },
      ],
    };
    mockUsePhraseLinkMap.mockReturnValue(
      new Map([
        ['tok-a', discontigLink],
        ['tok-c', discontigLink],
      ]),
    );

    render(
      <AnalysisStoreProvider analysisLanguage="und">
        <SegmentView {...requiredProps()} segment={discontiguousSegment} />
      </AnalysisStoreProvider>,
    );

    const boxes = document.querySelectorAll('[data-show-gloss]');
    expect(boxes[2]).toHaveAttribute('data-show-gloss', 'false');
  });
});
