
import type { Token } from 'interlinearizer';

/**
 * Minimal stub for `InertTokenChip` that renders the token's surface text in a span.
 */
export function InertTokenChip({ token }: Readonly<{ token: Token }>) {
  return <span>{token.surfaceText}</span>;
}

export default InertTokenChip;
