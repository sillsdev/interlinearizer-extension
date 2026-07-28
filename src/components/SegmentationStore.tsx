import type { Segment } from 'interlinearizer';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * The boundary-editing operations available to the deep leaves that trigger them — the
 * cross-segment link icon and the merge/split boundary controls. Each one auto-saves its result.
 *
 * Each operation closes over the draft's current boundary delta and the original verse-tokenized
 * book. Edits flow from draft through re-segmentation to a new segment list, so consumers only ever
 * call a method here and never see the delta itself.
 */
export type SegmentationDispatch = Readonly<{
  /**
   * Merges the segment that begins at `secondSegmentStartRef` into the segment before it.
   *
   * @param secondSegmentStartRef - First-token ref of the segment to merge into its predecessor.
   */
  merge: (secondSegmentStartRef: string) => void;
  /**
   * Splits a segment so a new one begins at `tokenRef`.
   *
   * @param tokenRef - The token ref the new segment should begin at.
   */
  split: (tokenRef: string) => void;
  /**
   * Moves a boundary from `fromRef` to `toRef` — used to pull a single edge token across a segment
   * boundary when a cross-segment phrase link is made.
   *
   * @param fromRef - The current segment-start ref to remove.
   * @param toRef - The new segment-start ref to add.
   */
  move: (fromRef: string, toRef: string) => void;
}>;

/** The strip-wide segmentation context: the dispatch plus the lookups its call sites need. */
export type SegmentationContextValue = Readonly<{
  /** Boundary-editing operations. */
  dispatch: SegmentationDispatch;
  /** Segment id → segment, used to resolve a segment's first-token start ref. */
  segmentById: ReadonlyMap<string, Segment>;
  /** Segment id → its index in document order, used to test segment adjacency. */
  segmentOrder: ReadonlyMap<string, number>;
  /**
   * Maps each merged-away default verse boundary's word-token split anchor (the verse's first word
   * token) to the removed default start ref. The slots sitting on these anchors render a faint
   * former-boundary tick so the original segmentation stays visible, and a split there dispatches
   * the mapped ref so the restore cancels the removal exactly — even when the verse begins with
   * punctuation, whose ref no word-anchored slot could otherwise name.
   *
   * Bridges two anchor conventions: `SegmentationDelta.removedVerseStarts` anchors on a verse's
   * leading token of **any** type, while the boundary slots are keyed by word tokens. The two
   * diverge only when a verse begins with punctuation; this lookup reconciles them at that seam.
   */
  formerBoundaries: ReadonlyMap<string, string>;
  /**
   * Word-token refs where placing a segment boundary would cut a phrase. The split control
   * suppresses itself at these refs (the not-mid-phrase UI guard); the segmentation dispatch itself
   * accepts such boundaries and force-breaks the straddled phrases.
   */
  straddledBoundaryRefs: ReadonlySet<string>;
}>;

/** No-op dispatch used as the default outside a provider (e.g. in isolated component tests). */
export const NO_OP_SEGMENTATION_DISPATCH: SegmentationDispatch = {
  merge: () => {},
  split: () => {},
  move: () => {},
};

/**
 * Default context for components rendered without a {@link SegmentationProvider}: the dispatch is
 * inert and the lookups are empty. Lets `SegmentView` / `ContinuousView` / `TokenLinkIcon` be
 * unit-tested in isolation without wiring a provider, while the real app always supplies one.
 */
const DEFAULT_VALUE: SegmentationContextValue = {
  dispatch: NO_OP_SEGMENTATION_DISPATCH,
  segmentById: new Map(),
  segmentOrder: new Map(),
  formerBoundaries: new Map(),
  straddledBoundaryRefs: new Set(),
};

const SegmentationContext = createContext<SegmentationContextValue | undefined>(undefined);

/** Props for {@link SegmentationProvider}. */
type SegmentationProviderProps = Readonly<{
  /** The segmentation context value; callers should memoize it to preserve leaf memoization. */
  value: SegmentationContextValue;
  /** The subtree that can edit segment boundaries. */
  children: ReactNode;
}>;

/**
 * Provides the {@link SegmentationContextValue} to the interlinear views beneath it.
 *
 * @param props - Component props.
 * @param props.value - The segmentation context value.
 * @param props.children - The subtree.
 */
export function SegmentationProvider({ value, children }: SegmentationProviderProps) {
  return <SegmentationContext.Provider value={value}>{children}</SegmentationContext.Provider>;
}

/**
 * Reads the segmentation context, falling back to an inert default when no provider is present.
 *
 * @returns The current {@link SegmentationContextValue}, or an inert default outside a provider.
 */
export function useSegmentation(): SegmentationContextValue {
  return useContext(SegmentationContext) ?? DEFAULT_VALUE;
}
