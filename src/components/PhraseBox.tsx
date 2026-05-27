/** @file Shared phrase-box wrapper used around word tokens. */
import type { Token } from 'interlinearizer';
import { memo, useCallback } from 'react';
import MemoizedTokenChip from './TokenChip';

/** Props for {@link PhraseBox}. */
type PhraseBoxProps = Readonly<{
  /** Index passed back to `onFocusPhrase` to identify which phrase gained focus. */
  index: number | undefined;
  /** Whether this phrase is the current navigation focus. */
  isFocused: boolean;
  /** Called with `index` when any child gloss input receives focus. */
  onFocusPhrase: (index?: number) => void;
  /** Word tokens belonging to this phrase; must all have `type: 'word'`. */
  tokens: (Token & { type: 'word' })[];
}>;

/**
 * Wraps one or more tokens in a phrase-level visual container.
 *
 * @param props - Component props
 * @param props.index - Index passed back to `onFocusPhrase` to identify which phrase was focused
 * @param props.isFocused - Whether this phrase is the current navigation focus
 * @param props.onFocusPhrase - Called with `index` when any child gloss input receives focus
 * @param props.tokens - Tokens belonging to this phrase
 * @returns A bordered inline container
 */
export function PhraseBox({ index, isFocused = false, onFocusPhrase, tokens }: PhraseBoxProps) {
  const baseClass = isFocused
    ? 'tw:inline-flex tw:items-center tw:rounded tw:border-2 tw:border-white tw:bg-muted/30 tw:px-1 tw:py-0.5'
    : 'tw:inline-flex tw:items-center tw:rounded tw:border tw:border-border/40 tw:bg-muted/20 tw:px-1 tw:py-0.5';

  /** Notifies the parent when a child gloss input receives focus. */
  const handleFocus = useCallback(() => onFocusPhrase(index), [onFocusPhrase, index]);

  return (
    <label
      className={baseClass}
      data-focus-state={isFocused ? 'focused' : 'default'}
      data-phrase-box="true"
    >
      <span className="tw:inline-flex tw:items-center tw:gap-1">
        {tokens.map((token) => (
          <MemoizedTokenChip key={token.ref} onFocus={handleFocus} token={token} />
        ))}
      </span>
    </label>
  );
}

/** Memoized version of {@link PhraseBox}; use in render-stable phrase lists. */
const MemoizedPhraseBox = memo(PhraseBox);
export default MemoizedPhraseBox;
