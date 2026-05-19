import type { Token } from 'interlinearizer';
import { memo } from 'react';

/**
 * Renders a single token as an inline chip. Word tokens get a bordered box with an editable gloss
 * input below; non-word tokens (e.g. punctuation) are rendered as muted inline text with no gloss.
 *
 * @param props - Component props
 * @param props.gloss - Current gloss text for this token (English). Absent when no gloss has been
 *   set.
 * @param props.onFocus - Called when the gloss input receives focus; used by the parent to track
 *   which token is active.
 * @param props.onGlossChange - Called with the new gloss value when the user edits the input.
 * @param props.token - The token to render
 * @returns A styled inline block
 */
export function TokenChip({
  gloss,
  onFocus,
  onGlossChange,
  token,
}: Readonly<{
  gloss?: string;
  onFocus?: () => void;
  onGlossChange?: (value: string) => void;
  token: Token;
}>) {
  return token.type === 'word' ? (
    <span className="tw:inline-flex tw:shrink-0 tw:flex-col tw:items-center tw:rounded tw:border tw:border-border tw:bg-muted tw:px-1.5 tw:py-0.5">
      <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground">
        {token.surfaceText}
      </span>
      <input
        aria-label={`Gloss for ${token.surfaceText}`}
        className="tw:mt-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring"
        style={{ fieldSizing: 'content', minWidth: '5ch' }}
        defaultValue={gloss ?? ''}
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

const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;
