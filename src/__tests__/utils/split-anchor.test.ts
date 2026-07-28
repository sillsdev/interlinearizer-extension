/// <reference types="jest" />

import type { Token } from 'interlinearizer';
import { resolveSplitAnchor } from '../../utils/split-anchor';

/**
 * Builds an ordered token run from a plain baseline string by cutting it at the given surface
 * spans, so a test can describe a gap as literal text (e.g. `word1, "word2`) and get back the
 * word/punctuation tokens with correct `charStart`/`charEnd` offsets into that string.
 *
 * Each span is `[surfaceText, type]`; the spans must appear in `baselineText` in order and the
 * whitespace between them is taken verbatim from `baselineText` (never a token). The returned run
 * always begins and ends with a word token, matching how {@link resolveSplitAnchor} is called for a
 * word-word gap.
 */
function tokensFrom(
  baselineText: string,
  spans: readonly (readonly [string, Token['type']])[],
): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  spans.forEach(([surfaceText, type], i) => {
    const charStart = baselineText.indexOf(surfaceText, cursor);
    const charEnd = charStart + surfaceText.length;
    tokens.push({
      ref: `t${i}:${charStart}`,
      surfaceText,
      writingSystem: 'en',
      type,
      charStart,
      charEnd,
    });
    cursor = charEnd;
  });
  return tokens;
}

/**
 * Resolves the split anchor for a word-word gap described as a literal baseline string plus its
 * token spans. The first span must be the preceding word and the last the following word; the spans
 * in between are the gap punctuation.
 */
function anchorFor(
  baselineText: string,
  spans: readonly (readonly [string, Token['type']])[],
): string {
  const run = tokensFrom(baselineText, spans);
  const prevToken = run[0];
  const nextToken = run[run.length - 1];
  const punctuation = run.slice(1, -1);
  return resolveSplitAnchor(prevToken, nextToken, punctuation, baselineText);
}

describe('resolveSplitAnchor', () => {
  it('anchors on the following word when a comma touches the preceding word', () => {
    // `word1, word2` → `word1, | word2` — comma touches word1 ⇒ preceding; anchor = word2.
    expect(
      anchorFor('word1, word2', [
        ['word1', 'word'],
        [',', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t2:7');
  });

  it('anchors on the following word when an exclamation mark touches the preceding word', () => {
    // `word1! word2` → `word1! | word2` — `!` touches word1 ⇒ preceding; anchor = word2.
    expect(
      anchorFor('word1! word2', [
        ['word1', 'word'],
        ['!', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t2:7');
  });

  it('anchors on the leading quote when it touches the following word', () => {
    // `word1 "word2` → `word1 | "word2` — `"` touches word2 (no space after) ⇒ following;
    // anchor = the quote token itself (position 6).
    expect(
      anchorFor('word1 "word2', [
        ['word1', 'word'],
        ['"', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t1:6');
  });

  it('anchors on the leading quote when a comma binds preceding and the quote binds following', () => {
    // `word1, "word2` → `word1, | "word2` — `,` touches word1 ⇒ preceding; `"` touches word2 ⇒
    // following; anchor = the quote (position 7).
    expect(
      anchorFor('word1, "word2', [
        ['word1', 'word'],
        [',', 'punctuation'],
        ['"', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t2:7');
  });

  it('anchors on a whitespace-isolated opening mark (French guillemet)', () => {
    // `word1 « word2` → `word1 | « word2` — `«` is space-isolated on both sides and is an opening
    // mark ⇒ following; anchor = the guillemet (position 6).
    expect(
      anchorFor('word1 « word2', [
        ['word1', 'word'],
        ['«', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t1:6');
  });

  it('anchors on the following word for a whitespace-isolated non-opening mark (French inside-spacing)', () => {
    // `word1 ! word2` → `word1 ! | word2` — `!` is space-isolated and non-opening ⇒ preceding;
    // anchor = word2 (position 8).
    expect(
      anchorFor('word1 ! word2', [
        ['word1', 'word'],
        ['!', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t2:8');
  });

  it('anchors on the first of two stacked marks that both touch forward', () => {
    // `word1 ("word2` → `word1 | ("word2` — `(` touches `"`, `"` touches word2, so both bind
    // following; the anchor is the first following token in document order: `(` (position 6).
    expect(
      anchorFor('word1 ("word2', [
        ['word1', 'word'],
        ['(', 'punctuation'],
        ['"', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t1:6');
  });

  it('anchors on the following word when two stacked marks both touch backward', () => {
    // `word1," word2` → `word1," | word2` — `,"` is one whitespace-free cluster that touches word1
    // on its left (a space separates it from word2), so the whole cluster binds preceding; anchor =
    // word2 (position 8).
    expect(
      anchorFor('word1," word2', [
        ['word1', 'word'],
        [',', 'punctuation'],
        ['"', 'punctuation'],
        ['word2', 'word'],
      ]),
    ).toBe('t3:8');
  });

  it('anchors on the following word when the gap has no punctuation', () => {
    // `word1 word2` → `word1 | word2` — no punctuation in the gap; anchor is the following word.
    expect(
      anchorFor('word1 word2', [
        ['word1', 'word'],
        ['word2', 'word'],
      ]),
    ).toBe('t1:6');
  });
});
