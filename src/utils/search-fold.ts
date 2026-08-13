/**
 * @file The search fold, deliberately not merged with {@link normalizeSurfaceForm} in
 *   `analysis-identity`. The two look alike enough to invite it, and merging them would corrupt
 *   data rather than fail loudly: folding a diacritic into identity puts genuinely different words
 *   on one shared payload, silently dropping a distinction the user recorded.
 */

/**
 * Word-final letter shapes, each mapped to the shape its letter takes anywhere else. These are the
 * letters no normalization unifies, their scripts encoding the two shapes as distinct letters
 * rather than as variants of one.
 */
const FINAL_LETTER_FORMS: Readonly<Record<string, string>> = {
  ς: 'σ',
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
};

/** Matches the letters {@link FINAL_LETTER_FORMS} folds. */
const FINAL_LETTER_PATTERN = new RegExp(`[${Object.keys(FINAL_LETTER_FORMS).join('')}]`, 'gu');

/**
 * Folds text down to the form a query is matched against: equal ignoring case, diacritics, and
 * every distinction a compatibility decomposition erases — the shape a letter takes at its position
 * in a word, but equally a ligature, a full-width or superscript digit, a circled number, a
 * non-breaking space. A query typed on an ordinary keyboard therefore finds a fully pointed or
 * accented form wherever in a word it sits. Never use it to decide whether two analyses are the
 * same.
 *
 * Only the letters {@link FINAL_LETTER_FORMS} lists need folding by hand; every other positional
 * shape decomposes to the plain letter typed for it whatever script writes it.
 *
 * Some distinctions deliberately survive the fold. A spacing combining mark spells a dependent
 * vowel, so dropping it would merge words differing only in that vowel; nonspacing marks alone go.
 * Where a script writes a vowel or a cluster joiner as a nonspacing mark, as Thai and Devanagari
 * do, that costs real distinctions: words differing only in such a mark fold together, and a query
 * for one finds the other.
 *
 * And a letter written with a stroke or bar keeps it, matching how the scripts that write one count
 * it a letter of its own rather than a decorated one. So does a letter whose uppercase is spelled
 * with two: `ß` stays itself rather than expanding to `ss`, so neither spelling of a German word
 * finds the other.
 */
export function foldForSearch(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{Mn}/gu, '')
      .normalize('NFC')
      // Lowercasing a capitalized word is itself what puts its last letter into a final shape, so
      // the fold of those shapes has to follow it.
      .toLowerCase()
      .replace(FINAL_LETTER_PATTERN, (letter) => FINAL_LETTER_FORMS[letter])
  );
}
