import { useCallback, useState } from 'react';

/** Hover-driven preview state for a phrase strip. */
export type PhraseHoverState = {
  /**
   * Group key (first token ref) of the phrase box currently hovered; drives controls-pill placement
   * so the pill floats above whichever fragment the pointer is over.
   */
  hoveredGroupKey: string | undefined;
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
   * Mirrors the free token refs emitted by the arc overlay's own split-hover state so the phrase
   * boxes can show a destructive border preview. Pass an empty set on leave.
   */
  handleSplitHoverChange: (freeTokenRefs: ReadonlySet<string>) => void;
  /**
   * Sets the would-become-free token refs previewed with a destructive border when a link or unlink
   * icon is hovered. Pass `undefined` or an empty array on leave.
   */
  handleHoverSplitFreeTokens: (refs: readonly string[] | undefined) => void;
  /** Clears every hover preview at once; wired to the token row's `onMouseLeave`. */
  clearAll: () => void;
};

/**
 * Owns a phrase strip's hover-preview state — which box the pointer is over, and which tokens a
 * hovered link, unlink, or split would affect — along with the stable callbacks that update it. One
 * definition of the preview wiring, so every strip previews an operation the same way.
 *
 * The hovered phrase id is deliberately **not** part of this state: its ownership differs by mount
 * site, so it stays outside the shared wiring.
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
