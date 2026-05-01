import type { Segment } from 'interlinearizer';
import TokenChip from './TokenChip';

/** The two display modes for {@link SegmentView}. */
export type SegmentDisplayMode = 'token-chip' | 'baseline-text';

/**
 * Renders a single segment as either inline token chips or plain baseline text.
 *
 * @param props - Component props
 * @param props.segment - The segment to render
 * @param props.isActive - Whether this segment is the currently selected verse
 * @param props.onClick - Callback invoked when the segment button is clicked
 * @param props.displayMode - Controls how segment content is rendered; defaults to `'token-chip'`
 * @returns A button containing the segment's verse label and content
 */
export default function SegmentView({
  segment,
  isActive,
  onClick,
  displayMode = 'token-chip',
}: Readonly<{
  segment: Segment;
  isActive?: boolean;
  onClick?: () => void;
  displayMode?: SegmentDisplayMode;
}>) {
  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      className={
        isActive
          ? 'tw-w-full tw-rounded tw-border tw-border-border tw-bg-muted/50 tw-p-2 tw-text-left'
          : 'tw-w-full tw-rounded tw-p-2 tw-text-left tw-transition-colors hover:tw-bg-muted/30'
      }
      onClick={onClick}
    >
      <span className="tw-mb-2 tw-block tw-text-xs tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide">
        {segment.startRef.verse}
      </span>
      {displayMode === 'baseline-text' ? (
        <span className="tw-font-mono tw-text-sm tw-text-foreground">{segment.baselineText}</span>
      ) : (
        <span className="tw-flex tw-flex-wrap tw-gap-1">
          {segment.tokens.map((token) => (
            <TokenChip key={token.id} token={token} />
          ))}
        </span>
      )}
    </button>
  );
}
