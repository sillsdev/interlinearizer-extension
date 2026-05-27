/** @file Manual mock for TokenChip — renders surface text only, keeping TokenChip.tsx out of test scope. */

import type { Token } from 'interlinearizer';

/**
 * Minimal stub for `MemoizedInertTokenChip` that renders the token's surface text in a span.
 *
 * @param props - Component props.
 * @param props.token - The token whose surface text is rendered.
 * @returns A span containing the token's surface text.
 */
export function MemoizedInertTokenChip({ token }: Readonly<{ token: Token }>) {
  return <span>{token.surfaceText}</span>;
}
