/** @file Tokenizes a {@link RawBook} into the interlinear model's `Book → Segment → Token` chain. */

import { VerseRef } from '@sillsdev/scripture';
import type { Book, ScriptureRef, Segment, Token, TokenType } from 'interlinearizer';

import type { RawBook } from './usjBookExtractor';

/**
 * Matches word tokens (`\p{L}\p{N}\p{M}` runs) and punctuation tokens (any single non-word,
 * non-whitespace character). Whitespace is not tokenized.
 */
const TOKEN_RE = /[\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}\s]/gu;
/**
 * Tests whether a matched token string starts with a word character, to classify it as `word` vs
 * `punctuation`.
 */
const WORD_START_RE = /[\p{L}\p{N}\p{M}]/u;

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
  return Array.from(text.matchAll(TOKEN_RE)).map((match) => {
    const surfaceText = match[0];
    const charStart = match.index;
    const charEnd = charStart + surfaceText.length;
    const type: TokenType = WORD_START_RE.test(surfaceText) ? 'word' : 'punctuation';
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
    return {
      id: sid,
      startRef: ref,
      endRef: ref,
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
