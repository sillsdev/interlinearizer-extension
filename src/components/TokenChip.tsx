import type { Token } from 'interlinearizer';
import { memo } from 'react';

/**
 * Renders a single token as an inline chip. Word tokens get a bordered box; non-word tokens (e.g.
 * punctuation) are rendered as muted inline text.
 *
 * @param props - Component props
 * @param props.token - The token to render
 * @returns A styled inline span
 */
export function TokenChip({ token }: Readonly<{ token: Token }>) {
  return token.type === 'word' ? (
    <span className="tw:inline-block tw:rounded tw:border tw:border-border tw:bg-muted tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-sm tw:text-foreground">
      {token.surfaceText}
    </span>
  ) : (
    <span className="tw:inline-block tw:font-mono tw:text-sm tw:text-muted-foreground">
      {token.surfaceText}
    </span>
  );
}

const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;
