import type { ReactNode } from 'react';

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

/**
 * Narrows tooltip content that carries nothing to show to `undefined`, so a caller can leave its
 * `TooltipContent` unmounted rather than mounting an empty one.
 *
 * The platform `TooltipContent` draws its filled bubble and arrow from its own classes rather than
 * from its children, so mounting it with an empty string or an empty array pops a blank bubble on
 * hover; leaving the element absent pops nothing.
 */
export function tooltipContentOrUndefined<T extends string | readonly ReactNode[]>(
  content: T,
): T | undefined {
  return content.length === 0 ? undefined : content;
}
