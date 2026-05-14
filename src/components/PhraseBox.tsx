/** @file Shared phrase-box wrapper used around word tokens. */
import type { Token } from 'interlinearizer';
import { memo } from 'react';
import MemoizedTokenChip from './TokenChip';

/**
 * Wraps one or more tokens in a phrase-level visual container.
 *
 * @param props - Component props
 * @param props.index - Index passed back to `onClick` to identify which phrase was clicked
 * @param props.isFocused - Whether this phrase is the current navigation focus
 * @param props.onClick - Called with `index` when the phrase is clicked; omit to render a
 *   non-interactive span
 * @param props.tokens - Tokens belonging to this phrase
 * @returns A bordered inline container
 */
export function PhraseBox({
  index,
  isFocused = false,
  onClick,
  tokens,
}: Readonly<{
  index?: number;
  isFocused?: boolean;
  onClick?: (index?: number) => void;
  tokens: Token[];
}>) {
  const baseClass = isFocused
    ? 'tw:inline-flex tw:items-center tw:rounded tw:border-2 tw:border-border tw:bg-muted/30 tw:px-1 tw:py-0.5'
    : 'tw:inline-flex tw:items-center tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-1 tw:py-0.5';
  const innerContent = (
    <span className="tw:inline-flex tw:items-center tw:gap-1">
      {tokens.map((token) => (
        <MemoizedTokenChip key={token.id} token={token} />
      ))}
    </span>
  );

  if (onClick) {
    return (
      <button
        className={`${baseClass} tw:cursor-pointer tw:text-left tw:hover:bg-muted/30`}
        data-focus-state={isFocused ? 'focused' : 'default'}
        data-phrase-box="true"
        onClick={() => onClick?.(index)}
        type="button"
      >
        {innerContent}
      </button>
    );
  }

  return (
    <span
      className={baseClass}
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
    >
      {innerContent}
    </span>
  );
}

const MemoizedPhraseBox = memo(PhraseBox);
export default MemoizedPhraseBox;
