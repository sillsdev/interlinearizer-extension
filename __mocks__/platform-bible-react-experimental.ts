/**
 * @file Jest mock for platform-bible-react/experimental. The real package ships ESM which Jest
 * cannot parse without extra transform configuration. This stub provides the subset used by the
 * extension.
 */

/** Text and layout direction. */
export type Direction = 'rtl' | 'ltr';

/**
 * Layout direction the interface runs in, read from the document rather than from localStorage as
 * the real function does, so a test sets it the way it would for any other RTL assertion.
 */
export function readDirection(): Direction {
  return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
}
