/** @file Unit tests for components/ArcOverlay.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArcOverlay } from '../../components/ArcOverlay';
import type { ArcPath } from '../../utils/phrase-arc';
import { makePhraseLink } from '../test-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal `ArcPath` fixture.
 *
 * @param phraseId - Phrase id for the arc.
 * @param splitAfterTokenRef - Token ref marking the end of the earlier fragment.
 * @returns An `ArcPath` with placeholder geometry.
 */
function makeArcPath(phraseId: string, splitAfterTokenRef = 'tok-a'): ArcPath {
  // `d` is derived from splitAfterTokenRef so distinct split points yield distinct
  // path data — matching real arcs, where the React key `${phraseId}-${d}` stays unique.
  return {
    phraseId,
    d: `M0 0 L100 0 ${splitAfterTokenRef}`,
    midX: 50,
    midY: 10,
    runLeft: 0,
    runRight: 100,
    splitAfterTokenRef,
  };
}

/** Default no-op props for `ArcOverlay`. */
function requiredProps(): Parameters<typeof ArcOverlay>[0] {
  return {
    arcPaths: [],
    phraseMode: { kind: 'view' },
    hoveredPhraseId: undefined,
    focusedPhraseId: undefined,
    candidatePhraseIds: new Set(),
    phraseLinkById: new Map(),
    tokenDocOrder: new Map(),
    onArcSplit: jest.fn(),
    onSplitHoverChange: jest.fn(),
    onHoverPhrase: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArcOverlay', () => {
  it('returns undefined when arcPaths is empty', () => {
    const { container } = render(<ArcOverlay {...requiredProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG when arcPaths has entries', () => {
    render(<ArcOverlay {...requiredProps()} arcPaths={[makeArcPath('p1')]} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('renders one SVG path element per arc', () => {
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a'), makeArcPath('p2', 'tok-b')]}
      />,
    );
    expect(document.querySelectorAll('path')).toHaveLength(2);
  });

  it('does not render split buttons in edit mode', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        phraseMode={{ kind: 'edit', phraseId: 'p1', originalTokens: phraseLink.tokens }}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
      />,
    );
    expect(screen.queryByTestId('split-arc-btn')).not.toBeInTheDocument();
  });

  it('renders a split button in view mode even when the arc phrase is neither hovered nor focused', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId={undefined}
        focusedPhraseId={undefined}
        phraseLinkById={new Map([['p1', phraseLink]])}
      />,
    );
    expect(screen.getByTestId('split-arc-btn')).toBeInTheDocument();
    expect(screen.getByTestId('split-arc-btn').className).not.toContain('text-muted-foreground');
  });

  it('with simplifyPhrases on, hides the split button for a non-focused phrase but keeps its arc', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        focusedPhraseId="p2"
        phraseLinkById={new Map([['p1', phraseLink]])}
        simplifyPhrases
      />,
    );
    expect(screen.queryByTestId('split-arc-btn')).not.toBeInTheDocument();
    // The arc itself is still drawn.
    expect(document.querySelector('path')).toBeInTheDocument();
  });

  it('with simplifyPhrases on, keeps the split button for the focused phrase', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        focusedPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        simplifyPhrases
      />,
    );
    expect(screen.getByTestId('split-arc-btn')).toBeInTheDocument();
  });

  it('renders a split button in view mode when the arc phrase is hovered', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    expect(screen.getByTestId('split-arc-btn')).toBeInTheDocument();
  });

  it('renders a split button in view mode when the arc phrase is focused', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        focusedPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    expect(screen.getByTestId('split-arc-btn')).toBeInTheDocument();
    expect(screen.getByTestId('split-arc-btn').className).toContain('phrase-focused');
  });

  it('calls onArcSplit and clears hover state when split button is clicked', async () => {
    const onArcSplit = jest.fn();
    const onSplitHoverChange = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
        onArcSplit={onArcSplit}
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.click(screen.getByTestId('split-arc-btn'));

    expect(onSplitHoverChange).toHaveBeenCalledWith(new Set());
    expect(onArcSplit).toHaveBeenCalledWith('p1', 'tok-a');
  });

  it('calls onSplitHoverChange with free refs on mouse enter when split would free a token', async () => {
    const onSplitHoverChange = jest.fn();
    // Two-token phrase: splitting after tok-a frees both halves (each length 1).
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));

    expect(onSplitHoverChange).toHaveBeenCalledWith(new Set(['tok-a', 'tok-b']));
  });

  it('calls onSplitHoverChange with undefined on mouse leave', async () => {
    const onSplitHoverChange = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));
    await userEvent.unhover(screen.getByTestId('split-arc-btn'));

    expect(onSplitHoverChange).toHaveBeenLastCalledWith(new Set());
  });

  it('does not call onSplitHoverChange with free refs on enter when no token would become free (both halves ≥ 2)', async () => {
    const onSplitHoverChange = jest.fn();
    // Four-token phrase: splitting after tok-b gives before=[tok-a,tok-b] and after=[tok-c,tok-d], both ≥ 2.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));

    // onSplitHoverChange should NOT be called (no tokens freed, reshape path taken instead)
    expect(onSplitHoverChange).not.toHaveBeenCalled();
  });

  it('does not call onSplitHoverChange when splitAfterTokenRef is not found in the phrase', async () => {
    const onSplitHoverChange = jest.fn();
    // Arc refers to 'tok-stale' which is not in the phrase token list.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-stale')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));

    expect(onSplitHoverChange).not.toHaveBeenCalled();
  });

  it('renders the arc path when a phrase is highlighted only via candidatePhraseIds', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId={undefined}
        focusedPhraseId={undefined}
        candidatePhraseIds={new Set(['p1'])}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    expect(document.querySelector('path')).toBeInTheDocument();
  });

  it('renders a split button when a phrase is highlighted only via candidatePhraseIds', () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId={undefined}
        focusedPhraseId={undefined}
        candidatePhraseIds={new Set(['p1'])}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    expect(screen.getByTestId('split-arc-btn')).toBeInTheDocument();
  });

  it('assigns focused-phrase priority to an arc whose phraseId matches focusedPhraseId but not the hovered split point', async () => {
    // Two arcs for p1 (split at tok-a and tok-b). When tok-a's split button is hovered,
    // splitHoveredArc.phraseId === 'p1' but splitHoveredArc.splitAfterTokenRef !== 'tok-b', so
    // tok-b's arc falls through to the focusedPhraseId branch — covering the false branch
    // of the splitAfterTokenRef && condition and the true branch of phraseId === focusedPhraseId.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a'), makeArcPath('p1', 'tok-b')]}
        focusedPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
      />,
    );
    const btns = screen.getAllByTestId('split-arc-btn');
    // Hover the first split button — tok-b's arc goes through focusedPhraseId branch.
    await userEvent.hover(btns[0]);

    // The free-split-hovered tok-a arc is promoted to the z-5 (hovered) layer.
    const hoveredLayer = document.querySelector('svg.tw\\:z-5');
    const hoveredPaths = hoveredLayer?.querySelectorAll('path') ?? [];
    expect(hoveredPaths).toHaveLength(1);
    expect(hoveredPaths[0].getAttribute('d')).toContain('tok-a');

    // tok-b's arc is classified focused via the focusedPhraseId branch, so it sits in the z-3
    // (focused) layer — not the z-1 unfocused layer it would fall to if that branch regressed.
    const focusedLayer = document.querySelector('svg.tw\\:z-3');
    const focusedPaths = focusedLayer?.querySelectorAll('path') ?? [];
    expect(focusedPaths).toHaveLength(1);
    expect(focusedPaths[0].getAttribute('d')).toContain('tok-b');

    // Nothing falls through to the unfocused (z-1) layer.
    expect(document.querySelector('svg.tw\\:z-1')?.querySelectorAll('path')).toHaveLength(0);
  });

  it('assigns candidate priority to an arc via candidatePhraseIds when split-hover misses its splitAfterTokenRef and focusedPhraseId does not match', async () => {
    // Two arcs for p1 (split at tok-a and tok-b). No hoveredPhraseId, no focusedPhraseId, but
    // candidatePhraseIds includes 'p1'. When tok-a's split button is hovered, tok-b's arc falls
    // through: phraseId matches splitHoveredArc.phraseId but not splitAfterTokenRef → the
    // focusedPhraseId check (undefined → false) → the candidatePhraseIds.has('p1') check → true.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a'), makeArcPath('p1', 'tok-b')]}
        candidatePhraseIds={new Set(['p1'])}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
          ])
        }
      />,
    );
    const btns = screen.getAllByTestId('split-arc-btn');
    await userEvent.hover(btns[0]);

    // Both arcs land in the z-5 (hovered) layer: tok-a via the free-split promotion, and tok-b via
    // the candidatePhraseIds.has('p1') branch. If that candidate clause regressed, tok-b would drop
    // to the z-1 (unfocused) layer and would no longer appear here.
    const hoveredLayer = document.querySelector('svg.tw\\:z-5');
    const hoveredDs = Array.from(hoveredLayer?.querySelectorAll('path') ?? []).map((p) =>
      p.getAttribute('d'),
    );
    expect(hoveredDs).toHaveLength(2);
    expect(hoveredDs).toEqual(
      expect.arrayContaining([expect.stringContaining('tok-a'), expect.stringContaining('tok-b')]),
    );

    // No arc is demoted to the unfocused (z-1) layer.
    expect(document.querySelector('svg.tw\\:z-1')?.querySelectorAll('path')).toHaveLength(0);
  });

  it('highlights the phrase via onHoverPhrase on enter when the split would not free any token', async () => {
    const onHoverPhrase = jest.fn();
    const onSplitHoverChange = jest.fn();
    // Four-token phrase: splitting after tok-b leaves both halves ≥ 2, so no token is freed.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        hoveredPhraseId={undefined}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
        onHoverPhrase={onHoverPhrase}
        onSplitHoverChange={onSplitHoverChange}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));

    expect(onHoverPhrase).toHaveBeenCalledWith('p1');
    // No destructive preview is shown when nothing would be freed.
    expect(onSplitHoverChange).not.toHaveBeenCalledWith(expect.objectContaining({ size: 1 }));
  });

  it('clears the phrase highlight via onHoverPhrase on leave for a non-freeing split', async () => {
    const onHoverPhrase = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
        onHoverPhrase={onHoverPhrase}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));
    await userEvent.unhover(screen.getByTestId('split-arc-btn'));

    expect(onHoverPhrase).toHaveBeenLastCalledWith(undefined);
  });

  it('clears the phrase highlight via onHoverPhrase when a non-freeing split button is clicked', async () => {
    const onHoverPhrase = jest.fn();
    const onArcSplit = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
            ['tok-c', 2],
            ['tok-d', 3],
          ])
        }
        onHoverPhrase={onHoverPhrase}
        onArcSplit={onArcSplit}
      />,
    );

    await userEvent.click(screen.getByTestId('split-arc-btn'));

    expect(onHoverPhrase).toHaveBeenCalledWith(undefined);
    expect(onArcSplit).toHaveBeenCalledWith('p1', 'tok-b');
  });

  it('does not call onHoverPhrase on enter when the split would free a token', async () => {
    const onHoverPhrase = jest.fn();
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
        onHoverPhrase={onHoverPhrase}
      />,
    );

    await userEvent.hover(screen.getByTestId('split-arc-btn'));

    expect(onHoverPhrase).not.toHaveBeenCalled();
  });

  it('renders destructive stroke style when the split button is hovered', async () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-a')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
        tokenDocOrder={
          new Map([
            ['tok-a', 0],
            ['tok-b', 1],
          ])
        }
      />,
    );
    await userEvent.hover(screen.getByTestId('split-arc-btn'));
    const pathEl = document.querySelector('path');
    expect(pathEl?.getAttribute('style')).toContain('var(--destructive)');
  });

  it('dims the hovered segment (not destructive) when a non-freeing split button is hovered', async () => {
    // Four-token phrase: splitting after tok-b leaves both halves ≥ 2, so it is a reshape, not a
    // free. The hovered segment dims rather than turning destructive red.
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        hoveredPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
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
    await userEvent.hover(screen.getByTestId('split-arc-btn'));
    const pathEl = document.querySelector('path');
    expect(pathEl?.getAttribute('style')).toContain('var(--border)');
    expect(pathEl?.getAttribute('style')).not.toContain('var(--destructive)');
    expect(pathEl?.getAttribute('stroke-opacity')).toBe('0.3');
  });

  it('restores the standard stroke after a non-freeing split hover leaves', async () => {
    const phraseLink = makePhraseLink('p1', ['tok-a', 'tok-b', 'tok-c', 'tok-d']);
    render(
      <ArcOverlay
        {...requiredProps()}
        arcPaths={[makeArcPath('p1', 'tok-b')]}
        focusedPhraseId="p1"
        phraseLinkById={new Map([['p1', phraseLink]])}
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
    await userEvent.hover(screen.getByTestId('split-arc-btn'));
    await userEvent.unhover(screen.getByTestId('split-arc-btn'));
    const pathEl = document.querySelector('path');
    // Focused phrase falls back to the highlighted foreground stroke once the dim is cleared.
    expect(pathEl?.getAttribute('style')).toContain('var(--foreground)');
  });
});
