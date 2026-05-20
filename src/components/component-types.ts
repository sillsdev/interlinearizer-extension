import type { Token } from 'interlinearizer';

/**
 * Narrows a `Token` to a word token.
 *
 * @param token - The token to test.
 * @returns `true` when `token.type === 'word'`.
 */
export function isWordToken(token: Token): token is Token & { type: 'word' } {
  return token.type === 'word';
}
