/** @file Tokenizes a {@link RawBook} into the interlinear model's `Book → Segment → Token` chain. */

import { VerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, Token, TokenType } from 'interlinearizer';

import type { RawBook } from './usjBookExtractor';

/**
 * Unicode property classes that define a "word character" for tokenization purposes.
 *
 * Includes letters, numbers, combining marks, and join-control characters (U+200C ZWNJ / U+200D
 * ZWJ) so that Arabic, Farsi, and Indic script ligatures are not split mid-token.
 *
 * Note: U+02BC (modifier letter apostrophe) and U+02BB (ʻokina) are included in `\p{L}` and are
 * always word characters, despite appearing like punctuation.
 */
const CHAR_SET = String.raw`\p{L}\p{N}\p{M}\p{Join_Control}`;

/**
 * Includes U+0027 and U+2019 at word-initial position (before the first word character) to handle
 * languages where these characters represent a phonemic glottal stop or similar feature (e.g.
 * Hebrew aleph in romanization, various indigenous-language orthographies).
 *
 * Doesn't include hyphens/dashes.
 */
const LEAD_SET = String.raw`\u0027\u2019`;

/**
 * Word-internal joiners:
 *
 * - \u0027 (Apostrophe)
 * - \u002D (Hyphen-minus)
 * - \u2010-\u2015 (Unicode hyphens/dashes)
 * - \u2019 (Right single quote)
 *
 * `\uXXXX` escapes are used for joiner characters to prevent auto-formatters from converting them
 * to typographic quotes or other Unicode variants.
 */
const JOIN_SET = String.raw`\u0027\u002D\u2010-\u2015\u2019`;

/**
 * Matches word tokens and punctuation tokens. Whitespace is not tokenized.
 *
 * A word token is a run of word characters, optionally extended through some leading characters and
 * word-internal joiners (e.g., apostrophes and hyphens). A joiner is absorbed into the surrounding
 * word only when it is both preceded and followed by word characters. Trailing joiners are left as
 * standalone punctuation tokens.
 *
 * Multiple leading apostrophes are absorbed greedily. Leading hyphens/dashes are NOT absorbed.
 *
 * Multiple consecutive word-internal joiners between word characters are absorbed greedily (e.g.
 * `a--b` → one token `a--b`).
 */
const TOKEN_RE = new RegExp(
  String.raw`(?:[${LEAD_SET}]+(?=[${CHAR_SET}]))?[${CHAR_SET}]+(?:[${JOIN_SET}]+(?=[${CHAR_SET}])[${CHAR_SET}]+)*|[^${CHAR_SET}\s]`,
  'gv',
);

/**
 * Tests whether a matched token string contains a word character, to classify it as `word` vs
 * `punctuation`.
 */
const WORD_CONTAIN_RE = new RegExp(`[${CHAR_SET}]`, 'v');

/**
 * Parses a USJ verse SID (e.g. `"GEN 1:1"`) into a {@link ScriptureRef}.
 *
 * @param sid - Verse SID string from the USJ `verse` marker (e.g. `"GEN 1:1"`).
 * @returns A `ScriptureRef` with `book`, `chapter`, and `verse` populated.
 * @throws {SyntaxError} If `sid` is not a valid scripture reference string.
 */
function parseSid(sid: string): ScriptureRef {
  const { success, verseRef } = VerseRef.tryParse(sid);
  if (!success) throw new SyntaxError(`Invalid verse SID: "${sid}"`);
  return { book: verseRef.book, chapter: verseRef.chapterNum, verse: verseRef.verseNum };
}

/**
 * Splits a verse's plain text into an ordered array of {@link Token}s.
 *
 * Word tokens (`\p{L}\p{N}\p{M}` runs) and punctuation tokens (any single non-word, non-whitespace
 * character) are emitted in document order. Whitespace is not tokenized. Character offsets are
 * zero-based relative to `text`; `charEnd` is exclusive.
 *
 * @param text - The verse's `baselineText` string.
 * @param sid - The verse SID used as the token ID prefix (e.g. `"GEN 1:1"`).
 * @param writingSystem - BCP 47 tag assigned to every token's `writingSystem` field.
 * @returns Ordered array of {@link Token}s; empty when `text` contains no word or punctuation
 *   characters.
 */
function tokenizeVerse(text: string, sid: string, writingSystem: string): Token[] {
  return Array.from(text.matchAll(TOKEN_RE), (match) => {
    const surfaceText = match[0];
    const charStart = match.index;
    const charEnd = charStart + surfaceText.length;
    const type: TokenType = WORD_CONTAIN_RE.test(surfaceText) ? 'word' : 'punctuation';
    return { id: `${sid}:${charStart}`, surfaceText, writingSystem, type, charStart, charEnd };
  });
}

/**
 * Tokenizes a {@link RawBook} into the interlinear model's `Book` (text layer only — no analysis).
 *
 * Each `RawVerse` becomes one `Segment`. The verse SID is parsed into `startRef` / `endRef` (both
 * equal — verse-level granularity). The verse text is split into `Token`s using Unicode-aware
 * word/punctuation splitting; character offsets are relative to `Segment.baselineText`.
 *
 * Invariant upheld for every token: `segment.baselineText.slice(token.charStart, token.charEnd) ===
 * token.surfaceText`.
 *
 * @param rawBook - Extracted book data from {@link extractBookFromUsj}.
 * @returns A `Book` with one `Segment` per verse, each containing its ordered `Token`s.
 * @throws {SyntaxError} If any `RawVerse.sid` cannot be parsed as a valid scripture reference.
 */
export function tokenizeBook(rawBook: RawBook): Book {
  const segments: Segment[] = rawBook.verses.map(({ sid, text }) => {
    const ref = parseSid(sid);
    if (ref.book !== rawBook.bookCode) {
      throw new SyntaxError(`Verse SID "${sid}" does not match book code "${rawBook.bookCode}"`);
    }
    return {
      id: sid,
      startRef: { ...ref },
      endRef: { ...ref },
      baselineText: text,
      tokens: tokenizeVerse(text, sid, rawBook.writingSystem),
    };
  });

  return {
    id: rawBook.bookCode,
    bookRef: rawBook.bookCode,
    textVersion: rawBook.contentHash,
    segments,
  };
}
