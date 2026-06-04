import { useCallback, useState } from 'react';

/** Hover-driven preview state shared by SegmentView and ContinuousView. */
export type PhraseHoverState = {
  /**
   * Group key (first token ref) of the phrase box currently hovered; drives controls-pill placement
   * so the pill floats above whichever fragment the pointer is over.
   */
  hoveredGroupKey: string | undefined;
  /** Setter for {@link hoveredGroupKey}. */
  setHoveredGroupKey: (key: string | undefined) => void;
  /**
   * Token refs of the free tokens a hovered link icon would join into a new phrase; used to
   * highlight the affected arcs. Empty when no such hover is active.
   */
  candidateTokenRefs: ReadonlySet<string>;
  /** Setter for {@link candidateTokenRefs}; pass `undefined` to clear. */
  setCandidateTokenRefs: (refs: readonly string[] | undefined) => void;
  /**
   * Token refs that would become solo (free) after a hovered split/unlink completes; previewed with
   * a destructive border. Empty when no such hover is active.
   */
  splitFreeTokenRefs: ReadonlySet<string>;
  /**
   * Mirrors the free token refs emitted by `ArcOverlay`'s internal split-hover state so the phrase
   * boxes can show a destructive border preview.
   *
   * @param freeTokenRefs - Token refs that would become solo after the split, or an empty set on
   *   leave.
   */
  handleSplitHoverChange: (freeTokenRefs: ReadonlySet<string>) => void;
  /**
   * Sets (or clears) the would-become-free token refs previewed with a destructive border when a
   * link/unlink icon is hovered.
   *
   * @param refs - The would-be-free token refs, or `undefined`/empty on leave.
   */
  handleHoverSplitFreeTokens: (refs: readonly string[] | undefined) => void;
  /** Clears every hover preview at once; wired to the token row's `onMouseLeave`. */
  clearAll: () => void;
};

/**
 * Owns the hover-preview state that both phrase strips ({@link SegmentView} and
 * {@link ContinuousView}) need: the hovered group key, link-candidate token refs, and
 * would-become-free token refs, plus the stable callbacks that feed them from `ArcOverlay` and the
 * link/unlink icons. Extracted so the two views can never drift apart in how these previews are
 * wired, and so each view's body is freed of five near-identical state declarations.
 *
 * `hoveredPhraseId` is intentionally **not** owned here: ContinuousView keeps it locally while
 * SegmentView receives it as a prop from its parent, so the two views manage it differently.
 *
 * @returns The shared hover-preview state and its setters/handlers.
 */
export function usePhraseHoverState(): PhraseHoverState {
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | undefined>();
  const [candidateTokenRefs, setCandidateTokenRefsState] = useState<ReadonlySet<string>>(new Set());
  const [splitFreeTokenRefs, setSplitFreeTokenRefs] = useState<ReadonlySet<string>>(new Set());

  const setCandidateTokenRefs = useCallback((refs: readonly string[] | undefined) => {
    setCandidateTokenRefsState(refs ? new Set(refs) : new Set());
  }, []);

  const handleSplitHoverChange = useCallback((freeTokenRefs: ReadonlySet<string>) => {
    setSplitFreeTokenRefs(new Set(freeTokenRefs));
  }, []);

  const handleHoverSplitFreeTokens = useCallback((refs: readonly string[] | undefined) => {
    setSplitFreeTokenRefs(refs ? new Set(refs) : new Set());
  }, []);

  const clearAll = useCallback(() => {
    setHoveredGroupKey(undefined);
    setCandidateTokenRefsState(new Set());
    setSplitFreeTokenRefs(new Set());
  }, []);

  return {
    hoveredGroupKey,
    setHoveredGroupKey,
    candidateTokenRefs,
    setCandidateTokenRefs,
    splitFreeTokenRefs,
    handleSplitHoverChange,
    handleHoverSplitFreeTokens,
    clearAll,
  };
}
