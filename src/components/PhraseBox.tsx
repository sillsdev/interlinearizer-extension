/** @file Shared phrase-box wrapper used around word tokens. */
import type { Token } from 'interlinearizer';
import { memo, useCallback } from 'react';
import MemoizedTokenChip from './TokenChip';

/** Props for {@link PhraseBox}. */
type PhraseBoxProps = Readonly<{
  index: number | undefined;
  isFocused: boolean;
  onClick: (index?: number) => void;
  tokens: (Token & { type: 'word' })[];
}>;

/**
 * Wraps one or more tokens in a phrase-level visual container.
 *
 * @param props - Component props
 * @param props.index - Index passed back to `onClick` to identify which phrase was interacted with
 * @param props.isFocused - Whether this phrase is the current navigation focus
 * @param props.onClick - Called with `index` when the phrase is clicked; omit to render a
 *   non-interactive span
 * @param props.tokens - Tokens belonging to this phrase
 * @returns A bordered inline container
 */
export function PhraseBox({ index, isFocused = false, onClick, tokens }: PhraseBoxProps) {
  const baseClass = isFocused
    ? 'tw:inline-flex tw:items-center tw:rounded tw:border-2 tw:border-white tw:bg-muted/30 tw:px-1 tw:py-0.5'
    : 'tw:inline-flex tw:items-center tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-1 tw:py-0.5';

  /** Forwards focus events on a child chip to the parent `onClick` handler with this phrase's index. */
  const handleFocus = useCallback(() => onClick?.(index), [onClick, index]);
  /**
   * Forwards click events on the phrase button to the parent `onClick` handler with this phrase's
   * index.
   */
  const handleClick = useCallback(() => onClick?.(index), [onClick, index]);

  const innerContent = (
    <span className="tw:inline-flex tw:items-center tw:gap-1">
      {tokens.map((token) => (
        <MemoizedTokenChip key={token.id} onFocus={handleFocus} token={token} />
      ))}
    </span>
  );

  return (
    <button
      className={`${baseClass} tw:cursor-pointer tw:text-left tw:hover:bg-muted/30`}
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
      onClick={handleClick}
      tabIndex={-1}
      type="button"
    >
      {innerContent}
    </button>
  );
}

/** Memoized version of {@link PhraseBox}; use this for all render-stable phrase lists. */
const MemoizedPhraseBox = memo(PhraseBox);
export default MemoizedPhraseBox;
