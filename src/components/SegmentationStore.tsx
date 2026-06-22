/**
 * @file Render-scoped context exposing segment-boundary editing to the deep leaves that trigger it
 *   (the cross-segment link icon and the merge/split boundary controls).
 *
 *   The {@link SegmentationDispatch} closes over the draft's current boundary delta and the original
 *   verse-tokenized book, applying the pure transforms in `utils/segmentation.ts` and auto-saving
 *   the result. Boundary edits flow draft → re-segmentation → new `book.segments`, so consumers
 *   only need to call a dispatch method; they never see the delta itself.
 */
import type { Segment } from 'interlinearizer';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/** The boundary-editing operations available to leaf controls. Each one auto-saves the result. */
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
  /**
   * When `true`, the link slots render merge/split boundary controls instead of phrase link icons.
   * Toggled from the view-options menu.
   */
  boundaryEditMode: boolean;
  /** Segment id → segment, used to resolve a segment's first-token start ref. */
  segmentById: ReadonlyMap<string, Segment>;
  /** Segment id → its index in document order, used to test segment adjacency. */
  segmentOrder: ReadonlyMap<string, number>;
}>;

/** No-op dispatch used as the default outside a provider (e.g. in isolated component tests). */
export const NO_OP_SEGMENTATION_DISPATCH: SegmentationDispatch = {
  merge: () => {},
  split: () => {},
  move: () => {},
};

/**
 * Default context for components rendered without a {@link SegmentationProvider}: boundary editing
 * is off and the dispatch is inert. Lets `SegmentView` / `ContinuousView` / `TokenLinkIcon` be
 * unit- tested in isolation without wiring a provider, while the real app always supplies one.
 */
const DEFAULT_VALUE: SegmentationContextValue = {
  dispatch: NO_OP_SEGMENTATION_DISPATCH,
  boundaryEditMode: false,
  segmentById: new Map(),
  segmentOrder: new Map(),
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
 * @returns The children wrapped in the context provider.
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
