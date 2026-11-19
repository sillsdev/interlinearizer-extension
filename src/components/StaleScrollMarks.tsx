import type { OutlineSegment } from '../types/segment-pages';
import type { HeightTable } from '../utils/segment-heights';

/** Props for {@link StaleScrollMarks}. */
export type StaleScrollMarksProps = Readonly<{
  /** Every segment of the book, in document order. */
  segments: readonly OutlineSegment[];
  /** Predicted geometry of `segments`, index-aligned with them. */
  heights: HeightTable;
}>;

/**
 * Marks on the list's scroll track where the book's stale analyses lie, in loaded and unloaded
 * segments alike. Renders nothing when no segment shows one.
 */
export default function StaleScrollMarks({ segments, heights }: StaleScrollMarksProps) {
  const marks = segments.flatMap((segment, index) =>
    segment.hasStaleGloss || segment.hasStaleFreeTranslation ? [{ id: segment.id, index }] : [],
  );
  if (marks.length === 0) return undefined;
  const percentOf = (px: number) => `${(px / heights.total) * 100}%`;
  return (
    <div
      aria-hidden="true"
      className="tw:pointer-events-none tw:absolute tw:inset-y-0 tw:right-0 tw:w-1.5"
      data-testid="stale-scroll-marks"
    >
      {marks.map(({ id, index }) => (
        <div
          key={id}
          className="tw:absolute tw:inset-x-0 tw:min-h-0.5 tw:bg-destructive"
          data-stale-segment-id={id}
          style={{
            top: percentOf(heights.offsets[index]),
            height: percentOf(heights.heights[index]),
          }}
        />
      ))}
    </div>
  );
}
