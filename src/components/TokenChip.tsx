import type { Token } from 'interlinearizer';
import { memo } from 'react';
import { useGloss, useGlossDispatch } from './GlossStore';

/**
 * Props for a word token chip. Requires `onFocus` because gloss input focus must propagate to the
 * parent `PhraseBox` for correct navigation state.
 */
type WordProps = Readonly<{
  /** The word token to render. */
  token: Token & { type: 'word' };
  /** Called when the gloss input receives focus; used to notify the parent `PhraseBox`. */
  onFocus: () => void;
}>;

/**
 * Props for a punctuation token chip. `onFocus` is excluded via `never` to prevent callers from
 * accidentally passing a focus handler that would be silently ignored.
 */
type PunctProps = Readonly<{
  /** The punctuation token to render. */
  token: Token;
  onFocus?: never;
}>;

/**
 * Renders a single token as an inline chip. Word tokens get a bordered box with an editable gloss
 * input below; punctuation tokens are rendered as muted inline text with no gloss.
 *
 * Props are a discriminated union on `token.type`: word tokens require `onFocus`; punctuation
 * tokens accept none of these. Gloss value and dispatch are read from {@link GlossStoreProvider}
 * context via {@link useGloss} and {@link useGlossDispatch}.
 *
 * @param props - Component props
 * @param props.token - The token to render; its `type` field discriminates the union.
 * @param props.onFocus - (word only) Called when the gloss input receives focus.
 * @returns A styled inline block
 */
export function TokenChip({ onFocus, token }: WordProps | PunctProps) {
  const gloss = useGloss(token.id);
  const onGlossChange = useGlossDispatch();

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
        onChange={(e) => onGlossChange(token.id, e.target.value)}
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
