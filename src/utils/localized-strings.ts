import { isMacOs } from 'platform-bible-react';

/**
 * Picks the wording of a hint that names the Alt key to suit the host OS: macOS labels that key
 * Option, though a gesture handler reads it as `altKey` either way.
 */
export function altKeyHint(altHint: string, optionHint: string): string {
  return isMacOs() ? optionHint : altHint;
}

/**
 * Returns a localized value, or an empty string while it is still an unresolved key.
 *
 * PAPI's localization hook resolves asynchronously, yielding the raw localize key (e.g.
 * `%interlinearizer_glossInput_placeholder%`) until the lookup completes. Rendering that directly
 * flashes the bare `%…%` key in user-visible text — most noticeable in input placeholders, which
 * paint immediately on mount. Substituting an empty string turns that flash into a momentarily
 * empty field instead.
 */
export function resolvedOrEmpty(value: string): string {
  return /^%.*%$/.test(value) ? '' : value;
}
