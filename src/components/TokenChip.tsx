import type { Token } from 'interlinearizer';
import { memo } from 'react';

/** Props for a word token chip; requires gloss editing callbacks. */
type WordProps = Readonly<{
  token: Token & { type: 'word' };
  gloss: string;
  onFocus: () => void;
  onGlossChange: (value: string) => void;
}>;

/** Props for a punctuation token chip; editing props are excluded via `never`. */
type PunctProps = Readonly<{
  token: Token;
  gloss?: never;
  onFocus?: never;
  onGlossChange?: never;
}>;

/**
 * Renders a single token as an inline chip. Word tokens get a bordered box with an editable gloss
 * input below; punctuation tokens are rendered as muted inline text with no gloss.
 *
 * Props are a discriminated union on `token.type`: word tokens require `onGlossChange` and accept
 * `gloss` and `onFocus`; punctuation tokens accept none of these.
 *
 * @param props - Component props
 * @param props.token - The token to render; its `type` field discriminates the union.
 * @param props.gloss - (word only) Current gloss text. Absent when no gloss has been set.
 * @param props.onFocus - (word only) Called when the gloss input receives focus.
 * @param props.onGlossChange - (word only) Called with the new gloss value when the user edits the
 *   input.
 * @returns A styled inline block
 */
export function TokenChip({ gloss, onFocus, onGlossChange, token }: WordProps | PunctProps) {
  return token.type === 'word' ? (
    <span className="tw:inline-flex tw:shrink-0 tw:flex-col tw:items-center tw:rounded tw:border tw:border-border tw:bg-muted tw:px-1.5 tw:py-0.5">
      <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground">
        {token.surfaceText}
      </span>
      <input
        aria-label={`Gloss for ${token.surfaceText}`}
        className="tw:mt-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring"
        style={{ fieldSizing: 'content', minWidth: '5ch' }}
        value={gloss}
        onChange={(e) => onGlossChange?.(e.target.value)}
        onFocus={onFocus}
        type="text"
      />
    </span>
  ) : (
    <span className="tw:inline-block tw:font-mono tw:text-sm tw:text-muted-foreground">
      {token.surfaceText}
    </span>
  );
}

/** Memoized version of {@link TokenChip}; use this for all render-stable token lists. */
const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;
