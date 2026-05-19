import type { ScriptureRef, Segment, Token } from 'interlinearizer';
import { memo, useCallback, useMemo } from 'react';
import MemoizedPhraseBox from './PhraseBox';
import MemoizedTokenChip from './TokenChip';

/**
 * Narrows a `Token` to a word token.
 *
 * @param token - The token to test.
 * @returns `true` when `token.type === 'word'`.
 */
function isWordToken(token: Token): token is Token & { type: 'word' } {
  return token.type === 'word';
}

/**
 * The two display modes for {@link SegmentView}.
 *
 * - `token-chip` — renders each token as an inline chip (word tokens via `PhraseBox`, punctuation via
 *   `TokenChip`). Used for the main interactive view.
 * - `baseline-text` — renders the segment's raw `baselineText` as a single monospace string. Used for
 *   fallback or debug display.
 */
export type SegmentDisplayMode = 'token-chip' | 'baseline-text';

/**
 * Renders a single segment as either inline token chips or plain baseline text.
 *
 * @param props - Component props
 * @param props.displayMode - Controls how segment content is rendered; defaults to `'token-chip'`
 * @param props.focusedTokenId - When set, the matching word token's `PhraseBox` is rendered in the
 *   focused state; only meaningful in `token-chip` mode.
 * @param props.glosses - Map from `Token.id` to current English gloss text for tokens in this
 *   segment. Pass an empty object when no glosses have been entered yet.
 * @param props.isActive - Whether this segment is the currently selected verse
 * @param props.onGlossChange - Called with the token id and new gloss value when a gloss is edited.
 * @param props.onSelect - Called when the segment or one of its word tokens is interacted with. In
 *   `baseline-text` mode the whole segment is clickable and `tokenId` is omitted. In `token-chip`
 *   mode only word tokens trigger this callback and `tokenId` is always provided; omit to render
 *   word tokens as non-interactive spans.
 * @param props.segment - The segment to render
 * @returns A button (baseline-text mode) or div (token-chip mode) containing a verse label and
 *   segment content
 */
export function SegmentView({
  displayMode = 'token-chip',
  focusedTokenId,
  glosses,
  isActive,
  onGlossChange,
  onSelect,
  segment,
}: Readonly<{
  displayMode?: SegmentDisplayMode;
  focusedTokenId?: string;
  glosses: Record<string, string>;
  isActive?: boolean;
  onGlossChange: (tokenId: string, value: string) => void;
  onSelect: (ref: ScriptureRef, tokenId?: string) => void;
  segment: Segment;
}>) {
  const { book, chapter, verse } = segment.startRef;
  const ref: ScriptureRef = useMemo(() => ({ book, chapter, verse }), [book, chapter, verse]);

  /**
   * Forwards a token-chip click (identified by its index in `segment.tokens`) to the parent as a
   * scripture reference + token id. Stable across renders so `MemoizedPhraseBox` can memoize.
   *
   * @param index - Index of the clicked token within `segment.tokens`.
   */
  const handleTokenClick = useCallback(
    (index?: number) => {
      if (index !== undefined) onSelect(ref, segment.tokens[index].id);
    },
    [onSelect, ref, segment.tokens],
  );

  /**
   * Stable single-token arrays for word tokens keyed by position, so `MemoizedPhraseBox` receives
   * the same reference across renders.
   */
  const tokenArrays = useMemo(
    () => segment.tokens.map((token) => (isWordToken(token) ? [token] : [])),
    [segment.tokens],
  );

  const sharedClassName = isActive
    ? 'tw:w-full tw:rounded tw:border tw:border-border tw:bg-muted/50 tw:p-2'
    : 'tw:w-full tw:rounded tw:p-2 tw:transition-colors tw:hover:bg-muted/30';

  const verseLabel = (
    <span className="tw:mb-2 tw:block tw:text-xs tw:font-medium tw:text-muted-foreground tw:uppercase tw:tracking-wide">
      {verse}
    </span>
  );

  if (displayMode === 'baseline-text') {
    return (
      <button
        aria-current={isActive ? 'true' : undefined}
        className={`${sharedClassName} tw:text-left`}
        data-testid="segment-container"
        onClick={() => onSelect?.(ref)}
        type="button"
      >
        {verseLabel}
        <span className="tw:font-mono tw:text-sm tw:text-foreground">{segment.baselineText}</span>
      </button>
    );
  }

  return (
    <div
      aria-current={isActive ? 'true' : undefined}
      className={sharedClassName}
      data-testid="segment-container"
    >
      {verseLabel}
      <span className="tw:flex tw:flex-wrap tw:gap-1">
        {segment.tokens.map((token, index) =>
          token.type === 'word' ? (
            <MemoizedPhraseBox
              key={token.id}
              glosses={glosses}
              index={index}
              isFocused={focusedTokenId === token.id}
              onClick={handleTokenClick}
              onGlossChange={onGlossChange}
              tokens={tokenArrays[index]}
            />
          ) : (
            <MemoizedTokenChip key={token.id} token={token} />
          ),
        )}
      </span>
    </div>
  );
}

/** Memoized version of {@link SegmentView}; use this for all render-stable segment lists. */
const MemoizedSegmentView = memo(SegmentView);
export default MemoizedSegmentView;
