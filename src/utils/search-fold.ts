/**
 * @file The search fold, deliberately not merged with `normalizeSurfaceForm` in
 *   `analysis-identity`. The two look alike enough to invite it, and merging them would corrupt
 *   data rather than fail loudly: folding a diacritic into identity puts genuinely different words
 *   on one shared payload, silently dropping a distinction the user recorded.
 */

/**
 * Folds text down to the form a query is matched against: equal ignoring case and diacritics, so a
 * query typed on an ordinary keyboard finds a fully pointed or accented form. Never use it to
 * decide whether two analyses are the same.
 *
 * Only nonspacing marks fold away: a spacing combining mark spells a dependent vowel, so dropping
 * it would merge words that differ by their vowel.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .normalize('NFC')
    .toLowerCase();
}
